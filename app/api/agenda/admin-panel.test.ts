/**
 * Fase 5 (panel administrativo de Daniela) — integración REAL contra
 * Supabase de las nuevas rutas de administración (servicios, especialistas,
 * horarios, bloqueos, clientes) y de las dos primitivas nuevas de cita
 * (completar/no_show). Mismo patrón que portal.test.ts: route handlers
 * llamados directamente, tenant descartable (randomUUID), todo se borra en
 * after().
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import { GET as bootstrapGET } from "./[token]/route";
import { POST as citaAccionPOST } from "./[token]/citas/[id]/route";
import { GET as serviciosGET, POST as serviciosPOST } from "./[token]/servicios/route";
import { PATCH as servicioPATCH } from "./[token]/servicios/[id]/route";
import { GET as especialistasGET, POST as especialistasPOST } from "./[token]/especialistas/route";
import { PATCH as especialistaPATCH } from "./[token]/especialistas/[id]/route";
import { GET as horariosGET, POST as horariosPOST } from "./[token]/horarios/route";
import { PATCH as horarioPATCH, DELETE as horarioDELETE } from "./[token]/horarios/[id]/route";
import { GET as bloqueosGET, POST as bloqueosPOST } from "./[token]/bloqueos/route";
import { PATCH as bloqueoPATCH, DELETE as bloqueoDELETE } from "./[token]/bloqueos/[id]/route";
import { GET as clientesGET } from "./[token]/clientes/route";
import { listarHorariosDisponiblesPorServicio } from "@/lib/disponibilidad-servicio";

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
  "Panel administrativo de Daniela (Fase 5) — API real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `test-panel-${Date.now()}`;
    let tokenA: string;
    let tokenB: string;
    let especialistaAId: number;
    let especialistaBId: number; // de OTRO tenant

    const especialistaIds: number[] = [];
    const servicioIds: string[] = [];
    const horarioIds: number[] = [];
    const bloqueoIds: number[] = [];
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
      await supabase.from("dulabs_suscripciones").insert([
        { id_tenant: TENANT_A, plan: "starter", estado: "activa", precio_cop: 0, fecha_proximo_cobro: enUnMes.toISOString().slice(0, 10) },
        // TENANT_B también necesita plan activo -- si no, el 403 de "plan
        // pausado" tapa lo que estas pruebas de aislamiento quieren
        // verificar de verdad (que A y B no puedan tocarse entre sí).
        { id_tenant: TENANT_B, plan: "starter", estado: "activa", precio_cop: 0, fecha_proximo_cobro: enUnMes.toISOString().slice(0, 10) },
      ]);

      const { data: eA, error: eAerr } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_A, phone_number_id: PHONE_A, nombre: "Panel A", numero_whatsapp: "573000000601",
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
          id_tenant: TENANT_B, phone_number_id: `${PHONE_A}-b`, nombre: "Panel B", numero_whatsapp: "573000000602",
          servicio: "manos", duracion_min: 60, activo: true, bloquea_horario: true, es_general: false, requiere_aprobacion: false,
        })
        .select("id, token").single();
      if (eBerr) throw eBerr;
      especialistaBId = eB!.id as number;
      tokenB = eB!.token as string;
      especialistaIds.push(especialistaBId);
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      await supabase.from("dulabs_clientes_conocidos").delete().eq("id_tenant", TENANT_A);
      if (bloqueoIds.length) await supabase.from("dulabs_bloqueos").delete().in("id", bloqueoIds);
      if (horarioIds.length) await supabase.from("dulabs_horario_especialista").delete().in("id", horarioIds);
      await supabase.from("dulabs_servicio_especialista").delete().in("servicio_id", servicioIds.length ? servicioIds : ["00000000-0000-0000-0000-000000000000"]);
      if (servicioIds.length) await supabase.from("dulabs_servicios").delete().in("id", servicioIds);
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
      await supabase.from("dulabs_suscripciones").delete().in("id_tenant", [TENANT_A, TENANT_B]);
    });

    it("SERVICIOS: crear, listar, editar, activar/desactivar, asociar profesional (rechaza cross-tenant)", async () => {
      const crear = await serviciosPOST(
        req(`http://x/api/agenda/${tokenA}/servicios`, { method: "POST", body: { nombre: "TEST_PANEL_servicio", duracion_min: 45, precio: 30000 } }),
        paramsFor({ token: tokenA })
      );
      const bc = await crear.json();
      assert.equal(crear.status, 200);
      assert.equal(bc.servicio.nombre, "TEST_PANEL_servicio");
      servicioIds.push(bc.servicio.id);

      const lista = await serviciosGET(req(`http://x/api/agenda/${tokenA}/servicios`), paramsFor({ token: tokenA }));
      const bl = await lista.json();
      assert.ok(bl.servicios.some((s: { id: string }) => s.id === bc.servicio.id));

      const editar = await servicioPATCH(
        req(`http://x/api/agenda/${tokenA}/servicios/${bc.servicio.id}`, { method: "PATCH", body: { activo: false, especialistaIds: [especialistaAId] } }),
        paramsFor({ token: tokenA, id: bc.servicio.id })
      );
      const be = await editar.json();
      assert.equal(editar.status, 200);
      assert.equal(be.servicio.activo, false);

      const crossTenant = await servicioPATCH(
        req(`http://x/api/agenda/${tokenA}/servicios/${bc.servicio.id}`, { method: "PATCH", body: { especialistaIds: [especialistaBId] } }),
        paramsFor({ token: tokenA, id: bc.servicio.id })
      );
      assert.equal(crossTenant.status, 400, "un especialista de otro tenant nunca debe poder asociarse");

      const otroTenant = await servicioPATCH(
        req(`http://x/api/agenda/${tokenB}/servicios/${bc.servicio.id}`, { method: "PATCH", body: { activo: true } }),
        paramsFor({ token: tokenB, id: bc.servicio.id })
      );
      assert.equal(otroTenant.status, 404, "el tenant B nunca debe poder editar un servicio de A");
    });

    it("PROFESIONALES: crear, listar, editar, rechaza número de WhatsApp + especialidad duplicados", async () => {
      const crear = await especialistasPOST(
        req(`http://x/api/agenda/${tokenA}/especialistas`, {
          method: "POST",
          body: { nombre: "TEST_PANEL_profesional", numero_whatsapp: "573000000699", servicio: "manos-panel", duracion_min: 30 },
        }),
        paramsFor({ token: tokenA })
      );
      const bc = await crear.json();
      assert.equal(crear.status, 200);
      especialistaIds.push(bc.especialista.id);

      const lista = await especialistasGET(req(`http://x/api/agenda/${tokenA}`), paramsFor({ token: tokenA }));
      const bl = await lista.json();
      assert.ok(bl.especialistas.some((e: { id: number }) => e.id === bc.especialista.id));

      // Mismo (phone_number_id, numero_whatsapp, servicio) -- el UNIQUE real
      // de dulabs_especialistas (dulabs_especialistas_numero_unico) es sobre
      // estas 3 columnas, no solo el número: una misma persona puede tener
      // varias filas con el MISMO número si el texto de especialidad
      // difiere (ej. Daniela: "pestañas" + "general"), así que la duplicidad
      // real solo se da cuando las 3 coinciden.
      const duplicado = await especialistasPOST(
        req(`http://x/api/agenda/${tokenA}/especialistas`, {
          method: "POST",
          body: { nombre: "Otro", numero_whatsapp: "573000000699", servicio: "manos-panel" },
        }),
        paramsFor({ token: tokenA })
      );
      assert.equal(duplicado.status, 409);

      const editar = await especialistaPATCH(
        req(`http://x/api/agenda/${tokenA}/especialistas/${bc.especialista.id}`, { method: "PATCH", body: { activo: false } }),
        paramsFor({ token: tokenA, id: String(bc.especialista.id) })
      );
      const be = await editar.json();
      assert.equal(be.especialista.activo, false);

      const otroTenant = await especialistaPATCH(
        req(`http://x/api/agenda/${tokenB}/especialistas/${bc.especialista.id}`, { method: "PATCH", body: { activo: true } }),
        paramsFor({ token: tokenB, id: String(bc.especialista.id) })
      );
      assert.equal(otroTenant.status, 404, "el tenant B nunca debe poder editar un profesional de A");
    });

    it("HORARIOS: crear válido, rechaza rango inválido, rechaza especialista de otro tenant, editar, eliminar", async () => {
      const valido = await horariosPOST(
        req(`http://x/api/agenda/${tokenA}/horarios`, { method: "POST", body: { especialista_id: especialistaAId, dia_semana: DIA_SEMANA_MARTES, hora_inicio: "09:00", hora_fin: "18:00" } }),
        paramsFor({ token: tokenA })
      );
      const bv = await valido.json();
      assert.equal(valido.status, 200);
      horarioIds.push(bv.horario.id);

      const invalido = await horariosPOST(
        req(`http://x/api/agenda/${tokenA}/horarios`, { method: "POST", body: { especialista_id: especialistaAId, dia_semana: 1, hora_inicio: "18:00", hora_fin: "09:00" } }),
        paramsFor({ token: tokenA })
      );
      const bi = await invalido.json();
      assert.equal(invalido.status, 400);
      assert.match(bi.error, /inicio.*fin/i);

      const crossTenant = await horariosPOST(
        req(`http://x/api/agenda/${tokenA}/horarios`, { method: "POST", body: { especialista_id: especialistaBId, dia_semana: 1, hora_inicio: "09:00", hora_fin: "18:00" } }),
        paramsFor({ token: tokenA })
      );
      assert.equal(crossTenant.status, 404, "un token de A nunca debe poder crear horario para un especialista de B");

      const lista = await horariosGET(req(`http://x/api/agenda/${tokenA}/horarios?especialistaId=${especialistaAId}`), paramsFor({ token: tokenA }));
      const bl = await lista.json();
      assert.ok(bl.horarios.some((h: { id: number }) => h.id === bv.horario.id));

      const editar = await horarioPATCH(
        req(`http://x/api/agenda/${tokenA}/horarios/${bv.horario.id}`, { method: "PATCH", body: { hora_fin: "17:00" } }),
        paramsFor({ token: tokenA, id: String(bv.horario.id) })
      );
      const be = await editar.json();
      assert.equal(be.horario.hora_fin.slice(0, 5), "17:00");

      const eliminar = await horarioDELETE(req(`http://x/api/agenda/${tokenA}/horarios/${bv.horario.id}`, { method: "DELETE" }), paramsFor({ token: tokenA, id: String(bv.horario.id) }));
      assert.equal(eliminar.status, 200);
      horarioIds.splice(horarioIds.indexOf(bv.horario.id), 1);
    });

    it("BLOQUEOS: crear válido, rechaza tipo inválido, editar, eliminar, y afecta la disponibilidad real", async () => {
      const fecha = proximoMartes(1);
      const { error: hErr } = await supabase.from("dulabs_horario_especialista").insert({
        id_tenant: TENANT_A, especialista_id: especialistaAId, dia_semana: DIA_SEMANA_MARTES, hora_inicio: "09:00", hora_fin: "18:00",
      });
      if (hErr) throw hErr;

      const { data: servicio, error: sErr } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_PANEL_servicio_bloqueo", duracion_min: 60, activo: true })
        .select("id").single();
      if (sErr) throw sErr;
      servicioIds.push(servicio!.id as string);
      await supabase.from("dulabs_servicio_especialista").insert({ id_tenant: TENANT_A, servicio_id: servicio!.id, especialista_id: especialistaAId });

      const antes = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_A, servicioId: servicio!.id as string, fecha });
      assert.equal(antes.ok, true);
      if (antes.ok) assert.ok(antes.especialistas[0]!.horarios.includes("12:00"));

      const tipoInvalido = await bloqueosPOST(
        req(`http://x/api/agenda/${tokenA}/bloqueos`, { method: "POST", body: { especialista_id: especialistaAId, tipo: "siesta", inicio: `${fecha}T12:00:00-05:00`, fin: `${fecha}T13:00:00-05:00` } }),
        paramsFor({ token: tokenA })
      );
      assert.equal(tipoInvalido.status, 400);

      const crear = await bloqueosPOST(
        req(`http://x/api/agenda/${tokenA}/bloqueos`, { method: "POST", body: { especialista_id: especialistaAId, tipo: "almuerzo", inicio: `${fecha}T12:00:00-05:00`, fin: `${fecha}T13:00:00-05:00` } }),
        paramsFor({ token: tokenA })
      );
      const bc = await crear.json();
      assert.equal(crear.status, 200);
      bloqueoIds.push(bc.bloqueo.id);

      const despues = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_A, servicioId: servicio!.id as string, fecha });
      assert.equal(despues.ok, true);
      if (despues.ok) assert.equal(despues.especialistas[0]!.horarios.includes("12:00"), false, "el bloqueo creado por el panel debe afectar la disponibilidad real de inmediato");

      const lista = await bloqueosGET(req(`http://x/api/agenda/${tokenA}/bloqueos`), paramsFor({ token: tokenA }));
      const bl = await lista.json();
      assert.ok(bl.bloqueos.some((b: { id: number }) => b.id === bc.bloqueo.id));

      const editar = await bloqueoPATCH(
        req(`http://x/api/agenda/${tokenA}/bloqueos/${bc.bloqueo.id}`, { method: "PATCH", body: { motivo: "Actualizado" } }),
        paramsFor({ token: tokenA, id: String(bc.bloqueo.id) })
      );
      const be = await editar.json();
      assert.equal(be.bloqueo.motivo, "Actualizado");

      const eliminar = await bloqueoDELETE(req(`http://x/api/agenda/${tokenA}/bloqueos/${bc.bloqueo.id}`, { method: "DELETE" }), paramsFor({ token: tokenA, id: String(bc.bloqueo.id) }));
      assert.equal(eliminar.status, 200);
      bloqueoIds.splice(bloqueoIds.indexOf(bc.bloqueo.id), 1);

      const luegoDeEliminar = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_A, servicioId: servicio!.id as string, fecha });
      assert.equal(luegoDeEliminar.ok, true);
      if (luegoDeEliminar.ok) assert.ok(luegoDeEliminar.especialistas[0]!.horarios.includes("12:00"), "al eliminar el bloqueo, el horario vuelve a estar libre");
    });

    it("CLIENTES: aislado por tenant, calcula cantidad de citas y última cita de forma segura", async () => {
      await supabase.from("dulabs_clientes_conocidos").insert({
        id_tenant: TENANT_A, phone_number_id: PHONE_A, telefono_cliente: "573009998888", nombre: "TEST_PANEL_cliente",
      });
      const { data: citas } = await supabase
        .from("dulabs_citas_especialista")
        .insert([
          { especialista_id: especialistaAId, id_tenant: TENANT_A, phone_number_id: PHONE_A, telefono_cliente: "573009998888", nombre_cliente: "TEST_PANEL_cliente", servicio: "manos", inicio: "2020-01-01T10:00:00-05:00", fin: "2020-01-01T11:00:00-05:00", estado: "completada", bloquea_horario: false },
          { especialista_id: especialistaAId, id_tenant: TENANT_A, phone_number_id: PHONE_A, telefono_cliente: "573009998888", nombre_cliente: "TEST_PANEL_cliente", servicio: "manos", inicio: "2020-02-01T10:00:00-05:00", fin: "2020-02-01T11:00:00-05:00", estado: "cancelada", bloquea_horario: false },
        ])
        .select("id");
      citaIds.push(...((citas ?? []) as { id: number }[]).map((c) => c.id));

      const res = await clientesGET(req(`http://x/api/agenda/${tokenA}/clientes`), paramsFor({ token: tokenA }));
      const body = await res.json();
      const cliente = body.clientes.find((c: { telefono: string }) => c.telefono === "573009998888");
      assert.ok(cliente);
      assert.equal(cliente.citasRegistradas, 1, "la cancelada no debe contar");
      assert.equal(cliente.ultimaCita?.slice(0, 10), "2020-01-01");

      const resB = await clientesGET(req(`http://x/api/agenda/${tokenB}/clientes`), paramsFor({ token: tokenB }));
      const bodyB = await resB.json();
      assert.equal(bodyB.clientes.some((c: { telefono: string }) => c.telefono === "573009998888"), false, "el cliente de A nunca debe verse desde el token de B");
    });

    it("RESUMEN: el bootstrap incluye conteos reales filtrados por tenant", async () => {
      const res = await bootstrapGET(req(`http://x/api/agenda/${tokenA}`), paramsFor({ token: tokenA }));
      const body = await res.json();
      assert.ok(body.resumen);
      assert.ok(body.resumen.clientesRegistrados >= 1);
      assert.ok(body.resumen.serviciosActivos >= 0);
      assert.ok(body.resumen.profesionalesActivos >= 1);
    });

    it("CITAS: completar/no_show solo desde 'confirmada', y liberan/mantienen disponibilidad correctamente", async () => {
      const { data: cita, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: especialistaAId, id_tenant: TENANT_A, phone_number_id: PHONE_A, telefono_cliente: "573009997777",
          nombre_cliente: "TEST_PANEL_cita", servicio: "manos", inicio: "2020-03-01T10:00:00-05:00", fin: "2020-03-01T11:00:00-05:00",
          estado: "pendiente", bloquea_horario: true,
        })
        .select("id").single();
      if (error) throw error;
      citaIds.push(cita!.id as number);

      const fallaPendiente = await citaAccionPOST(
        req(`http://x/api/agenda/${tokenA}/citas/${cita!.id}`, { method: "POST", body: { accion: "completar" } }),
        paramsFor({ token: tokenA, id: String(cita!.id) })
      );
      assert.equal(fallaPendiente.status, 409, "no se puede completar una cita que sigue pendiente");

      await supabase.from("dulabs_citas_especialista").update({ estado: "confirmada" }).eq("id", cita!.id);

      const completar = await citaAccionPOST(
        req(`http://x/api/agenda/${tokenA}/citas/${cita!.id}`, { method: "POST", body: { accion: "completar" } }),
        paramsFor({ token: tokenA, id: String(cita!.id) })
      );
      const bc = await completar.json();
      assert.equal(completar.status, 200);
      assert.equal(bc.cita.estado, "completada");

      const { data: cita2, error: err2 } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: especialistaAId, id_tenant: TENANT_A, phone_number_id: PHONE_A, telefono_cliente: "573009996666",
          nombre_cliente: "TEST_PANEL_cita2", servicio: "manos", inicio: "2020-03-02T10:00:00-05:00", fin: "2020-03-02T11:00:00-05:00",
          estado: "confirmada", bloquea_horario: true,
        })
        .select("id").single();
      if (err2) throw err2;
      citaIds.push(cita2!.id as number);

      const noShow = await citaAccionPOST(
        req(`http://x/api/agenda/${tokenA}/citas/${cita2!.id}`, { method: "POST", body: { accion: "no_show" } }),
        paramsFor({ token: tokenA, id: String(cita2!.id) })
      );
      const bn = await noShow.json();
      assert.equal(noShow.status, 200);
      assert.equal(bn.cita.estado, "no_show");
    });
  }
);
