/**
 * Bloque 18 — endpoints públicos del catálogo con límite de tasa, autorización de crons y
 * retención de los datos del agente. Supabase EN MEMORIA (lib/testing/supabase-rest-memoria.ts);
 * nada toca Supabase real.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { crearLimitadorPublico, ipDe, limitadorPublicoReal, refDeIp, type LimitadorPublico } from "@/lib/catalogo/limites-publicos";
import { responderPedido, responderSeleccion } from "@/lib/catalogo/pedido-http";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { LIMITES_TASA, type CategoriaLimiteTasa, type ResultadoLimiteTasa } from "@/lib/rate-limit";
import { bearerCronValido } from "@/lib/cron-auth";
import { RETENCION_DIAS, purgarDatosAgente } from "@/lib/agente/retencion";
import { supabaseAdmin } from "@/lib/supabase";
import { GET as retencionGET } from "@/app/api/cron/agente-retencion/route";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin" };
const DIA = 86_400_000;

/** El mismo algoritmo que dulabs_rate_limit_incrementar (ventana fija), en memoria. */
function contadorVentanaFija(ahora: () => number) {
  const conteos = new Map<string, number>();
  const claves: string[] = [];
  const verificar = async (i: { recurso: string; tenantId: string; categoria: CategoriaLimiteTasa }): Promise<ResultadoLimiteTasa> => {
    const { ventanaSeg, limite } = LIMITES_TASA[i.categoria];
    const inicio = Math.floor(ahora() / 1000 / ventanaSeg) * ventanaSeg;
    const clave = `${i.recurso}:${i.tenantId}`;
    claves.push(clave);
    const k = `${clave}@${inicio}`;
    const n = (conteos.get(k) ?? 0) + 1;
    conteos.set(k, n);
    return { permitido: n <= limite, conteo: n, limite, reiniciaEn: new Date((inicio + ventanaSeg) * 1000).toISOString() };
  };
  return { verificar, claves };
}

