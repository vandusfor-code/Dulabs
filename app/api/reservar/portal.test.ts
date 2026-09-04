/**
 * Fase 4 (sistema de reservas de Daniela) — portal público de reservas.
 * Integración REAL contra Supabase (tenant descartable, randomUUID, nunca
 * el de Daniela) llamando los route handlers DIRECTAMENTE (mismo patrón que
 * app/api/flows/flows-api.test.ts): construir un NextRequest real y pasar
 * los params como Promise, sin mocks del código bajo prueba.
 *
 * Cubre A-P del pedido de Fase 4.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import { GET as bootstrapGET, POST as reservarPOST } from "./[tenant]/route";
import { GET as especialistasGET } from "./[tenant]/especialistas/route";
import { GET as disponibilidadGET } from "./[tenant]/disponibilidad/route";
import { cancelarCitaPorServicio } from "@/lib/disponibilidad-servicio";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function paramsFor(tenant: string) {
  return { params: Promise.resolve({ tenant }) };
}

function req(url: string, opts?: { method?: string; body?: unknown }) {
  return new NextRequest(url, {
    method: opts?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

describe(
  "Portal de reservas (Fase 4) — API pública, integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `test-portal-${Date.now()}`;
    let especialistaId: number;
    let especialistaInactivoId: number;
    let servicioActivoId: string;
    let servicioInactivoId: string;
    let servicioOtroTenantId: string;
    let servicioSinEspecialistaId: string;

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

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      // Suscripción activa -- sin esto planDelTenant devuelve SIN_PLAN y el
      // portal se reporta como no disponible (comportamiento correcto, pero
      // no es lo que estas pruebas quieren ejercitar).
      const enUnMes = new Date();
      enUnMes.setMonth(enUnMes.getMonth() + 1);
      const { error: susErr } = await supabase.from("dulabs_suscripciones").insert({
        id_tenant: TENANT_A,
        plan: "starter",
        estado: "activa",
        precio_cop: 0,
        fecha_proximo_cobro: enUnMes.toISOString().slice(0, 10),
      });
      if (susErr) throw susErr;

      const { data: e1, error: e1err } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_A, phone_number_id: PHONE_A, nombre: "Portal Reservable", numero_whatsapp: "573000000501",
          servicio: "manos", duracion_min: 60, activo: true, bloquea_horario: true, es_general: false, requiere_aprobacion: false,
        })
        .select("id").single();
      if (e1err) throw e1err;
      especialistaId = e1!.id as number;
      especialistaIds.push(especialistaId);

      const { data: e2, error: e2err } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_A, phone_number_id: PHONE_A, nombre: "Portal Inactivo", numero_whatsapp: "573000000502",
          servicio: "manos", duracion_min: 60, activo: false, bloquea_horario: true, es_general: false, requiere_aprobacion: false,
        })
        .select("id").single();
      if (e2err) throw e2err;
      especialistaInactivoId = e2!.id as number;
      especialistaIds.push(especialistaInactivoId);

      const { error: hErr } = await supabase
        .from("dulabs_horario_especialista")
        .insert({ id_tenant: TENANT_A, especialista_id: especialistaId, dia_semana: DIA_SEMANA_MARTES, hora_inicio: "09:00", hora_fin: "18:00" });
      if (hErr) throw hErr;

      const { data: s1, error: s1err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_PORTAL_activo", duracion_min: 60, precio: 50000, activo: true })
        .select("id").single();
      if (s1err) throw s1err;
      servicioActivoId = s1!.id as string;
      servicioIds.push(servicioActivoId);

      const { data: s2, error: s2err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_PORTAL_inactivo", duracion_min: 30, activo: false })
        .select("id").single();
      if (s2err) throw s2err;
      servicioInactivoId = s2!.id as string;
      servicioIds.push(servicioInactivoId);

      const { data: s3, error: s3err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_B, nombre: "TEST_PORTAL_otro_tenant", duracion_min: 45, activo: true })
        .select("id").single();
      if (s3err) throw s3err;
      servicioOtroTenantId = s3!.id as string;
      servicioIds.push(servicioOtroTenantId);

      const { data: s4, error: s4err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_PORTAL_sin_especialista", duracion_min: 30, activo: true })
        .select("id").single();
      if (s4err) throw s4err;
      servicioSinEspecialistaId = s4!.id as string;
      servicioIds.push(servicioSinEspecialistaId);

      const { error: seErr } = await supabase
        .from("dulabs_servicio_especialista")
        .insert({ id_tenant: TENANT_A, servicio_id: servicioActivoId, especialista_id: especialistaId });
      if (seErr) throw seErr;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      await supabase.from("dulabs_idempotencia_reservas").delete().in("id_tenant", [TENANT_A, TENANT_B]);
      await supabase.from("dulabs_servicio_especialista").delete().in("servicio_id", servicioIds);
      await supabase.from("dulabs_horario_especialista").delete().in("especialista_id", especialistaIds);
      await supabase.from("dulabs_bloqueos").delete().in("especialista_id", especialistaIds);
      if (servicioIds.length) await supabase.from("dulabs_servicios").delete().in("id", servicioIds);
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
      await supabase.from("dulabs_suscripciones").delete().eq("id_tenant", TENANT_A);
    });

    it("A/B/C. GET bootstrap: solo servicios activos, del tenant correcto", async () => {
      const res = await bootstrapGET(req(`http://localhost/api/reservar/${TENANT_A}`), paramsFor(TENANT_A));
      const body = await res.json();
      assert.equal(body.disponible, true);
      const nombres = body.servicios.map((s: { nombre: string }) => s.nombre);
      assert.ok(nombres.includes("TEST_PORTAL_activo"), "B/A: servicio activo debe aparecer");
      assert.equal(nombres.includes("TEST_PORTAL_inactivo"), false, "B: servicio inactivo NO debe aparecer");
      assert.equal(nombres.includes("TEST_PORTAL_otro_tenant"), false, "C: servicio de otro tenant NO debe aparecer");
    });

    it("D/E. GET especialistas: solo los habilitados y activos para el servicio", async () => {
      const res = await especialistasGET(
        req(`http://localhost/api/reservar/${TENANT_A}/especialistas?servicioId=${servicioActivoId}`),
        paramsFor(TENANT_A)
      );
      const body = await res.json();
      const ids = body.especialistas.map((e: { id: number }) => e.id);
      assert.ok(ids.includes(especialistaId), "D: el especialista habilitado debe aparecer");
      assert.equal(ids.includes(especialistaInactivoId), false, "E: un especialista sin relación no debe aparecer");
    });

    it("E2. servicio sin ningún especialista habilitado -> lista vacía", async () => {
      const res = await especialistasGET(
        req(`http://localhost/api/reservar/${TENANT_A}/especialistas?servicioId=${servicioSinEspecialistaId}`),
        paramsFor(TENANT_A)
      );
      const body = await res.json();
      assert.deepEqual(body.especialistas, []);
    });

    it("F/I. GET disponibilidad: slots reales respetando la duración del servicio (60 min)", async () => {
      const res = await disponibilidadGET(
        req(`http://localhost/api/reservar/${TENANT_A}/disponibilidad?servicioId=${servicioActivoId}&fecha=${FECHA}&especialistaId=${especialistaId}`),
        paramsFor(TENANT_A)
      );
      const body = await res.json();
      assert.equal(body.servicio.duracionMin, 60);
      const horarios: string[] = body.especialistas[0].horarios;
      assert.ok(horarios.includes("09:00"));
      assert.equal(horarios.includes("17:30"), false, "17:30 + 60min = 18:30, no cabe en la jornada 09-18h");
    });

    it("G. un bloqueo real elimina el slot correspondiente", async () => {
      const { data: bloqueo, error } = await supabase
        .from("dulabs_bloqueos")
        .insert({ id_tenant: TENANT_A, especialista_id: especialistaId, tipo: "almuerzo", inicio: `${FECHA}T12:00:00-05:00`, fin: `${FECHA}T13:00:00-05:00` })
        .select("id").single();
      if (error) throw error;

      const res = await disponibilidadGET(
        req(`http://localhost/api/reservar/${TENANT_A}/disponibilidad?servicioId=${servicioActivoId}&fecha=${FECHA}&especialistaId=${especialistaId}`),
        paramsFor(TENANT_A)
      );
      const body = await res.json();
      assert.equal(body.especialistas[0].horarios.includes("12:00"), false);

      await supabase.from("dulabs_bloqueos").delete().eq("id", bloqueo!.id);
    });

    it("H. una cita real elimina el slot ocupado", async () => {
      const inicio = `${FECHA}T10:00:00-05:00`;
      const { data: cita, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: especialistaId, id_tenant: TENANT_A, phone_number_id: PHONE_A,
          nombre_cliente: "TEST_PORTAL_ocupante", servicio: "manos", inicio, fin: `${FECHA}T11:00:00-05:00`,
          estado: "confirmada", bloquea_horario: true,
        })
        .select("id").single();
      if (error) throw error;
      citaIds.push(cita!.id as number);

      const res = await disponibilidadGET(
        req(`http://localhost/api/reservar/${TENANT_A}/disponibilidad?servicioId=${servicioActivoId}&fecha=${FECHA}&especialistaId=${especialistaId}`),
        paramsFor(TENANT_A)
      );
      const body = await res.json();
      assert.equal(body.especialistas[0].horarios.includes("10:00"), false);
    });

    it("J. POST reservar crea la cita correctamente", async () => {
      const res = await reservarPOST(
        req(`http://localhost/api/reservar/${TENANT_A}`, {
          method: "POST",
          body: {
            servicioId: servicioActivoId, especialistaId, fecha: proximoMartes(1), hora: "09:00",
            nombreCliente: "Cliente Portal J", telefonoCliente: "573002220001", idempotencyKey: randomUUID(),
          },
        }),
        paramsFor(TENANT_A)
      );
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.success, true);
      assert.ok(body.codigo.startsWith("R-"));
      assert.equal(body.servicio, "TEST_PORTAL_activo");

      const { data: filas } = await supabase
        .from("dulabs_citas_especialista")
        .select("id")
        .eq("nombre_cliente", "Cliente Portal J");
      citaIds.push(...(filas ?? []).map((f) => f.id as number));
    });

    it("K. doble reserva simultánea -- una gana, la otra recibe mensaje amigable de 'ocupado'", async () => {
      const fecha = proximoMartes(1);
      const bodyBase = {
        servicioId: servicioActivoId, especialistaId, fecha, hora: "10:00",
        telefonoCliente: "573002220002",
      };
      const [r1, r2] = await Promise.all([
        reservarPOST(
          req(`http://localhost/api/reservar/${TENANT_A}`, {
            method: "POST",
            body: { ...bodyBase, nombreCliente: "Carrera K1", idempotencyKey: randomUUID() },
          }),
          paramsFor(TENANT_A)
        ),
        reservarPOST(
          req(`http://localhost/api/reservar/${TENANT_A}`, {
            method: "POST",
            body: { ...bodyBase, nombreCliente: "Carrera K2", idempotencyKey: randomUUID() },
          }),
          paramsFor(TENANT_A)
        ),
      ]);
      const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
      const exitosas = [b1, b2].filter((b) => b.success);
      const fallidas = [b1, b2].filter((b) => !b.success);
      assert.equal(exitosas.length, 1);
      assert.equal(fallidas.length, 1);
      assert.match(fallidas[0].error, /reservado|ocupado/i);

      const { data: filas } = await supabase
        .from("dulabs_citas_especialista")
        .select("id")
        .in("nombre_cliente", ["Carrera K1", "Carrera K2"]);
      citaIds.push(...(filas ?? []).map((f) => f.id as number));
    });

    it("L. el slot se ocupa entre que se muestra y se confirma -> mensaje amigable, nunca un 500 crudo", async () => {
      const fecha = proximoMartes(1);
      const inicio = `${fecha}T11:00:00-05:00`;
      const { data: cita, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: especialistaId, id_tenant: TENANT_A, phone_number_id: PHONE_A,
          nombre_cliente: "TEST_PORTAL_tomado_mientras_miraba", servicio: "manos", inicio, fin: `${fecha}T12:00:00-05:00`,
          estado: "confirmada", bloquea_horario: true,
        })
        .select("id").single();
      if (error) throw error;
      citaIds.push(cita!.id as number);

      const res = await reservarPOST(
        req(`http://localhost/api/reservar/${TENANT_A}`, {
          method: "POST",
          body: {
            servicioId: servicioActivoId, especialistaId, fecha, hora: "11:00",
            nombreCliente: "Cliente Tarde", telefonoCliente: "573002220003", idempotencyKey: randomUUID(),
          },
        }),
        paramsFor(TENANT_A)
      );
      const body = await res.json();
      assert.equal(res.status, 409);
      assert.equal(body.success, undefined);
      assert.equal(body.error, "Este horario acaba de ser reservado. Por favor selecciona otro.");
    });

    it("M. idempotencia: la MISMA idempotencyKey con los MISMOS datos nunca duplica la cita", async () => {
      const fecha = proximoMartes(2);
      const key = randomUUID();
      const body = {
        servicioId: servicioActivoId, especialistaId, fecha, hora: "09:00",
        nombreCliente: "Cliente Idempotente M", telefonoCliente: "573002220004", idempotencyKey: key,
      };
      const r1 = await reservarPOST(req(`http://localhost/api/reservar/${TENANT_A}`, { method: "POST", body }), paramsFor(TENANT_A));
      const b1 = await r1.json();
      const r2 = await reservarPOST(req(`http://localhost/api/reservar/${TENANT_A}`, { method: "POST", body }), paramsFor(TENANT_A));
      const b2 = await r2.json();

      assert.equal(b1.success, true);
      assert.deepEqual(b1, b2, "el retry debe recibir EXACTAMENTE la misma respuesta");

      const { data: filas } = await supabase
        .from("dulabs_citas_especialista")
        .select("id")
        .eq("nombre_cliente", "Cliente Idempotente M");
      assert.equal(filas?.length, 1, "solo debe existir UNA cita, no dos");
      citaIds.push(...(filas ?? []).map((f) => f.id as number));
    });

    it("N. la MISMA idempotencyKey con datos DISTINTOS se rechaza (nunca reutiliza el resultado de otra solicitud)", async () => {
      const fecha = proximoMartes(2);
      const key = randomUUID();
      const primera = await reservarPOST(
        req(`http://localhost/api/reservar/${TENANT_A}`, {
          method: "POST",
          body: { servicioId: servicioActivoId, especialistaId, fecha, hora: "10:00", nombreCliente: "N primero", telefonoCliente: "573002220005", idempotencyKey: key },
        }),
        paramsFor(TENANT_A)
      );
      const bp = await primera.json();
      assert.equal(bp.success, true);
      citaIds.push(...((await supabase.from("dulabs_citas_especialista").select("id").eq("nombre_cliente", "N primero")).data ?? []).map((f) => f.id as number));

      const segunda = await reservarPOST(
        req(`http://localhost/api/reservar/${TENANT_A}`, {
          method: "POST",
          body: { servicioId: servicioActivoId, especialistaId, fecha, hora: "13:00", nombreCliente: "N distinto", telefonoCliente: "573002220006", idempotencyKey: key },
        }),
        paramsFor(TENANT_A)
      );
      const bs = await segunda.json();
      assert.equal(segunda.status, 409);
      assert.match(bs.error, /procesó con datos diferentes/);

      const { data: filas } = await supabase.from("dulabs_citas_especialista").select("id").eq("nombre_cliente", "N distinto");
      assert.equal(filas?.length ?? 0, 0, "la segunda solicitud NUNCA debe haber creado una cita");
    });

    it("O. cancelar una cita (cancelarCitaPorServicio) libera el slot en el portal", async () => {
      const fecha = proximoMartes(3);
      const crear = await reservarPOST(
        req(`http://localhost/api/reservar/${TENANT_A}`, {
          method: "POST",
          body: { servicioId: servicioActivoId, especialistaId, fecha, hora: "14:00", nombreCliente: "Cliente O", telefonoCliente: "573002220007", idempotencyKey: randomUUID() },
        }),
        paramsFor(TENANT_A)
      );
      const bc = await crear.json();
      assert.equal(bc.success, true);
      const { data: filas } = await supabase.from("dulabs_citas_especialista").select("id").eq("nombre_cliente", "Cliente O");
      const citaId = filas![0]!.id as number;
      citaIds.push(citaId);

      const antes = await disponibilidadGET(
        req(`http://localhost/api/reservar/${TENANT_A}/disponibilidad?servicioId=${servicioActivoId}&fecha=${fecha}&especialistaId=${especialistaId}`),
        paramsFor(TENANT_A)
      );
      const bAntes = await antes.json();
      assert.equal(bAntes.especialistas[0].horarios.includes("14:00"), false);

      const cancelada = await cancelarCitaPorServicio(supabase, { idTenant: TENANT_A, citaId });
      assert.equal(cancelada.ok, true);

      const despues = await disponibilidadGET(
        req(`http://localhost/api/reservar/${TENANT_A}/disponibilidad?servicioId=${servicioActivoId}&fecha=${fecha}&especialistaId=${especialistaId}`),
        paramsFor(TENANT_A)
      );
      const bDespues = await despues.json();
      assert.ok(bDespues.especialistas[0].horarios.includes("14:00"), "tras cancelar, el slot debe volver a estar disponible");
    });

    it("P. errores de dominio se traducen a mensajes amigables, nunca códigos técnicos", async () => {
      const casos = [
        { servicioId: randomUUID(), especialistaId, esperado: "El servicio seleccionado ya no está disponible." },
        { servicioId: servicioActivoId, especialistaId: especialistaInactivoId, esperado: "Ese profesional ya no está disponible." },
        { servicioId: servicioSinEspecialistaId, especialistaId, esperado: null }, // especialista no habilitado para ESE servicio
      ];
      for (const caso of casos) {
        const res = await reservarPOST(
          req(`http://localhost/api/reservar/${TENANT_A}`, {
            method: "POST",
            body: {
              servicioId: caso.servicioId, especialistaId: caso.especialistaId, fecha: proximoMartes(4), hora: "09:00",
              nombreCliente: "Cliente P", telefonoCliente: "573002220008", idempotencyKey: randomUUID(),
            },
          }),
          paramsFor(TENANT_A)
        );
        const body = await res.json();
        assert.equal(res.status, 409);
        assert.ok(!/23P01|23503|23505|UUID|Postgres|null value/i.test(body.error), `no debe filtrar detalles técnicos: "${body.error}"`);
        if (caso.esperado) assert.equal(body.error, caso.esperado);
      }
    });
  }
);
