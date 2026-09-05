/**
 * Fase 6A (sistema de reservas de Daniela) — integración REAL de la
 * creación de citas ESTRUCTURADA desde el panel (POST /api/agenda/[token]),
 * reagendamiento con duración forzada por servicio, y compatibilidad con
 * citas legacy (servicio_id NULL). Mismo patrón que los tests anteriores:
 * route handlers llamados directamente, tenant descartable, todo se borra
 * en after().
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import { POST as crearCitaPOST } from "./[token]/route";
import { POST as citaAccionPOST } from "./[token]/citas/[id]/route";
import { PATCH as servicioPATCH } from "./[token]/servicios/[id]/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function paramsFor<T extends Record<string, string>>(vals: T) {
  return { params: Promise.resolve(vals) };
}
function req(url: string, opts?: { method?: string; body?: unknown }) {
  return new NextRequest(url, {
    method: opts?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

describe(
  "Creación estructurada de citas desde el panel (Fase 6A) — API real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `test-6a-${Date.now()}`;
    let tokenA: string;
    let especialistaAId: number;
    let especialistaBId: number;
    let servicioId: string;
    let servicioInactivoId: string;
    let servicioOtroTenantId: string;
    let servicioSinRelacionId: string;

    const especialistaIds: number[] = [];
    const servicioIds: string[] = [];
    const citaIds: number[] = [];

    function proximoMartes(offset = 0): string {
      const hoy = new Date();
      const dia = hoy.getUTCDay();
      const dias = ((2 - dia + 7) % 7) || 7;
      const f = new Date(hoy);
      f.setUTCDate(hoy.getUTCDate() + dias + offset * 7);
      return f.toISOString().slice(0, 10);
    }
    const DIA_SEMANA_MARTES = 2;

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const enUnMes = new Date();
      enUnMes.setMonth(enUnMes.getMonth() + 1);
      await supabase.from("dulabs_suscripciones").insert({
        id_tenant: TENANT_A, plan: "starter", estado: "activa", precio_cop: 0, fecha_proximo_cobro: enUnMes.toISOString().slice(0, 10),
      });

      const { data: eA, error: eAerr } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_A, phone_number_id: PHONE_A, nombre: "6A Reservable", numero_whatsapp: "573000000701",
          servicio: "manos", duracion_min: 60, activo: true, bloquea_horario: true, es_general: false, requiere_aprobacion: false,
        })
        .select("id, token").single();
      if (eAerr) throw eAerr;
      especialistaAId = eA!.id as number;
      tokenA = eA!.token as string;
      especialistaIds.push(especialistaAId);

      const { data: eB, error: eBerr } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_B, phone_number_id: `${PHONE_A}-b`, nombre: "6A OtroTenant", numero_whatsapp: "573000000702",
          servicio: "manos", duracion_min: 60, activo: true, bloquea_horario: true, es_general: false, requiere_aprobacion: false,
        })
        .select("id").single();
      if (eBerr) throw eBerr;
      especialistaBId = eB!.id as number;
      especialistaIds.push(especialistaBId);

      const { error: hErr } = await supabase.from("dulabs_horario_especialista").insert({
        id_tenant: TENANT_A, especialista_id: especialistaAId, dia_semana: DIA_SEMANA_MARTES, hora_inicio: "09:00", hora_fin: "18:00",
      });
      if (hErr) throw hErr;

      const { data: s1, error: s1err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_6A_servicio", duracion_min: 45, activo: true })
        .select("id").single();
      if (s1err) throw s1err;
      servicioId = s1!.id as string;
      servicioIds.push(servicioId);

      const { data: s2, error: s2err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_6A_inactivo", duracion_min: 30, activo: false })
        .select("id").single();
      if (s2err) throw s2err;
      servicioInactivoId = s2!.id as string;
      servicioIds.push(servicioInactivoId);

      const { data: s3, error: s3err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_B, nombre: "TEST_6A_otro_tenant", duracion_min: 30, activo: true })
        .select("id").single();
      if (s3err) throw s3err;
      servicioOtroTenantId = s3!.id as string;
      servicioIds.push(servicioOtroTenantId);

      const { data: s4, error: s4err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_6A_sin_relacion", duracion_min: 30, activo: true })
        .select("id").single();
      if (s4err) throw s4err;
      servicioSinRelacionId = s4!.id as string;
      servicioIds.push(servicioSinRelacionId);

      const { error: seErr } = await supabase
        .from("dulabs_servicio_especialista")
        .insert({ id_tenant: TENANT_A, servicio_id: servicioId, especialista_id: especialistaAId });
      if (seErr) throw seErr;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      await supabase.from("dulabs_idempotencia_reservas").delete().eq("id_tenant", TENANT_A);
      await supabase.from("dulabs_clientes_conocidos").delete().eq("id_tenant", TENANT_A);
      await supabase.from("dulabs_servicio_especialista").delete().in("servicio_id", servicioIds);
      await supabase.from("dulabs_horario_especialista").delete().in("especialista_id", especialistaIds);
      if (servicioIds.length) await supabase.from("dulabs_servicios").delete().in("id", servicioIds);
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
      await supabase.from("dulabs_suscripciones").delete().eq("id_tenant", TENANT_A);
    });

    function crear(body: Record<string, unknown>) {
      return crearCitaPOST(req(`http://x/api/agenda/${tokenA}`, { method: "POST", body }), paramsFor({ token: tokenA }));
    }

    it("A/I/J/K/L. crea con servicio válido -- servicio_id correcto, duración/fin del servicio, snapshot textual", async () => {
      const res = await crear({
        servicioId, especialistaId: especialistaAId, fecha: proximoMartes(), hora: "09:00",
        nombreCliente: "Cliente A", telefonoCliente: "573003330001", idempotencyKey: randomUUID(),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.success, true);
      citaIds.push(body.cita.id);

      assert.equal(body.cita.servicio_id, servicioId, "K: servicio_id debe quedar guardado");
      assert.equal(body.cita.servicio, "TEST_6A_servicio", "L: snapshot textual debe coincidir con el nombre del servicio al crear");
      const duracionReal = (new Date(body.cita.fin).getTime() - new Date(body.cita.inicio).getTime()) / 60000;
      assert.equal(duracionReal, 45, "I/J: duración y fin deben venir del servicio (45 min), no de un valor por defecto");
    });

    it("B. servicio inactivo -> rechazado", async () => {
      const res = await crear({
        servicioId: servicioInactivoId, especialistaId: especialistaAId, fecha: proximoMartes(), hora: "10:00",
        nombreCliente: "Cliente B", idempotencyKey: randomUUID(),
      });
      assert.equal(res.status, 409);
    });

    it("C. profesional no asociado al servicio -> rechazado", async () => {
      const res = await crear({
        servicioId: servicioSinRelacionId, especialistaId: especialistaAId, fecha: proximoMartes(), hora: "10:00",
        nombreCliente: "Cliente C", idempotencyKey: randomUUID(),
      });
      assert.equal(res.status, 409);
    });

    it("D. profesional de otro tenant -> rechazado", async () => {
      const res = await crear({
        servicioId, especialistaId: especialistaBId, fecha: proximoMartes(), hora: "10:00",
        nombreCliente: "Cliente D", idempotencyKey: randomUUID(),
      });
      assert.equal(res.status, 409);
    });

    it("E. servicio de otro tenant -> rechazado", async () => {
      const res = await crear({
        servicioId: servicioOtroTenantId, especialistaId: especialistaAId, fecha: proximoMartes(), hora: "10:00",
        nombreCliente: "Cliente E", idempotencyKey: randomUUID(),
      });
      assert.equal(res.status, 409);
    });

    it("F. slot fuera del horario laboral -> rechazado", async () => {
      const res = await crear({
        servicioId, especialistaId: especialistaAId, fecha: proximoMartes(), hora: "07:00",
        nombreCliente: "Cliente F", idempotencyKey: randomUUID(),
      });
      assert.equal(res.status, 409);
    });

    it("G. slot bloqueado -> rechazado", async () => {
      const fecha = proximoMartes(1);
      const { data: bloqueo, error } = await supabase
        .from("dulabs_bloqueos")
        .insert({ id_tenant: TENANT_A, especialista_id: especialistaAId, tipo: "almuerzo", inicio: `${fecha}T12:00:00-05:00`, fin: `${fecha}T13:00:00-05:00` })
        .select("id").single();
      if (error) throw error;

      const res = await crear({
        servicioId, especialistaId: especialistaAId, fecha, hora: "12:00",
        nombreCliente: "Cliente G", idempotencyKey: randomUUID(),
      });
      assert.equal(res.status, 409);
      await supabase.from("dulabs_bloqueos").delete().eq("id", bloqueo!.id);
    });

    it("H. slot ocupado -> rechazado", async () => {
      const fecha = proximoMartes(1);
      const primera = await crear({
        servicioId, especialistaId: especialistaAId, fecha, hora: "15:00",
        nombreCliente: "Ocupante H", idempotencyKey: randomUUID(),
      });
      const b1 = await primera.json();
      assert.equal(primera.status, 200);
      citaIds.push(b1.cita.id);

      const segunda = await crear({
        servicioId, especialistaId: especialistaAId, fecha, hora: "15:00",
        nombreCliente: "Cliente H", idempotencyKey: randomUUID(),
      });
      assert.equal(segunda.status, 409);
    });

    it("M. doble clic (misma idempotencyKey) nunca duplica la cita", async () => {
      const fecha = proximoMartes(2);
      const key = randomUUID();
      const body = {
        servicioId, especialistaId: especialistaAId, fecha, hora: "09:00",
        nombreCliente: "Cliente M", telefonoCliente: "573003330002", idempotencyKey: key,
      };
      const r1 = await crear(body);
      const b1 = await r1.json();
      const r2 = await crear(body);
      const b2 = await r2.json();
      assert.equal(b1.success, true);
      assert.deepEqual(b1, b2);
      citaIds.push(b1.cita.id);

      const { data: filas } = await supabase.from("dulabs_citas_especialista").select("id").eq("nombre_cliente", "Cliente M");
      assert.equal(filas?.length, 1, "solo debe existir UNA cita pese al doble clic");
    });

    it("N. cita antigua con servicio_id NULL sigue reagendándose y cancelándose sin problema", async () => {
      const fecha = proximoMartes(3);
      const { data: citaLegacy, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: especialistaAId, id_tenant: TENANT_A, phone_number_id: PHONE_A, telefono_cliente: "573003330003",
          nombre_cliente: "TEST_6A_legacy", servicio: "manicure clásica", inicio: `${fecha}T10:00:00-05:00`, fin: `${fecha}T11:00:00-05:00`,
          estado: "confirmada", bloquea_horario: true,
        })
        .select("id").single();
      if (error) throw error;
      citaIds.push(citaLegacy!.id as number);
      assert.equal((citaLegacy as { servicio_id?: string }).servicio_id ?? null, null);

      const reagendar = await citaAccionPOST(
        req(`http://x/api/agenda/${tokenA}/citas/${citaLegacy!.id}`, {
          method: "POST",
          body: { accion: "editar", nuevo_inicio: `${fecha}T13:00:00-05:00`, duracion_min: 90, servicio: "manicure clásica editada" },
        }),
        paramsFor({ token: tokenA, id: String(citaLegacy!.id) })
      );
      const bReagendar = await reagendar.json();
      assert.equal(reagendar.status, 200);
      assert.equal(bReagendar.cita.servicio, "manicure clásica editada", "una cita legacy SÍ puede editar su texto libre");

      const cancelar = await citaAccionPOST(
        req(`http://x/api/agenda/${tokenA}/citas/${citaLegacy!.id}`, { method: "POST", body: { accion: "cancelar" } }),
        paramsFor({ token: tokenA, id: String(citaLegacy!.id) })
      );
      assert.equal(cancelar.status, 200);
    });

    it("O. reagendar una cita estructurada mantiene servicio/duración pese a un duracion_min distinto enviado", async () => {
      const fecha = proximoMartes(4);
      const creada = await crear({
        servicioId, especialistaId: especialistaAId, fecha, hora: "09:00",
        nombreCliente: "Cliente O", idempotencyKey: randomUUID(),
      });
      const bCreada = await creada.json();
      assert.equal(creada.status, 200);
      citaIds.push(bCreada.cita.id);

      const editar = await citaAccionPOST(
        req(`http://x/api/agenda/${tokenA}/citas/${bCreada.cita.id}`, {
          method: "POST",
          body: { accion: "editar", nuevo_inicio: `${fecha}T11:00:00-05:00`, duracion_min: 999, servicio: "Intento de renombrar" },
        }),
        paramsFor({ token: tokenA, id: String(bCreada.cita.id) })
      );
      const bEditar = await editar.json();
      assert.equal(editar.status, 200);
      const duracionTrasEditar = (new Date(bEditar.cita.fin).getTime() - new Date(bEditar.cita.inicio).getTime()) / 60000;
      assert.equal(duracionTrasEditar, 45, "la duración forzada del servicio (45 min) ignora el 999 enviado");
      assert.equal(bEditar.cita.servicio, "TEST_6A_servicio", "el snapshot textual de una cita estructurada no se deja renombrar desde editar");
    });

    it("P. desactivar el servicio después de crear la cita no afecta la cita histórica", async () => {
      const fecha = proximoMartes(5);
      const creada = await crear({
        servicioId, especialistaId: especialistaAId, fecha, hora: "09:00",
        nombreCliente: "Cliente P", idempotencyKey: randomUUID(),
      });
      const bCreada = await creada.json();
      assert.equal(creada.status, 200);
      citaIds.push(bCreada.cita.id);

      const desactivar = await servicioPATCH(
        req(`http://x/api/agenda/${tokenA}/servicios/${servicioId}`, { method: "PATCH", body: { activo: false } }),
        paramsFor({ token: tokenA, id: servicioId })
      );
      assert.equal(desactivar.status, 200);

      const { data: citaHistorica } = await supabase.from("dulabs_citas_especialista").select("*").eq("id", bCreada.cita.id).single();
      assert.equal(citaHistorica!.servicio, "TEST_6A_servicio", "la cita histórica sigue visible con su snapshot intacto");
      assert.equal(citaHistorica!.servicio_id, servicioId);

      // se reactiva para no afectar otras pruebas que reutilizan servicioId
      await servicioPATCH(
        req(`http://x/api/agenda/${tokenA}/servicios/${servicioId}`, { method: "PATCH", body: { activo: true } }),
        paramsFor({ token: tokenA, id: servicioId })
      );
    });
  }
);