const desde = (ip: string, url = "https://x.test/catalogo/joyeria/pedido") => new Request(url, { method: "POST", headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

describe("límite de tasa de los endpoints públicos (reglas reales)", () => {
  it("pedido: 20 por IP cada 10 minutos; la 21 espera; otra IP no se afecta; al pasar la ventana vuelve", async () => {
    let t = Date.parse("2026-09-24T10:00:00Z");
    const { verificar } = contadorVentanaFija(() => t);
    const limitar = crearLimitadorPublico(verificar, () => t);
    for (let i = 0; i < 20; i++) assert.equal((await limitar({ recurso: "pedido", slug: "joyeria", request: desde("1.1.1.1") })).permitido, true, `intento ${i + 1}`);
    const bloqueado = await limitar({ recurso: "pedido", slug: "joyeria", request: desde("1.1.1.1") });
    assert.deepEqual(bloqueado, { permitido: false, reintentarEnSeg: 600 });
    assert.equal((await limitar({ recurso: "pedido", slug: "joyeria", request: desde("2.2.2.2") })).permitido, true);
    t += 600_000;
    assert.equal((await limitar({ recurso: "pedido", slug: "joyeria", request: desde("1.1.1.1") })).permitido, true);
  });

  it("inundación distribuida: 1.000 pedidos por catálogo por hora aunque vengan de muchas IP; una IP bloqueada no gasta el cupo del catálogo", async () => {
    const t = Date.parse("2026-09-24T10:00:00Z");
    const { verificar } = contadorVentanaFija(() => t);
    const limitar = crearLimitadorPublico(verificar, () => t);
    for (let i = 0; i < 50; i++) for (let j = 0; j < 20; j++) assert.equal((await limitar({ recurso: "pedido", slug: "joyeria", request: desde(`10.1.${i}.1`) })).permitido, true);
    assert.equal((await limitar({ recurso: "pedido", slug: "joyeria", request: desde("10.9.9.9") })).permitido, false, "catálogo lleno");
    assert.equal((await limitar({ recurso: "pedido", slug: "otra-joyeria", request: desde("10.9.9.9") })).permitido, true, "otro catálogo no");

    const fresco = contadorVentanaFija(() => t);
    const l2 = crearLimitadorPublico(fresco.verificar, () => t);
    for (let i = 0; i < 25; i++) await l2({ recurso: "pedido", slug: "joyeria", request: desde("6.6.6.6") });
    assert.equal(fresco.claves.filter((k) => k.startsWith("catalogo-pedido-catalogo")).length, 20, "las 5 bloqueadas por IP no tocan el cupo del catálogo");
  });

  it("selección: 120 por IP por minuto", async () => {
    const t = Date.parse("2026-09-24T10:00:30Z");
    const { verificar } = contadorVentanaFija(() => t);
    const limitar = crearLimitadorPublico(verificar, () => t);
    for (let i = 0; i < 120; i++) assert.equal((await limitar({ recurso: "seleccion", slug: "joyeria", request: desde("3.3.3.3") })).permitido, true);
    assert.deepEqual(await limitar({ recurso: "seleccion", slug: "joyeria", request: desde("3.3.3.3") }), { permitido: false, reintentarEnSeg: 30 });
  });

  it("la IP nunca se guarda: la clave lleva un hash corto con sal", async () => {
    const { verificar, claves } = contadorVentanaFija(() => 0);
    await crearLimitadorPublico(verificar)({ recurso: "pedido", slug: "joyeria", request: new Request("https://x.test", { headers: { "x-real-ip": "203.0.113.7" } }) });
    assert.ok(claves.every((k) => !k.includes("203.0.113.7")));
    assert.ok(claves.some((k) => k.includes(refDeIp("203.0.113.7"))));
    assert.match(refDeIp("203.0.113.7"), /^[0-9a-f]{16}$/);
    assert.equal(ipDe(new Request("https://x.test", { headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "8.8.8.8" } })), "9.9.9.9");
    assert.equal(ipDe(new Request("https://x.test", { headers: { "x-forwarded-for": "8.8.8.8, 10.0.0.1" } })), "8.8.8.8");
    assert.equal(ipDe(new Request("https://x.test")), "sin-ip");
  });
});

describe("rutas públicas con el límite (pedido y selección)", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let sink: ReturnType<typeof memoryOrderEventSink>;
  let publico: ReturnType<typeof createPublicCatalogService>;
  let slug: string;
  let ref: string;

  beforeEach(async () => {
    mem = createInMemoryCatalogRepository();
    const admin = createCatalogService({ repo: mem.repo });
    sink = memoryOrderEventSink();
    publico = createPublicCatalogService({ repo: mem.repo, orders: { key: Buffer.alloc(32, 9), events: sink } });
    mem.setProfile(A.tenantId, { name: "Joyería", whatsapp: "573001112233" });
    mem.enableModule(A.tenantId);
    slug = (await admin.ensurePublication(A)).slug;
    ref = (await admin.createProduct(A, { name: "Anillo", retailPrice: 10_000, stock: 50 })).reference;
  });

  it("pasado el límite: 429 con Retry-After y NO se guarda ninguna solicitud más", async () => {
    const t = Date.now();
    const limitar: LimitadorPublico = crearLimitadorPublico(contadorVentanaFija(() => t).verificar, () => t);
    const pedir = (n: number) =>
      responderPedido(
        new Request(`https://x.test/catalogo/${slug}/pedido`, { method: "POST", headers: { "x-real-ip": "1.2.3.4" }, body: JSON.stringify({ items: [{ reference: ref, quantity: 1 }], requestKey: `clave-intento-${String(n).padStart(8, "0")}` }) }),
        { slug, context: "retail" },
        () => publico,
        limitar,
      );
    for (let i = 0; i < 20; i++) assert.notEqual((await pedir(i)).status, 429);
    const guardadas = sink.events.length;
    const r = await pedir(99);
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("retry-after")) > 0);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual(await r.json(), { error: "too_many_requests" });
    assert.equal(sink.events.length, guardadas, "el intento bloqueado no llegó al servicio");
  });

  it("selección bloqueada => 429 sin consultar el catálogo", async () => {
    let consultas = 0;
    const r = await responderSeleccion(new Request(`https://x.test/?ref=${ref}`), { slug, context: "retail" }, () => (consultas++, publico), async () => ({ permitido: false, reintentarEnSeg: 12 }));
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "12");
    assert.equal(consultas, 0);
  });
});

describe("limitador real (RPC distribuida) cableado con Supabase", () => {
  let db: SupabaseMemoria;
  beforeEach(() => (db = installSupabaseMemoria(process.env.SUPABASE_URL)));
  afterEach(() => db.uninstall());

  it("usa dulabs_rate_limit_incrementar con la clave hasheada y respeta su decisión", async () => {
    const vistas: Array<Record<string, unknown>> = [];
    let n = 0;
    db.rpc("dulabs_rate_limit_incrementar", (args) => {
      vistas.push(args);
      n++;
      return { data: [{ permitido: n <= 1, conteo: n, reinicia_en: new Date(Date.now() + 60_000).toISOString() }] };
    });
    assert.equal((await limitadorPublicoReal({ recurso: "seleccion", slug: "joyeria", request: desde("5.5.5.5") })).permitido, true);
    assert.equal((await limitadorPublicoReal({ recurso: "seleccion", slug: "joyeria", request: desde("5.5.5.5") })).permitido, false);
    assert.deepEqual(vistas[0], { p_clave: `catalogo-seleccion-ip:${refDeIp("5.5.5.5")}`, p_ventana_seg: 60, p_limite: 120 });
  });

  it("sin la RPC (migración ausente) => se permite (proteger no tumba ventas)", async () => {
    assert.equal((await limitadorPublicoReal({ recurso: "pedido", slug: "joyeria", request: desde("5.5.5.5") })).permitido, true);
  });
});

