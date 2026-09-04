/**
 * Fase 3 (sistema de reservas de Daniela) — integración REAL del núcleo
 * transaccional (reservarCitaPorServicio / reagendarCitaPorServicio /
 * cancelarCitaPorServicio) contra el modelo de datos de las Fases 1 y 2.
 * Mismo patrón que los archivos de test anteriores: tenant descartable
 * (randomUUID, nunca el de Daniela), se salta sin credenciales, todo lo
 * creado se borra en after().
 *
 * Cubre los puntos A-R del pedido de Fase 3 (S -- "legacy sigue
 * funcionando" -- se verifica corriendo la suite completa existente, no acá).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  reservarCitaPorServicio,
  reagendarCitaPorServicio,
  cancelarCitaPorServicio,
} from "@/lib/disponibilidad-servicio";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "reservarCitaPorServicio / reagendarCitaPorServicio / cancelarCitaPorServicio — integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `test-reserva-${Date.now()}`;
    let especialistaId: number;
    let especialistaInactivoId: number;
    let especialistaOtroTenantId: number;
    let servicioId: string;
    let servicioInactivoId: string;
    let servicioOtroTenantId: string;
    let servicioSinRelacionId: string; // existe, activo, pero SIN fila en dulabs_servicio_especialista con especialistaId

    const especialistaIds: number[] = [];
    const servicioIds: string[] = [];
    const citaIds: number[] = [];

    function proximoMartes(offsetSemanas = 0): string {
      const hoy = new Date();
      const diaSemana = hoy.getUTCDay();
      const diasHastaMartes = ((2 - diaSemana + 7) % 7) || 7;
      const fecha = new Date(hoy);
      fecha.setUTCDate(hoy.getUTCDate() + diasHastaMartes + offsetSemanas * 7);
      return fecha.toISOString().slice(0, 10);
    }
    const FECHA = proximoMartes();
    const DIA_SEMANA_MARTES = 2;

    function inicioEn(hhmm: string, fecha = FECHA): Date {
      return new Date(`${fecha}T${hhmm}:00-05:00`);
    }

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      await supabase.from("dulabs_servicio_especialista").delete().in("servicio_id", servicioIds);
      await supabase.from("dulabs_horario_especialista").delete().in("especialista_id", especialistaIds);
      await supabase.from("dulabs_bloqueos").delete().in("especialista_id", especialistaIds);
      if (servicioIds.length) await supabase.from("dulabs_servicios").delete().in("id", servicioIds);
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
    });

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const { data: e1, error: e1err } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_A,
          phone_number_id: PHONE_A,
          nombre: "Reservable",
          numero_whatsapp: "573000000401",
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
      especialistaId = e1!.id as number;
      especialistaIds.push(especialistaId);

      const { data: e2, error: e2err } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_A,
          phone_number_id: PHONE_A,
          nombre: "Inactivo",
          numero_whatsapp: "573000000402",
          servicio: "manos",
          duracion_min: 60,
          activo: false,
          bloquea_horario: true,
          es_general: false,
          requiere_aprobacion: false,
        })
        .select("id")
        .single();
      if (e2err) throw e2err;
      especialistaInactivoId = e2!.id as number;
      especialistaIds.push(especialistaInactivoId);

      const { data: e3, error: e3err } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_B,
          phone_number_id: `${PHONE_A}-b`,
          nombre: "OtroTenant",
          numero_whatsapp: "573000000403",
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

      // Horario laboral real: martes 09:00-18:00 -- así podemos probar
      // "fuera de horario" de forma determinista (no depende del respaldo a
      // ventanaAtencion, que también sería 9-19h un martes y confundiría la
      // prueba K).
      const { error: hErr } = await supabase
        .from("dulabs_horario_especialista")
        .insert({ id_tenant: TENANT_A, especialista_id: especialistaId, dia_semana: DIA_SEMANA_MARTES, hora_inicio: "09:00", hora_fin: "18:00" });
      if (hErr) throw hErr;

      const { data: s1, error: s1err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_FASE3_servicio", duracion_min: 60, activo: true })
        .select("id")
        .single();
      if (s1err) throw s1err;
      servicioId = s1!.id as string;
      servicioIds.push(servicioId);

      const { data: s2, error: s2err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_FASE3_inactivo", duracion_min: 30, activo: false })
        .select("id")
        .single();
      if (s2err) throw s2err;
      servicioInactivoId = s2!.id as string;
      servicioIds.push(servicioInactivoId);

      const { data: s3, error: s3err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_B, nombre: "TEST_FASE3_otro_tenant", duracion_min: 45, activo: true })
        .select("id")
        .single();
      if (s3err) throw s3err;
      servicioOtroTenantId = s3!.id as string;
      servicioIds.push(servicioOtroTenantId);

      const { data: s4, error: s4err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_FASE3_sin_relacion", duracion_min: 30, activo: true })
        .select("id")
        .single();
      if (s4err) throw s4err;
      servicioSinRelacionId = s4!.id as string;
      servicioIds.push(servicioSinRelacionId);

      const { error: seErr } = await supabase
        .from("dulabs_servicio_especialista")
        .insert({ id_tenant: TENANT_A, servicio_id: servicioId, especialista_id: especialistaId });
      if (seErr) throw seErr;
    });

    it("A. servicio válido + especialista habilitado -> OK", async () => {
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110001",
        nombreCliente: "Cliente A",
        inicio: inicioEn("09:00"),
      });
      assert.equal(r.ok, true);
      if (r.ok) {
        citaIds.push(r.cita.id);
        assert.equal(r.cita.estado, "pendiente"); // requiere_aprobacion=false pero crearCitaEspecialista no auto-confirma -- solo el caller final decide
        assert.equal(r.cita.servicio_id, servicioId);
      }
    });

    it("B. servicio inexistente -> rechazado", async () => {
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId: randomUUID(),
        telefonoCliente: "573001110002",
        nombreCliente: "Cliente B",
        inicio: inicioEn("10:00"),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "servicio_no_encontrado");
    });

    it("C. servicio de otro tenant -> rechazado", async () => {
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId: servicioOtroTenantId,
        telefonoCliente: "573001110003",
        nombreCliente: "Cliente C",
        inicio: inicioEn("10:00"),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "servicio_no_encontrado");
    });

    it("D. especialista de otro tenant -> rechazado", async () => {
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId: especialistaOtroTenantId,
        servicioId,
        telefonoCliente: "573001110004",
        nombreCliente: "Cliente D",
        inicio: inicioEn("10:00"),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "especialista_no_encontrado");
    });

    it("E. especialista no habilitado para el servicio -> rechazado", async () => {
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId: servicioSinRelacionId,
        telefonoCliente: "573001110005",
        nombreCliente: "Cliente E",
        inicio: inicioEn("10:00"),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "especialista_no_habilitado");
    });

    it("F. servicio inactivo -> rechazado", async () => {
      // servicioInactivoId no tiene relación con especialistaId tampoco, pero
      // debe fallar por servicio_no_encontrado ANTES de siquiera mirar la relación.
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId: servicioInactivoId,
        telefonoCliente: "573001110006",
        nombreCliente: "Cliente F",
        inicio: inicioEn("10:00"),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "servicio_no_encontrado");
    });

    it("G. especialista inactivo -> rechazado", async () => {
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId: especialistaInactivoId,
        servicioId,
        telefonoCliente: "573001110007",
        nombreCliente: "Cliente G",
        inicio: inicioEn("10:00"),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "especialista_no_encontrado");
    });

    it("H. la duración se obtiene del servicio (60 min), nunca de un parámetro externo", async () => {
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110008",
        nombreCliente: "Cliente H",
        inicio: inicioEn("11:00"),
      });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      citaIds.push(r.cita.id);
      assert.equal(r.servicio.duracionMin, 60);
    });

    it("I. el fin se calcula automáticamente como inicio + duración del servicio", async () => {
      const inicio = inicioEn("12:00");
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110009",
        nombreCliente: "Cliente I",
        inicio,
      });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      citaIds.push(r.cita.id);
      const finEsperado = new Date(inicio.getTime() + 60 * 60_000);
      assert.equal(new Date(r.cita.fin).getTime(), finEsperado.getTime());
    });

    it("J. no existe ningún parámetro para pasar una duración distinta (garantía de tipo) -- aun forzando el tipo con datos extra, el resultado usa la del servicio", async () => {
      const inicio = inicioEn("13:00");
      const paramsConDuracionInventada = {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110010",
        nombreCliente: "Cliente J",
        inicio,
        duracionMin: 999, // no existe en el tipo -- se prueba que igual se ignora
      };
      const r = await reservarCitaPorServicio(supabase, paramsConDuracionInventada as unknown as Parameters<typeof reservarCitaPorServicio>[1]);
      assert.equal(r.ok, true);
      if (!r.ok) return;
      citaIds.push(r.cita.id);
      const finEsperado = new Date(inicio.getTime() + 60 * 60_000);
      assert.equal(new Date(r.cita.fin).getTime(), finEsperado.getTime(), "el 'duracionMin' inventado nunca se usa");
    });

    it("K. horario fuera de la jornada laboral -> rechazado", async () => {
      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110011",
        nombreCliente: "Cliente K",
        inicio: inicioEn("07:00"), // jornada real configurada es 09:00-18:00
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "fuera_de_horario");
    });

    it("L. horario dentro de un bloqueo -> rechazado", async () => {
      const { data: bloqueo, error } = await supabase
        .from("dulabs_bloqueos")
        .insert({
          id_tenant: TENANT_A,
          especialista_id: especialistaId,
          tipo: "almuerzo",
          inicio: inicioEn("14:00").toISOString(),
          fin: inicioEn("15:00").toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;

      const r = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110012",
        nombreCliente: "Cliente L",
        inicio: inicioEn("14:00"),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "bloqueado");

      await supabase.from("dulabs_bloqueos").delete().eq("id", bloqueo!.id);
    });

    it("M. horario ya ocupado por otra cita -> rechazado (validación previa)", async () => {
      const primera = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110013",
        nombreCliente: "Ocupante M",
        inicio: inicioEn("16:00"),
      });
      assert.equal(primera.ok, true);
      if (primera.ok) citaIds.push(primera.cita.id);

      const segunda = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110014",
        nombreCliente: "Cliente M",
        inicio: inicioEn("16:00"),
      });
      assert.equal(segunda.ok, false);
      if (!segunda.ok) assert.equal(segunda.motivo, "ocupado");
    });

    it("N. carrera de doble reserva -- una gana, la otra recibe 'ocupado' vía el EXCLUDE real (23P01)", async () => {
      const inicio = inicioEn("09:00", proximoMartes(1)); // semana distinta, sin choques de otras pruebas
      const [r1, r2] = await Promise.all([
        reservarCitaPorServicio(supabase, {
          idTenant: TENANT_A,
          especialistaId,
          servicioId,
          telefonoCliente: "573001110015",
          nombreCliente: "Carrera 1",
          inicio,
        }),
        reservarCitaPorServicio(supabase, {
          idTenant: TENANT_A,
          especialistaId,
          servicioId,
          telefonoCliente: "573001110016",
          nombreCliente: "Carrera 2",
          inicio,
        }),
      ]);
      const resultados = [r1, r2];
      const ganadoras = resultados.filter((r) => r.ok);
      const perdedoras = resultados.filter((r) => !r.ok);
      assert.equal(ganadoras.length, 1, "exactamente una de las dos debe ganar");
      assert.equal(perdedoras.length, 1);
      if (ganadoras[0]!.ok) citaIds.push(ganadoras[0]!.cita.id);
      const perdedora = perdedoras[0]!;
      if (!perdedora.ok) assert.equal(perdedora.motivo, "ocupado");
    });

    it("O. cancelar una cita libera su disponibilidad", async () => {
      const inicio = inicioEn("10:00", proximoMartes(1));
      const creada = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110017",
        nombreCliente: "Cliente O",
        inicio,
      });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;
      citaIds.push(creada.cita.id);

      const bloqueada = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110018",
        nombreCliente: "Cliente O2",
        inicio,
      });
      assert.equal(bloqueada.ok, false);

      const cancelada = await cancelarCitaPorServicio(supabase, { idTenant: TENANT_A, citaId: creada.cita.id });
      assert.equal(cancelada.ok, true);
      if (cancelada.ok) assert.equal(cancelada.cita.estado, "cancelada");

      const libre = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110019",
        nombreCliente: "Cliente O3",
        inicio,
      });
      assert.equal(libre.ok, true, "tras cancelar, el mismo horario debe volver a estar disponible");
      if (libre.ok) citaIds.push(libre.cita.id);
    });

    it("P. reagendar conserva la MISMA fila (mismo id)", async () => {
      const inicio = inicioEn("11:00", proximoMartes(1));
      const creada = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110020",
        nombreCliente: "Cliente P",
        inicio,
      });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;
      citaIds.push(creada.cita.id);

      // reagendarCitaPorServicio exige estado='confirmada' -- se confirma
      // primero, como haría el flujo real tras aprobar la solicitud.
      await supabase.from("dulabs_citas_especialista").update({ estado: "confirmada" }).eq("id", creada.cita.id);

      const nuevoInicio = inicioEn("13:00", proximoMartes(1));
      const reagendada = await reagendarCitaPorServicio(supabase, { idTenant: TENANT_A, citaId: creada.cita.id, nuevoInicio });
      assert.equal(reagendada.ok, true);
      if (!reagendada.ok) return;
      assert.equal(reagendada.cita.id, creada.cita.id, "debe ser la MISMA fila, no una nueva");
    });

    it("Q. reagendar recalcula el fin usando la duración del servicio de la cita", async () => {
      const inicio = inicioEn("09:00", proximoMartes(2));
      const creada = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId, // duración 60 min
        telefonoCliente: "573001110021",
        nombreCliente: "Cliente Q",
        inicio,
      });
      assert.equal(creada.ok, true);
      if (!creada.ok) return;
      citaIds.push(creada.cita.id);
      await supabase.from("dulabs_citas_especialista").update({ estado: "confirmada" }).eq("id", creada.cita.id);

      const nuevoInicio = inicioEn("11:00", proximoMartes(2));
      const reagendada = await reagendarCitaPorServicio(supabase, { idTenant: TENANT_A, citaId: creada.cita.id, nuevoInicio });
      assert.equal(reagendada.ok, true);
      if (!reagendada.ok) return;
      const finEsperado = new Date(nuevoInicio.getTime() + 60 * 60_000);
      assert.equal(new Date(reagendada.cita.fin).getTime(), finEsperado.getTime());
    });

    it("R. una cita 'completada' no bloquea una nueva reserva en el mismo horario", async () => {
      const inicio = inicioEn("15:00", proximoMartes(2));
      const vieja = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110022",
        nombreCliente: "Cliente R viejo",
        inicio,
      });
      assert.equal(vieja.ok, true);
      if (!vieja.ok) return;
      citaIds.push(vieja.cita.id);
      await supabase.from("dulabs_citas_especialista").update({ estado: "completada" }).eq("id", vieja.cita.id);

      const nueva = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_A,
        especialistaId,
        servicioId,
        telefonoCliente: "573001110023",
        nombreCliente: "Cliente R nuevo",
        inicio,
      });
      assert.equal(nueva.ok, true, "una cita completada no debe bloquear el mismo horario");
      if (nueva.ok) citaIds.push(nueva.cita.id);
    });
  }
);
