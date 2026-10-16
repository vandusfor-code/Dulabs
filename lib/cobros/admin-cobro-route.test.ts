/**
 * Vive en lib/cobros (y no junto a la ruta) porque el corredor de pruebas lee los corchetes de «[idTenant]» como un comodín y correría 0 pruebas.
 * Panel de Operaciones — cobros manuales (app/api/dashboard/admin/clientes/[idTenant]/cobro): la RUTA real (autorización, validaciones, mensajes de error, auditoría) contra un Supabase EN MEMORIA. La función SQL del pago se prueba
 * aparte contra Postgres real (lib/cobros/cobros-sql.pglite.test.ts); aquí se simula su respuesta para afirmar cómo la ruta la traduce.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { TENANT_DULABS_ID } from "@/lib/admin-tenant";
import { olvidarSuspensiones, tenantSuspendidoPorPago } from "@/lib/cobros/suspension";
import { WHATSAPP_VENTAS_NUMERO } from "@/lib/site-contact";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { GET, POST } from "@/app/api/dashboard/admin/clientes/[idTenant]/cobro/route";

const AMORE = "aaaaaaaa-0000-4000-8000-0000000000a1";
const WOMPI = "cccccccc-0000-4000-8000-0000000000c3";
const CORTESIA = "dddddddd-0000-4000-8000-0000000000d4";
const SIN_SUSCRIPCION = "99999999-0000-4000-8000-000000000099";
const OTRO_NEGOCIO = "bbbbbbbb-0000-4000-8000-0000000000b2";
// Los ids de usuario de Supabase Auth son UUID (auth-js lo valida en getUserById).
const U_ADMIN = "11111111-1111-4111-8111-111111111111";
const U_OTRO = "22222222-2222-4222-8222-222222222222";

let db: SupabaseMemoria;
let rpcLlamadas: Record<string, unknown>[];
let respuestaRpc: () => { data?: unknown; error?: { code: string; message: string } };

const contexto = (idTenant: string) => ({ params: Promise.resolve({ idTenant }) });
const get = (idTenant: string, token: string | null = "t-admin") => GET(new NextRequest("http://localhost/x", { headers: token ? { authorization: `Bearer ${token}` } : {} }), contexto(idTenant));
const post = (idTenant: string, cuerpo: unknown, token: string | null = "t-admin") =>
  POST(
    new NextRequest("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }),
    contexto(idTenant),
  );
const sus = (id: string) => db.rows("dulabs_suscripciones").find((f) => f.id_tenant === id)!;
const auditoria = () => db.rows("dulabs_auditoria_admin");

beforeEach(() => {
  olvidarSuspensiones();
  rpcLlamadas = [];
  respuestaRpc = () => ({ data: [{ fecha_pagada: "2026-10-30", proximo_cobro: "2026-11-30", monto_registrado: 39990, pago_id_registrado: 7, estaba_suspendida: true }] });
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  db.user("t-admin", U_ADMIN);
  db.user("t-otro", U_OTRO);
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: TENANT_DULABS_ID, user_id: U_ADMIN, rol: "admin", estado: "activo" },
    { id: 2, tenant_id: OTRO_NEGOCIO, user_id: U_OTRO, rol: "admin", estado: "activo" },
  );
  db.table("dulabs_auditoria_admin", { identity: "id" });
  db.table("dulabs_cobros_ciclos", { identity: "id", unique: [["id_tenant", "fecha_cobro"]] });
  const base = { plan: "start", precio_cop: 39990, estado: "activa", cortesia: false, wompi_payment_source_id: null, dia_cobro: null, telefono_cobro: null, nombre_cobro: null, suspendida_por_pago_at: null };
  db.table("dulabs_suscripciones").push(
    { ...base, id_tenant: AMORE, fecha_proximo_cobro: "2026-10-30", dia_cobro: 30, telefono_cobro: "573001234567", nombre_cobro: "AMORE", suspendida_por_pago_at: "2026-10-30T14:05:00Z" },
    { ...base, id_tenant: WOMPI, fecha_proximo_cobro: "2026-11-14", wompi_payment_source_id: "ps_1" },
    { ...base, id_tenant: CORTESIA, fecha_proximo_cobro: "2027-09-04", cortesia: true, precio_cop: 0 },
  );
  db.rpc("dulabs_cobro_registrar_pago", (args) => {
    rpcLlamadas.push(args);
    return respuestaRpc();
  });
});
afterEach(() => {
  db.uninstall();
  delete process.env.COBROS_MANUALES_MODO;
});

describe("autorización", () => {
  it("sin sesión → 401; con la sesión de un negocio que NO es Dulabs → 403 (el Panel es solo de Dulabs)", async () => {
    assert.equal((await get(AMORE, null)).status, 401);
    assert.equal((await get(AMORE, "t-otro")).status, 403);
    assert.equal((await post(AMORE, { accion: "levantar_suspension" }, null)).status, 401);
    const r = await post(AMORE, { accion: "levantar_suspension" }, "t-otro");
    assert.equal(r.status, 403);
    assert.ok(sus(AMORE).suspendida_por_pago_at, "un no autorizado no pudo levantar la suspensión");
    assert.equal(rpcLlamadas.length, 0);
  });
});

describe("GET — estado del cobro", () => {
  it("una suscripción manual muestra su fecha, su teléfono, la suspensión y los últimos ciclos; y si el cron está en simulación", async () => {
    db.rows("dulabs_cobros_ciclos").push({ id_tenant: AMORE, fecha_cobro: "2026-10-30", monto_cop: 39990, estado: "enviado", intentos: 1, recordatorio_enviado_at: "2026-10-30T14:05:01Z", ultimo_error: null });
    const r = await get(AMORE);
    assert.equal(r.status, 200);
    const cuerpo = await r.json();
    assert.equal(cuerpo.modo, "simulacion");
    assert.equal(cuerpo.aplica, true);
    assert.deepEqual(cuerpo.suscripcion, {
      plan: "start", precioCop: 39990, fechaProximoCobro: "2026-10-30", diaCobro: 30, telefonoCobro: "573001234567", nombreCobro: "AMORE", suspendidaPorPagoAt: "2026-10-30T14:05:00Z",
    });
    assert.equal(cuerpo.ciclos.length, 1);
    assert.deepEqual([cuerpo.ciclos[0].fechaCobro, cuerpo.ciclos[0].estado, cuerpo.ciclos[0].intentos], ["2026-10-30", "enviado", 1]);
    process.env.COBROS_MANUALES_MODO = "activo";
    assert.equal((await (await get(AMORE)).json()).modo, "activo");
  });

  it("explica por qué NO aplica (Wompi, cortesía o sin suscripción)", async () => {
    assert.deepEqual([(await (await get(WOMPI)).json()).aplica, (await (await get(WOMPI)).json()).motivoNoAplica], [false, "wompi"]);
    assert.equal((await (await get(CORTESIA)).json()).motivoNoAplica, "cortesia");
    const sin = await (await get(SIN_SUSCRIPCION)).json();
    assert.deepEqual([sin.aplica, sin.motivoNoAplica, sin.suscripcion], [false, "sin_suscripcion", null]);
  });

  it("sin la migración responde «migracionPendiente» (la pantalla lo explica) en vez de fallar", async () => {
    db.missing("dulabs_suscripciones");
    const r = await get(AMORE);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { migracionPendiente: true, modo: "simulacion" });
  });
});

describe("POST configurar", () => {
  it("guarda teléfono (normalizado), nombre del saludo, día y fecha de cobro, solo lo que se manda, y lo audita con el teléfono enmascarado", async () => {
    const r = await post(AMORE, { accion: "configurar", telefono_cobro: "300 123 4567", nombre_cobro: "  AMORE   Salón ", dia_cobro: 30, fecha_proximo_cobro: "2026-11-30" });
    assert.equal(r.status, 200);
    const s = sus(AMORE);
    assert.deepEqual([s.telefono_cobro, s.nombre_cobro, s.dia_cobro, s.fecha_proximo_cobro], ["573001234567", "AMORE Salón", 30, "2026-11-30"]);
    assert.equal(s.precio_cop, 39990, "el precio no se toca");
    const fila = auditoria().at(-1)!;
    assert.equal(fila.accion, "COBRO_CONFIGURAR");
    assert.equal(fila.id_tenant, AMORE);
    assert.equal(fila.resultado, "ok");
    assert.equal((fila.metadata as Record<string, unknown>).telefono_cobro, "…4567");
    assert.doesNotMatch(JSON.stringify(fila), /573001234567/, "la auditoría no guarda el teléfono completo");
  });

  it("un cambio parcial no toca lo demás, y teléfono vacío o null lo borra", async () => {
    await post(AMORE, { accion: "configurar", nombre_cobro: "Otro nombre" });
    assert.deepEqual([sus(AMORE).telefono_cobro, sus(AMORE).nombre_cobro, sus(AMORE).dia_cobro], ["573001234567", "Otro nombre", 30]);
    await post(AMORE, { accion: "configurar", telefono_cobro: "" });
    assert.equal(sus(AMORE).telefono_cobro, null);
    await post(AMORE, { accion: "configurar", telefono_cobro: "573001234567" });
    await post(AMORE, { accion: "configurar", telefono_cobro: null, dia_cobro: null });
    assert.deepEqual([sus(AMORE).telefono_cobro, sus(AMORE).dia_cobro], [null, null]);
  });

  it("el PRECIO no se puede cambiar desde el Panel (aunque se mande en el body)", async () => {
    const r = await post(AMORE, { accion: "configurar", precio_cop: 1, precio_negociado_cop: 1, nombre_cobro: "X" });
    assert.equal(r.status, 200);
    assert.deepEqual([sus(AMORE).precio_cop, sus(AMORE).precio_negociado_cop], [39990, undefined]);
    const solo = await post(AMORE, { accion: "configurar", precio_cop: 1 });
    assert.equal(solo.status, 400, "mandar solo el precio no deja nada que cambiar");
  });

  it("rechaza datos inválidos con un mensaje claro y no cambia nada", async () => {
    const casos: [unknown, RegExp][] = [
      [{ telefono_cobro: "12345" }, /entre 10 y 15 dígitos/],
      [{ telefono_cobro: "abc" }, /entre 10 y 15 dígitos/],
      [{ telefono_cobro: WHATSAPP_VENTAS_NUMERO }, /número de Dulabs/],
      [{ telefono_cobro: `+${WHATSAPP_VENTAS_NUMERO.slice(2)}` }, /número de Dulabs/],
      [{ dia_cobro: 0 }, /de 1 a 31/],
      [{ dia_cobro: 32 }, /de 1 a 31/],
      [{ dia_cobro: 15.5 }, /de 1 a 31/],
      [{ fecha_proximo_cobro: "30/10/2026" }, /AAAA-MM-DD/],
      [{ fecha_proximo_cobro: "2026-02-30" }, /AAAA-MM-DD/],
      [{ nombre_cobro: "x".repeat(61) }, /60 caracteres/],
      [{}, /nada que cambiar/],
    ];
    for (const [cambio, esperado] of casos) {
      const r = await post(AMORE, { accion: "configurar", ...(cambio as object) });
      assert.equal(r.status, 400, JSON.stringify(cambio));
      assert.match((await r.json()).error, esperado, JSON.stringify(cambio));
    }
    assert.deepEqual([sus(AMORE).telefono_cobro, sus(AMORE).dia_cobro, sus(AMORE).fecha_proximo_cobro], ["573001234567", 30, "2026-10-30"]);
  });

  it("la fecha de cobro solo se edita en suscripciones manuales; sin suscripción → 404", async () => {
    for (const id of [WOMPI, CORTESIA]) {
      const r = await post(id, { accion: "configurar", fecha_proximo_cobro: "2026-12-01" });
      assert.equal(r.status, 400, id);
      assert.match((await r.json()).error, /solo se edita en suscripciones manuales/);
    }
    assert.equal(sus(WOMPI).fecha_proximo_cobro, "2026-11-14");
    assert.equal((await post(SIN_SUSCRIPCION, { accion: "configurar", dia_cobro: 5 })).status, 404);
    // el teléfono y el nombre sí se pueden guardar en cualquiera (por si luego pasa a manual)
    assert.equal((await post(WOMPI, { accion: "configurar", telefono_cobro: "573001112233" })).status, 200);
  });
});

describe("POST registrar_pago", () => {
  it("llama a la función SQL con el ciclo que se ve en pantalla, el operador y la nota, y devuelve la nueva fecha; deja de recordar la suspensión", async () => {
    // se recuerda «suspendido» y la «función SQL» lo levanta: la respuesta no debe quedar vieja
    assert.equal(await tenantSuspendidoPorPago(supabaseAdmin(), AMORE), true);
    respuestaRpc = () => {
      sus(AMORE).suspendida_por_pago_at = null;
      return { data: [{ fecha_pagada: "2026-10-30", proximo_cobro: "2026-11-30", monto_registrado: 39990, pago_id_registrado: 7, estaba_suspendida: true }] };
    };
    const r = await post(AMORE, { accion: "registrar_pago", fecha_cobro: "2026-10-30", nota: "  transferencia Bancolombia " });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { success: true, fechaPagada: "2026-10-30", proximoCobro: "2026-11-30", montoRegistrado: 39990, reactivado: true });
    assert.deepEqual(rpcLlamadas, [{ p_tenant: AMORE, p_fecha_cobro: "2026-10-30", p_monto_cop: null, p_operador: null, p_nota: "transferencia Bancolombia" }]);
    assert.equal(await tenantSuspendidoPorPago(supabaseAdmin(), AMORE), false, "el bot vuelve a responder de inmediato en este servidor, sin esperar la caché");
    const fila = auditoria().at(-1)!;
    assert.deepEqual([fila.accion, fila.resultado, fila.id_tenant], ["COBRO_REGISTRAR_PAGO", "ok", AMORE]);
  });

  it("acepta un monto distinto al del plan (lo que de verdad se recibió)", async () => {
    await post(AMORE, { accion: "registrar_pago", fecha_cobro: "2026-10-30", monto_cop: 30000 });
    assert.equal(rpcLlamadas[0]!.p_monto_cop, 30000);
  });

  it("valida la entrada ANTES de tocar la base", async () => {
    for (const cuerpo of [{}, { fecha_cobro: "ayer" }, { fecha_cobro: "2026-10-30", monto_cop: 0 }, { fecha_cobro: "2026-10-30", monto_cop: -5 }, { fecha_cobro: "2026-10-30", monto_cop: 10.5 }, { fecha_cobro: "2026-10-30", monto_cop: "40000" }]) {
      const r = await post(AMORE, { accion: "registrar_pago", ...cuerpo });
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
    }
    assert.equal(rpcLlamadas.length, 0);
  });

  it("traduce cada rechazo de la función SQL a un mensaje claro y un código HTTP correcto", async () => {
    const esperados: [string, number, RegExp][] = [
      ["cobro_sin_suscripcion", 404, /no tiene suscripción/],
      ["cobro_suscripcion_no_activa", 409, /no está activa/],
      ["cobro_es_cortesia", 400, /cortesía/],
      ["cobro_no_es_manual", 400, /Wompi/],
      ["cobro_ciclo_desactualizado", 409, /Recarga la página/],
      ["cobro_ciclo_ya_pagado", 409, /ya tiene un pago/],
      ["cobro_monto_invalido", 400, /mayor que cero/],
    ];
    for (const [codigo, status, texto] of esperados) {
      respuestaRpc = () => ({ error: { code: "P0001", message: codigo } });
      const r = await post(AMORE, { accion: "registrar_pago", fecha_cobro: "2026-10-30" });
      assert.equal(r.status, status, codigo);
      assert.match((await r.json()).error, texto, codigo);
    }
    assert.equal(auditoria().filter((a) => a.accion === "COBRO_REGISTRAR_PAGO" && a.resultado === "error").length, esperados.length, "cada intento fallido queda auditado");
  });

  it("un error inesperado → 500 con su mensaje; sin la migración (la función no existe) → 503", async () => {
    respuestaRpc = () => ({ error: { code: "XX000", message: "algo raro" } });
    const raro = await post(AMORE, { accion: "registrar_pago", fecha_cobro: "2026-10-30" });
    assert.deepEqual([raro.status, (await raro.json()).error], [500, "algo raro"]);
    db.rpc("dulabs_cobro_registrar_pago", () => ({ error: { code: "PGRST202", message: "Could not find the function public.dulabs_cobro_registrar_pago" } }));
    const sinMigracion = await post(AMORE, { accion: "registrar_pago", fecha_cobro: "2026-10-30" });
    assert.equal(sinMigracion.status, 503);
    assert.match((await sinMigracion.json()).error, /migración/);
  });
});

describe("POST levantar_suspension", () => {
  it("levanta la suspensión y deja de reintentar el ciclo en curso (si no, el cron la volvería a poner mañana); un ciclo ya enviado o pagado no se toca", async () => {
    db.rows("dulabs_cobros_ciclos").push(
      { id: 1, id_tenant: AMORE, fecha_cobro: "2026-10-30", monto_cop: 39990, estado: "fallido", intentos: 2 },
      { id: 2, id_tenant: AMORE, fecha_cobro: "2026-09-30", monto_cop: 39990, estado: "enviado", intentos: 1 },
      { id: 3, id_tenant: AMORE, fecha_cobro: "2026-08-30", monto_cop: 39990, estado: "pagado", intentos: 0 },
    );
    assert.equal(await tenantSuspendidoPorPago(supabaseAdmin(), AMORE), true);
    const r = await post(AMORE, { accion: "levantar_suspension" });
    assert.equal(r.status, 200);
    assert.equal(sus(AMORE).suspendida_por_pago_at, null);
    const estados = Object.fromEntries(db.rows("dulabs_cobros_ciclos").map((c) => [c.fecha_cobro as string, c.estado]));
    assert.deepEqual(estados, { "2026-10-30": "omitido", "2026-09-30": "enviado", "2026-08-30": "pagado" });
    assert.equal(sus(AMORE).fecha_proximo_cobro, "2026-10-30", "la fecha de cobro NO se mueve: no hubo pago");
    assert.equal(await tenantSuspendidoPorPago(supabaseAdmin(), AMORE), false);
    assert.deepEqual([auditoria().at(-1)!.accion, auditoria().at(-1)!.resultado], ["COBRO_LEVANTAR_SUSPENSION", "ok"]);
  });

  it("si no estaba suspendido → 409 y no cambia nada", async () => {
    sus(AMORE).suspendida_por_pago_at = null;
    const r = await post(AMORE, { accion: "levantar_suspension" });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /no estaba suspendido/);
  });
});

describe("entradas inválidas", () => {
  it("acción desconocida o JSON roto → 400", async () => {
    assert.equal((await post(AMORE, { accion: "borrar_todo" })).status, 400);
    assert.equal((await post(AMORE, {})).status, 400);
    assert.equal((await post(AMORE, "esto no es json")).status, 400);
  });
});