describe("autorización de crons", () => {
  it("sin CRON_SECRET nada pasa (antes 'Bearer undefined' pasaba); comparación exacta", () => {
    assert.equal(bearerCronValido("Bearer undefined", undefined), false);
    assert.equal(bearerCronValido("Bearer ", ""), false);
    assert.equal(bearerCronValido(null, "secreto-de-prueba-123"), false);
    assert.equal(bearerCronValido("Bearer secreto-de-prueba-12", "secreto-de-prueba-123"), false);
    assert.equal(bearerCronValido("Basic secreto-de-prueba-123", "secreto-de-prueba-123"), false);
    assert.equal(bearerCronValido("Bearer secreto-de-prueba-123", "secreto-de-prueba-123"), true);
  });
});

describe("retención de los datos del agente", () => {
  let db: SupabaseMemoria;
  const ahora = Date.parse("2026-09-24T04:45:00Z");
  const hace = (dias: number) => new Date(ahora - dias * DIA).toISOString();
  let purgadas: number[];

  beforeEach(() => {
    db = installSupabaseMemoria(process.env.SUPABASE_URL);
    purgadas = [];
    db.rpc("dulabs_agente_trazas_purgar", (args) => {
      purgadas.push(Number(args.p_dias));
      return { data: 7 };
    });
    db.table("dulabs_agente_buzon", { identity: "id" }).push(
      { id: 1, wa_id: "573001112233", wamid: "w1", texto: null, recibido_at: hace(30), procesado_at: hace(30) },
      { id: 2, wa_id: "573001112233", wamid: "w2", texto: "hola", recibido_at: hace(20), procesado_at: null },
      { id: 3, wa_id: "573001112233", wamid: "w3", texto: null, recibido_at: hace(1), procesado_at: hace(1) },
    );
    db.table("dulabs_agente_medios_enviados", { identity: "id" }).push(
      { id: 1, wamid: "m1", referencia: "DL-000001", created_at: hace(120) },
      { id: 2, wamid: "m2", referencia: "DL-000002", created_at: hace(10) },
    );
  });
  afterEach(() => db.uninstall());

  it("borra solo lo vencido (buzón 14 días, fotos 90, trazas 90) y no toca lo reciente", async () => {
    const r = await purgarDatosAgente(supabaseAdmin(), ahora);
    assert.deepEqual(r, { trazas: { borradas: 7 }, buzon: { borradas: 2 }, medios: { borradas: 1 } });
    assert.deepEqual(purgadas, [RETENCION_DIAS.trazas]);
    assert.deepEqual(db.rows("dulabs_agente_buzon").map((b) => b.wamid), ["w3"]);
    assert.deepEqual(db.rows("dulabs_agente_medios_enviados").map((m) => m.wamid), ["m2"]);
  });

  it("sin migraciones: cuenta 0 y no falla", async () => {
    db.missing("dulabs_agente_buzon");
    db.missing("dulabs_agente_medios_enviados");
    const vacio = installSupabaseMemoria(process.env.SUPABASE_URL); // sin la RPC de purga
    const r = await purgarDatosAgente(supabaseAdmin(), ahora);
    vacio.uninstall();
    assert.deepEqual(r, { trazas: { borradas: 0 }, buzon: { borradas: 0 }, medios: { borradas: 0 } });
  });

  it("cron: sin secreto o con uno falso => 401 sin borrar; autorizado => 200 con el resumen", async () => {
    const previo = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      const sinSecreto = await retencionGET(new NextRequest("http://localhost/api/cron/agente-retencion", { headers: { authorization: "Bearer undefined" } }));
      assert.equal(sinSecreto.status, 401);
      process.env.CRON_SECRET = "secreto-cron-de-prueba-0123";
      assert.equal((await retencionGET(new NextRequest("http://localhost/api/cron/agente-retencion", { headers: { authorization: "Bearer otro" } }))).status, 401);
      assert.equal(db.rows("dulabs_agente_buzon").length, 3, "nada se borró sin autorización");
      const ok = await retencionGET(new NextRequest("http://localhost/api/cron/agente-retencion", { headers: { authorization: "Bearer secreto-cron-de-prueba-0123" } }));
      assert.equal(ok.status, 200);
      const body = (await ok.json()) as Record<string, { borradas: number }>;
      assert.equal(body.trazas.borradas, 7);
      assert.equal(db.rows("dulabs_agente_medios_enviados").length, 1);
    } finally {
      if (previo === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previo;
    }
  });
});
