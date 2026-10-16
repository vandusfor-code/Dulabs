/**
 * Cobros manuales — el cableado de PRODUCCIÓN (consultas reales de supabase-js) contra un Supabase EN MEMORIA (lib/testing/supabase-rest-memoria.ts): nada toca Supabase real ni Meta.
 * Se afirma QUÉ filas se eligen, que cada escritura lleve sus condiciones (nunca se suspende a quien ya pagó) y el comportamiento de varios días con el cron real.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { MigracionCobrosPendiente, depsCobrosDeProduccion } from "./cobros-supabase";
import type { DepsEnvioRecordatorio } from "./enviar-recordatorio";
import { hoyBogota } from "./fechas";
import { procesarCobrosManuales, type DepsCobros, type SuscripcionVencida } from "./procesar-cobros-manuales";
import { olvidarSuspensiones } from "./suspension";

const AMORE = "aaaaaaaa-0000-4000-8000-0000000000a1";
const PUBLI = "bbbbbbbb-0000-4000-8000-0000000000b2";
const WOMPI = "cccccccc-0000-4000-8000-0000000000c3";
const CORTESIA = "dddddddd-0000-4000-8000-0000000000d4";
const FUTURO = "eeeeeeee-0000-4000-8000-0000000000e5";
const VENCIDA = "ffffffff-0000-4000-8000-0000000000f6";

const CUERPO = "Hola, {{1}} 👋 Tu Agente IA está desactivado. Para reactivarlo, recuerda realizar el pago de tu mensualidad por {{2}}.";
const enviosMeta: { para: string; parametrosPosicionales?: string[] }[] = [];
const envioMeta: DepsEnvioRecordatorio = {
  resolverToken: async () => ({ token: "TOKEN-DE-PRUEBA" }),
  importarPlantilla: async () => ({
    metaTemplateId: "1646756836819671", estado: "APPROVED", categoria: "UTILITY", idioma: "es_CO", cuerpo: CUERPO, footer: null, botones: [], botonesCta: [], headerFormato: null, headerTexto: null, variablesEjemplo: [],
  }),
  enviar: async (p) => {
    enviosMeta.push({ para: p.para, parametrosPosicionales: p.parametrosPosicionales });
    return { wamid: `wamid.${enviosMeta.length}` };
  },
};

let db: SupabaseMemoria;
const fila = (tabla: string, filtro: (f: Record<string, unknown>) => boolean) => db.rows(tabla).find(filtro);
const sus = (id: string) => fila("dulabs_suscripciones", (f) => f.id_tenant === id)!;
const ciclo = (id: string, fecha: string) => fila("dulabs_cobros_ciclos", (f) => f.id_tenant === id && f.fecha_cobro === fecha);

beforeEach(() => {
  olvidarSuspensiones();
  enviosMeta.length = 0;
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  db.table("dulabs_cobros_ciclos", { identity: "id", unique: [["id_tenant", "fecha_cobro"]] });
  const base = { cortesia: false, estado: "activa", wompi_payment_source_id: null, plan: "start", precio_cop: 39990, telefono_cobro: null, nombre_cobro: null, suspendida_por_pago_at: null };
  db.table("dulabs_suscripciones").push(
    { ...base, id_tenant: AMORE, fecha_proximo_cobro: "2026-10-30", telefono_cobro: "573001234567", nombre_cobro: "AMORE" },
    { ...base, id_tenant: PUBLI, fecha_proximo_cobro: "2026-10-11", precio_cop: 79990, plan: "essential", telefono_cobro: "573001112233" },
    { ...base, id_tenant: WOMPI, fecha_proximo_cobro: "2026-10-14", wompi_payment_source_id: "ps_1", telefono_cobro: "573001110001" },
    { ...base, id_tenant: CORTESIA, fecha_proximo_cobro: "2026-09-01", cortesia: true, telefono_cobro: "573001110002" },
    { ...base, id_tenant: FUTURO, fecha_proximo_cobro: "2026-11-30", telefono_cobro: "573001110003" },
    { ...base, id_tenant: VENCIDA, fecha_proximo_cobro: "2026-10-01", estado: "vencida", telefono_cobro: "573001110004" },
  );
  db.table("dulabs_clientes_config").push({ id_tenant: PUBLI, phone_number_id: "pn-publi", nombre_negocio: "Publibordados web", created_at: "2026-09-24T00:00:00Z" });
});
afterEach(() => db.uninstall());

describe("hoyBogota", () => {
  it("usa la fecha de Colombia, no la del servidor (UTC): a las 10 p. m. de Bogotá en UTC ya es «mañana»", () => {
    assert.equal(hoyBogota(new Date("2026-10-31T03:00:00Z")), "2026-10-30");
    assert.equal(hoyBogota(new Date("2026-10-31T04:59:00Z")), "2026-10-30");
    assert.equal(hoyBogota(new Date("2026-10-31T05:00:00Z")), "2026-10-31");
    assert.equal(hoyBogota(new Date("2026-03-01T04:00:00Z")), "2026-02-28");
  });
});

describe("depsCobrosDeProduccion — qué suscripciones se eligen", () => {
  it("solo las MANUALES, ACTIVAS, que NO son cortesía y cuya fecha de cobro ya llegó (la más atrasada primero), con sus datos de cobro", async () => {
    const vencidas = await depsCobrosDeProduccion(supabaseAdmin(), envioMeta).listarVencidas("2026-10-30");
    assert.deepEqual(vencidas.map((v) => v.idTenant), [PUBLI, AMORE], "no entran: Wompi, cortesía, vencida/cancelada ni la que vence el 30-nov");
    assert.deepEqual(vencidas[1], { idTenant: AMORE, plan: "start", precioCop: 39990, fechaCobro: "2026-10-30", telefonoCobro: "573001234567", nombreCobro: "AMORE", suspendida: false });
    assert.equal(vencidas[0]!.telefonoCobro, "573001112233");
    assert.equal(vencidas[0]!.nombreCobro, null);
  });

  it("antes del vencimiento no sale nadie", async () => {
    assert.deepEqual(await depsCobrosDeProduccion(supabaseAdmin(), envioMeta).listarVencidas("2026-10-10"), []);
  });

  it("sin la migración (la tabla/columna no existe) avisa con un error claro y no inventa datos", async () => {
    db.missing("dulabs_suscripciones");
    await assert.rejects(depsCobrosDeProduccion(supabaseAdmin(), envioMeta).listarVencidas("2026-10-30"), MigracionCobrosPendiente);
  });
});

describe("depsCobrosDeProduccion — escrituras condicionadas", () => {
  it("reclamarCiclo: la primera vez crea el ciclo y devuelve true; la segunda (otra corrida) devuelve false y no lo duplica", async () => {
    const deps = depsCobrosDeProduccion(supabaseAdmin(), envioMeta);
    const [amore] = (await deps.listarVencidas("2026-10-30")).filter((v) => v.idTenant === AMORE);
    assert.equal(await deps.reclamarCiclo(amore!), true);
    assert.equal(await deps.reclamarCiclo(amore!), false);
    assert.equal(db.rows("dulabs_cobros_ciclos").length, 1);
    assert.deepEqual(
      { ...ciclo(AMORE, "2026-10-30") },
      { id: 1, id_tenant: AMORE, fecha_cobro: "2026-10-30", monto_cop: 39990, telefono: "573001234567", estado: "pendiente" },
    );
  });

  it("suspender: marca la suscripción solo si SIGUE en ese ciclo; si la fecha ya avanzó (se pagó) no toca nada", async () => {
    const deps = depsCobrosDeProduccion(supabaseAdmin(), envioMeta);
    assert.equal(await deps.suspender(AMORE, "2026-09-30"), false, "otra fecha de cobro = ya no es ese ciclo");
    assert.equal(sus(AMORE).suspendida_por_pago_at, null);
    assert.equal(await deps.suspender(AMORE, "2026-10-30"), true);
    assert.ok(sus(AMORE).suspendida_por_pago_at);
    assert.equal(await deps.suspender(AMORE, "2026-10-30"), false, "ya estaba suspendida: no se vuelve a marcar");
  });

  it("suspender NUNCA toca una suscripción de Wompi, una cortesía ni una que no esté activa", async () => {
    const deps = depsCobrosDeProduccion(supabaseAdmin(), envioMeta);
    assert.equal(await deps.suspender(WOMPI, "2026-10-14"), false);
    assert.equal(await deps.suspender(CORTESIA, "2026-09-01"), false);
    assert.equal(await deps.suspender(VENCIDA, "2026-10-01"), false);
    for (const id of [WOMPI, CORTESIA, VENCIDA]) assert.equal(sus(id).suspendida_por_pago_at, null);
  });

  it("registrarEnvio: guarda el wamid al enviar y el motivo al fallar, y NUNCA pisa un ciclo que ya se pagó", async () => {
    const deps = depsCobrosDeProduccion(supabaseAdmin(), envioMeta);
    const [amore] = (await deps.listarVencidas("2026-10-30")).filter((v) => v.idTenant === AMORE);
    await deps.reclamarCiclo(amore!);
    await deps.registrarEnvio({ idTenant: AMORE, fechaCobro: "2026-10-30", resultado: { enviado: false, motivo: "plantilla_no_aprobada", detalle: "status=PENDING" }, intentos: 1 });
    assert.deepEqual([ciclo(AMORE, "2026-10-30")!.estado, ciclo(AMORE, "2026-10-30")!.intentos, ciclo(AMORE, "2026-10-30")!.ultimo_error], ["fallido", 1, "plantilla_no_aprobada: status=PENDING"]);
    await deps.registrarEnvio({ idTenant: AMORE, fechaCobro: "2026-10-30", resultado: { enviado: true, wamid: "wamid.X", resumen: "" }, intentos: 2 });
    assert.deepEqual([ciclo(AMORE, "2026-10-30")!.estado, ciclo(AMORE, "2026-10-30")!.intentos, ciclo(AMORE, "2026-10-30")!.recordatorio_wamid, ciclo(AMORE, "2026-10-30")!.ultimo_error], ["enviado", 2, "wamid.X", null]);

    // el pago se registra (lo hace la función SQL) y un envío tardío NO lo devuelve a «enviado»
    ciclo(AMORE, "2026-10-30")!.estado = "pagado";
    await deps.registrarEnvio({ idTenant: AMORE, fechaCobro: "2026-10-30", resultado: { enviado: true, wamid: "wamid.TARDE", resumen: "" }, intentos: 3 });
    assert.equal(ciclo(AMORE, "2026-10-30")!.estado, "pagado");
    assert.equal(ciclo(AMORE, "2026-10-30")!.recordatorio_wamid, "wamid.X");
  });

  it("marcarOmitido solo cambia un ciclo que sigue pendiente", async () => {
    const deps = depsCobrosDeProduccion(supabaseAdmin(), envioMeta);
    const [amore] = (await deps.listarVencidas("2026-10-30")).filter((v) => v.idTenant === AMORE);
    await deps.reclamarCiclo(amore!);
    await deps.marcarOmitido(AMORE, "2026-10-30");
    assert.equal(ciclo(AMORE, "2026-10-30")!.estado, "omitido");
    ciclo(AMORE, "2026-10-30")!.estado = "pagado";
    await deps.marcarOmitido(AMORE, "2026-10-30");
    assert.equal(ciclo(AMORE, "2026-10-30")!.estado, "pagado");
  });

  it("el nombre para el saludo: el de cobro; si no hay, el del negocio en su número de WhatsApp; si tampoco, «tu negocio»", async () => {
    const deps = depsCobrosDeProduccion(supabaseAdmin(), envioMeta);
    const vencidas = await deps.listarVencidas("2026-10-30");
    const porId = (id: string): SuscripcionVencida => vencidas.find((v) => v.idTenant === id)!;
    assert.equal(await deps.nombreNegocio(porId(AMORE)), "AMORE");
    assert.equal(await deps.nombreNegocio(porId(PUBLI)), "Publibordados web");
    assert.equal(await deps.nombreNegocio({ ...porId(AMORE), nombreCobro: null }), "tu negocio");
  });
});

describe("el cron real de punta a punta (consultas de producción + Meta simulado)", () => {
  /** El día de pago de AMORE: 2026-10-30. Publibordados venció el 11 y también tiene teléfono. */
  async function correr(modo: "simulacion" | "activo", hoy = "2026-10-30") {
    const reales = depsCobrosDeProduccion(supabaseAdmin(), envioMeta);
    const deps: DepsCobros = { ...reales, hoy: () => hoy, avisarDueno: async () => {} };
    return procesarCobrosManuales(deps, { modo });
  }

  it("modo simulación: informa a quién avisaría y NO cambia absolutamente nada", async () => {
    const r = await correr("simulacion");
    assert.deepEqual(r.acciones.map((a) => [a.cliente, a.accion, a.telefono, a.simulado]), [["Publibordados web", "avisar", "…2233", true], ["AMORE", "avisar", "…4567", true]]);
    assert.equal(db.rows("dulabs_cobros_ciclos").length, 0);
    assert.equal(enviosMeta.length, 0);
    assert.equal(sus(AMORE).suspendida_por_pago_at, null);
    assert.equal(sus(PUBLI).suspendida_por_pago_at, null);
  });

  it("modo activo: suspende a quien venció sin pagar, le manda la plantilla con su nombre y su monto, y deja el ciclo como enviado", async () => {
    const r = await correr("activo");
    assert.deepEqual(r.acciones.map((a) => [a.cliente, a.resultado, a.suspendido]), [["Publibordados web", "enviado", true], ["AMORE", "enviado", true]]);
    assert.deepEqual(enviosMeta, [
      { para: "573001112233", parametrosPosicionales: ["Publibordados web", "$79.990"] },
      { para: "573001234567", parametrosPosicionales: ["AMORE", "$39.990"] },
    ]);
    for (const id of [AMORE, PUBLI]) assert.ok(sus(id).suspendida_por_pago_at, `${id} debía quedar suspendido`);
    assert.equal(ciclo(AMORE, "2026-10-30")!.estado, "enviado");
    assert.equal(ciclo(AMORE, "2026-10-30")!.recordatorio_wamid, "wamid.2");
    for (const id of [WOMPI, CORTESIA, FUTURO, VENCIDA]) assert.equal(sus(id).suspendida_por_pago_at, null, `${id} no debía tocarse`);
  });

  it("si corre otra vez (o al día siguiente) NO vuelve a avisar ni a mandar nada", async () => {
    await correr("activo");
    enviosMeta.length = 0;
    const segunda = await correr("activo");
    const tercera = await correr("activo", "2026-10-31");
    assert.equal(enviosMeta.length, 0);
    for (const r of [segunda, tercera]) assert.deepEqual(r.acciones.map((a) => a.accion), ["ya_procesado", "ya_procesado"]);
  });

  it("si el pago se registró antes de que corra el cron (la fecha ya avanzó), no se suspende ni se avisa a nadie", async () => {
    sus(AMORE).fecha_proximo_cobro = "2026-11-30"; // lo que hace «Registrar pago»
    const r = await correr("activo");
    assert.deepEqual(r.acciones.map((a) => a.idTenant), [PUBLI]);
    assert.equal(sus(AMORE).suspendida_por_pago_at, null);
    assert.deepEqual(enviosMeta.map((e) => e.para), ["573001112233"]);
  });

  it("sin teléfono de cobro no se suspende ni se avisa (solo se informa)", async () => {
    sus(PUBLI).telefono_cobro = null;
    const r = await correr("activo");
    assert.deepEqual(r.acciones.map((a) => [a.idTenant, a.accion]), [[PUBLI, "sin_telefono"], [AMORE, "avisar"]]);
    assert.equal(sus(PUBLI).suspendida_por_pago_at, null);
    assert.equal(ciclo(PUBLI, "2026-10-11"), undefined);
  });

  it("si Meta falla: el bot queda suspendido, el ciclo queda «fallido» y al día siguiente se reintenta", async () => {
    const original = envioMeta.enviar;
    envioMeta.enviar = async () => {
      throw new Error("Meta respondió 500");
    };
    try {
      const primera = await correr("activo");
      assert.deepEqual(primera.acciones.map((a) => a.resultado), ["fallido", "fallido"]);
      assert.ok(sus(AMORE).suspendida_por_pago_at);
      assert.equal(ciclo(AMORE, "2026-10-30")!.estado, "fallido");
      assert.match(String(ciclo(AMORE, "2026-10-30")!.ultimo_error), /error_envio: Meta respondió 500/);
    } finally {
      envioMeta.enviar = original;
    }
    const segunda = await correr("activo", "2026-10-31");
    assert.deepEqual(segunda.acciones.map((a) => [a.accion, a.resultado, a.suspendido]), [["reintentar_aviso", "enviado", false], ["reintentar_aviso", "enviado", false]]);
    assert.equal(ciclo(AMORE, "2026-10-30")!.estado, "enviado");
    assert.equal(ciclo(AMORE, "2026-10-30")!.intentos, 2);
  });
});
