/**
 * Fase 2 (sistema de reservas de Daniela) — integración REAL contra el
 * modelo de datos de la Fase 1 (dulabs_servicios / dulabs_servicio_especialista
 * / dulabs_horario_especialista / dulabs_bloqueos) y las tablas existentes
 * (dulabs_especialistas / dulabs_citas_especialista). Mismo patrón que
 * especialistas-flow-adaptador-horarios.test.ts: tenant descartable
 * (randomUUID, nunca el de Daniela), se salta sin credenciales, todo lo
 * creado se borra en after().
 *
 * Cubre los casos 5, 6, 9 y 10 del pedido de Fase 2 (los que dependen de
 * datos reales en DB) más un camino feliz con horario partido y bloqueo --
 * los casos puros (1-4, 7, 8) están en especialistas-disponibilidad.test.ts.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { listarHorariosDisponiblesPorServicio } from "@/lib/disponibilidad-servicio";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "listarHorariosDisponiblesPorServicio — integración real (tenant descartable)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `test-disponibilidad-${Date.now()}`;
    let especialistaConHorarioId: number; // tiene filas en dulabs_horario_especialista (horario partido)
    let especialistaSinHorarioId: number; // sin filas -- respaldo a ventanaAtencion
    let especialistaOtroTenantId: number;
    let servicioId: string;
    let servicioSinEspecialistasId: string;
    const especialistaIds: number[] = [];
    const citaIds: number[] = [];
    const horarioIds: number[] = [];
    const bloqueoIds: number[] = [];

    function proximoMartes(): string {
      const hoy = new Date();
      const diaSemana = hoy.getUTCDay();
      const diasHastaMartes = ((2 - diaSemana + 7) % 7) || 7;
      const fecha = new Date(hoy);
      fecha.setUTCDate(hoy.getUTCDate() + diasHastaMartes);
      return fecha.toISOString().slice(0, 10);
    }
    const FECHA = proximoMartes(); // martes -> dia_semana JS = 2
    const DIA_SEMANA_MARTES = 2;

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const { data: e1, error: e1err } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_A,
          phone_number_id: PHONE_A,
          nombre: "ConHorario",
          numero_whatsapp: "573000000301",
          servicio: "manos",
          duracion_min: 60,
          activo: true,
          bloquea_horario: true,
          es_general: false,
          requiere_aprobacion: false,
        })
        .select("id")
        .single();
      if (e1err) throw e1err;
      especialistaConHorarioId = e1!.id as number;
      especialistaIds.push(especialistaConHorarioId);

      const { data: e2, error: e2err } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_A,
          phone_number_id: PHONE_A,
          nombre: "SinHorario",
          numero_whatsapp: "573000000302",
          servicio: "manos",
          duracion_min: 60,
          activo: true,
          bloquea_horario: true,
          es_general: false,
          requiere_aprobacion: false,
        })
        .select("id")
        .single();
      if (e2err) throw e2err;
      especialistaSinHorarioId = e2!.id as number;
      especialistaIds.push(especialistaSinHorarioId);

      const { data: e3, error: e3err } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_B,
          phone_number_id: `${PHONE_A}-b`,
          nombre: "OtroTenant",
          numero_whatsapp: "573000000303",
          servicio: "manos",
          duracion_min: 60,
          activo: true,
          bloquea_horario: true,
          es_general: false,
          requiere_aprobacion: false,
        })
        .select("id")
        .single();
      if (e3err) throw e3err;
      especialistaOtroTenantId = e3!.id as number;
      especialistaIds.push(especialistaOtroTenantId);

      // Horario partido para ConHorario: 09:00-13:00 y 14:00-18:00 (Caso 7).
      const { data: horarios, error: hErr } = await supabase
        .from("dulabs_horario_especialista")
        .insert([
          { id_tenant: TENANT_A, especialista_id: especialistaConHorarioId, dia_semana: DIA_SEMANA_MARTES, hora_inicio: "09:00", hora_fin: "13:00" },
          { id_tenant: TENANT_A, especialista_id: especialistaConHorarioId, dia_semana: DIA_SEMANA_MARTES, hora_inicio: "14:00", hora_fin: "18:00" },
        ])
        .select("id");
      if (hErr) throw hErr;
      horarioIds.push(...((horarios ?? []) as { id: number }[]).map((h) => h.id));

      const { data: servicio, error: sErr } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_FASE2_servicio", duracion_min: 60 })
        .select("id")
        .single();
      if (sErr) throw sErr;
      servicioId = servicio!.id as string;

      const { data: servicioVacio, error: svErr } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_FASE2_sin_especialistas", duracion_min: 30 })
        .select("id")
        .single();
      if (svErr) throw svErr;
      servicioSinEspecialistasId = servicioVacio!.id as string;

      // Solo ConHorario y SinHorario quedan habilitados para el servicio --
      // OtroTenant NUNCA se asocia (ni podría: es de otro tenant).
      const { error: seErr } = await supabase.from("dulabs_servicio_especialista").insert([
        { id_tenant: TENANT_A, servicio_id: servicioId, especialista_id: especialistaConHorarioId },
        { id_tenant: TENANT_A, servicio_id: servicioId, especialista_id: especialistaSinHorarioId },
      ]);
      if (seErr) throw seErr;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      if (bloqueoIds.length) await supabase.from("dulabs_bloqueos").delete().in("id", bloqueoIds);
      if (horarioIds.length) await supabase.from("dulabs_horario_especialista").delete().in("id", horarioIds);
      await supabase.from("dulabs_servicio_especialista").delete().in("servicio_id", [servicioId, servicioSinEspecialistasId]);
      await supabase.from("dulabs_servicios").delete().in("id", [servicioId, servicioSinEspecialistasId]);
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
    });

    it("camino feliz: dos especialistas habilitados, ConHorario respeta su horario partido (Caso 7), SinHorario respalda a ventanaAtencion", async () => {
      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_A, servicioId, fecha: FECHA });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.servicio.duracionMin, 60);
      assert.equal(r.especialistas.length, 2);

      const conHorario = r.especialistas.find((e) => e.especialistaId === especialistaConHorarioId)!;
      assert.ok(conHorario.horarios.includes("09:00"));
      assert.equal(conHorario.horarios.includes("13:00"), false, "13:00-14:00 es hueco de almuerzo del horario partido");
      assert.ok(conHorario.horarios.includes("14:00"));

      const sinHorario = r.especialistas.find((e) => e.especialistaId === especialistaSinHorarioId)!;
      assert.ok(sinHorario.horarios.includes("09:00"), "sin filas en dulabs_horario_especialista, respalda al horario general 9-19h");
    });

    it("Caso 9: especialista NO asociado al servicio (dulabs_servicio_especialista) nunca aparece", async () => {
      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_A, servicioId, fecha: FECHA });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(
        r.especialistas.some((e) => e.especialistaId === especialistaOtroTenantId),
        false
      );
    });

    it("Caso 9b: servicio sin ningún especialista habilitado -> sin_especialistas_habilitados", async () => {
      const r = await listarHorariosDisponiblesPorServicio(supabase, {
        idTenant: TENANT_A,
        servicioId: servicioSinEspecialistasId,
        fecha: FECHA,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "sin_especialistas_habilitados");
    });

    it("Caso 10: intento cross-tenant -- servicio de tenant A consultado con id_tenant de tenant B no existe", async () => {
      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_B, servicioId, fecha: FECHA });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "servicio_no_encontrado");
    });

    it("Caso 10b: un especialista de otro tenant nunca puede resultar habilitado ni con especialistaId explícito", async () => {
      const r = await listarHorariosDisponiblesPorServicio(supabase, {
        idTenant: TENANT_A,
        servicioId,
        fecha: FECHA,
        especialistaId: especialistaOtroTenantId,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "sin_especialistas_habilitados");
    });

    it("Caso 5 y 6: citas 'completada' y 'cancelada' NO bloquean disponibilidad", async () => {
      const antes = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_A, servicioId, fecha: FECHA });
      assert.equal(antes.ok, true);
      if (!antes.ok) return;
      const horariosAntes = antes.especialistas.find((e) => e.especialistaId === especialistaConHorarioId)!.horarios;
      assert.ok(horariosAntes.includes("10:00"));

      const inicio = new Date(`${FECHA}T10:00:00-05:00`);
      const fin = new Date(`${FECHA}T11:00:00-05:00`);
      const { data: citas, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert([
          {
            especialista_id: especialistaConHorarioId,
            id_tenant: TENANT_A,
            phone_number_id: PHONE_A,
            nombre_cliente: "TEST_FASE2_completada",
            servicio: "manos",
            inicio: inicio.toISOString(),
            fin: fin.toISOString(),
            estado: "completada",
            bloquea_horario: true,
          },
          {
            especialista_id: especialistaConHorarioId,
            id_tenant: TENANT_A,
            phone_number_id: PHONE_A,
            nombre_cliente: "TEST_FASE2_cancelada",
            servicio: "manos",
            inicio: new Date(`${FECHA}T11:00:00-05:00`).toISOString(),
            fin: new Date(`${FECHA}T12:00:00-05:00`).toISOString(),
            estado: "cancelada",
            bloquea_horario: true,
          },
        ])
        .select("id");
      if (error) throw error;
      citaIds.push(...((citas ?? []) as { id: number }[]).map((c) => c.id));

      const despues = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_A, servicioId, fecha: FECHA });
      assert.equal(despues.ok, true);
      if (!despues.ok) return;
      const horariosDespues = despues.especialistas.find((e) => e.especialistaId === especialistaConHorarioId)!.horarios;
      assert.ok(horariosDespues.includes("10:00"), "completada no debe bloquear el horario");
      assert.ok(horariosDespues.includes("11:00"), "cancelada no debe bloquear el horario");
    });

    it("una cita 'confirmada' SÍ bloquea (control: la ocupación real sigue funcionando)", async () => {
      const inicio = new Date(`${FECHA}T15:00:00-05:00`);
      const fin = new Date(`${FECHA}T16:00:00-05:00`);
      const { data: cita, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: especialistaConHorarioId,
          id_tenant: TENANT_A,
          phone_number_id: PHONE_A,
          nombre_cliente: "TEST_FASE2_confirmada",
          servicio: "manos",
          inicio: inicio.toISOString(),
          fin: fin.toISOString(),
          estado: "confirmada",
          bloquea_horario: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      citaIds.push(cita!.id as number);

      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_A, servicioId, fecha: FECHA });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      const horarios = r.especialistas.find((e) => e.especialistaId === especialistaConHorarioId)!.horarios;
      assert.equal(horarios.includes("15:00"), false, "confirmada sí debe bloquear el horario");
    });

    it("Caso 2 (bloqueo real en DB): un bloqueo de dulabs_bloqueos elimina disponibilidad en su rango", async () => {
      const { data: bloqueo, error } = await supabase
        .from("dulabs_bloqueos")
        .insert({
          id_tenant: TENANT_A,
          especialista_id: especialistaSinHorarioId,
          tipo: "almuerzo",
          inicio: new Date(`${FECHA}T12:00:00-05:00`).toISOString(),
          fin: new Date(`${FECHA}T13:00:00-05:00`).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      bloqueoIds.push(bloqueo!.id as number);

      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_A, servicioId, fecha: FECHA });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      const horarios = r.especialistas.find((e) => e.especialistaId === especialistaSinHorarioId)!.horarios;
      assert.equal(horarios.includes("12:00"), false, "el bloqueo debe eliminar el slot de las 12:00");
      assert.ok(horarios.includes("09:00"), "fuera del bloqueo, sigue disponible");
    });
  }
);
