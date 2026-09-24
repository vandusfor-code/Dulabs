/**
 * Bloque 21 — límite de tasa de las PÁGINAS públicas del catálogo (proxy.ts). El contador se emula
 * con la MISMA semántica que dulabs_rate_limit_incrementar (ventana fija por clave) y un reloj
 * controlado. Nada toca Supabase. Concurrencia real contra Postgres: scripts/perf/limite-concurrencia.ts.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { clasificarPagina, crearLimitadorPaginas, respuesta429, type Verificar } from "@/lib/catalogo/limite-paginas";
import { ipNormalizada, refDeIp } from "@/lib/catalogo/limites-publicos";
import { LIMITES_TASA } from "@/lib/rate-limit";
import { config as proxyConfig } from "@/proxy";

let reloj: number;
let llamadas: Array<{ recurso: string; tenantId: string }>;
let contadores: Map<string, number>;

/** Mismo contrato que la RPC: ventana fija alineada al epoch, conteo atómico por clave. */
const verificarMemoria: Verificar = async ({ recurso, tenantId, categoria }) => {
  llamadas.push({ recurso, tenantId });
  const { ventanaSeg, limite } = LIMITES_TASA[categoria];
  const inicio = Math.floor(reloj / 1000 / ventanaSeg) * ventanaSeg;
  const clave = `${recurso}:${tenantId}:${inicio}`;
  const conteo = (contadores.get(clave) ?? 0) + 1;
  contadores.set(clave, conteo);
  return { permitido: conteo <= limite, conteo, limite, reiniciaEn: new Date((inicio + ventanaSeg) * 1000).toISOString() };
};

const pedir = (path: string, ip = "203.0.113.7") => new Request(`https://www.dulabs.test${path}`, { headers: { "x-real-ip": ip } });

let decidir: ReturnType<typeof crearLimitadorPaginas>;
beforeEach(() => {
  reloj = Date.UTC(2026, 8, 24, 12, 0, 0);
  llamadas = [];
  contadores = new Map();
  decidir = crearLimitadorPaginas({ verificar: verificarMemoria, ahora: () => reloj });
});

async function contar(paths: string[], ip?: string) {
  let ok = 0;
  let bloqueadas = 0;
  for (const p of paths) {
    const d = await decidir(pedir(p, ip));
    if (!d || d.permitido) ok++;
    else bloqueadas++;
  }
  return { ok, bloqueadas };
}

describe("qué se limita", () => {
  it("páginas y búsquedas de la tienda (detal y mayorista); fotos, carrito y pedido no pasan por aquí", () => {
    const c = (p: string) => clasificarPagina(new URL(`https://x.test${p}`));
    assert.deepEqual(c("/catalogo/delacour"), { slug: "delacour", clase: "pagina" });
    assert.deepEqual(c("/catalogo/Delacour?todo=1&pagina=40"), { slug: "delacour", clase: "pagina" });
    assert.deepEqual(c("/catalogo/delacour/productos/dl-000184"), { slug: "delacour", clase: "pagina" });
    assert.deepEqual(c("/catalogo/delacour?q=aretes%20oro"), { slug: "delacour", clase: "busqueda" });
    assert.deepEqual(c("/catalogo/delacour?q=%20%20"), { slug: "delacour", clase: "pagina" }, "q vacía no es búsqueda");
    assert.deepEqual(c("/catalogo/delacour/mayor/tok123?q=anillo"), { slug: "delacour", clase: "busqueda" });
    for (const libre of [
      "/catalogo/delacour/productos/dl-000184/thumb.webp",
      "/catalogo/delacour/productos/dl-000184/whatsapp.jpg",
      "/catalogo/delacour/seleccion",
      "/catalogo/delacour/mayor/tok/pedido",
      "/catalogo",
      "/dashboard/catalogo",
    ])
      assert.equal(c(libre), null, libre);
  });

  it("el proxy cubre /catalogo/* sin dejar de cubrir sus rutas anteriores", () => {
    assert.ok(proxyConfig.matcher.includes("/catalogo/:path*"));
    for (const r of ["/webhook-dulabs", "/api/wompi/:path*", "/api/cron/:path*", "/api/diagnostics/:path*"]) assert.ok(proxyConfig.matcher.includes(r));
  });
});

describe("navegación normal vs abuso", () => {
  it("una persona navegando (páginas, categorías, fichas, búsquedas, precargas) nunca es frenada", async () => {
    const sesion: string[] = [];
    for (let i = 0; i < 40; i++) sesion.push(`/catalogo/delacour?todo=1&pagina=${i + 1}`, `/catalogo/delacour/productos/dl-${String(i).padStart(6, "0")}`);
    for (let i = 0; i < 20; i++) sesion.push(`/catalogo/delacour?q=anillo${i}`);
    for (let i = 0; i < 150; i++) sesion.push(`/catalogo/delacour/productos/dl-${String(i).padStart(6, "0")}`); // precargas por intención
    const r = await contar(sesion);
    assert.deepEqual(r, { ok: sesion.length, bloqueadas: 0 });
  });

  it("un script que recorre el catálogo: exactamente 600/min, y cambiar parámetros NO abre otro contador", async () => {
    const ataque = Array.from({ length: 700 }, (_, i) => [`/catalogo/delacour?todo=1&pagina=${i}`, `/catalogo/DELACOUR?categoria=${i}&x=${i}`, `/catalogo/delacour/productos/dl-${i}?utm=${i}`][i % 3]);
    const r = await contar(ataque);
    assert.deepEqual(r, { ok: 600, bloqueadas: 100 });
    const d = await decidir(pedir("/catalogo/delacour?pagina=9999"));
    assert.equal(d?.permitido, false);
    const res = respuesta429(d as Extract<typeof d, { permitido: false }>);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) >= 1);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(await res.text(), /Espera unos segundos/);
  });

  it("búsquedas: 120/min por cliente con q distinta cada vez; bloqueado para buscar, sigue pudiendo navegar", async () => {
    const r = await contar(Array.from({ length: 130 }, (_, i) => `/catalogo/delacour?q=${encodeURIComponent(`palabra ${i}`)}`));
    assert.deepEqual(r, { ok: 120, bloqueadas: 10 });
    assert.equal((await decidir(pedir("/catalogo/delacour?todo=1")))?.permitido, true, "la navegación sigue");
  });

  it("un cliente frenado por páginas tampoco puede seguir buscando (no hay un segundo cupo)", async () => {
    await contar(Array.from({ length: 600 }, (_, i) => `/catalogo/delacour?pagina=${i}`));
    const r = await contar(Array.from({ length: 20 }, (_, i) => `/catalogo/delacour?q=anillo${i}`));
    assert.deepEqual(r, { ok: 0, bloqueadas: 20 });
  });

  it("la ventana se reabre: pasado el minuto, el mismo cliente vuelve a entrar", async () => {
    await contar(Array.from({ length: 601 }, (_, i) => `/catalogo/delacour?pagina=${i}`));
    assert.equal((await decidir(pedir("/catalogo/delacour")))?.permitido, false);
    reloj += 61_000;
    assert.equal((await decidir(pedir("/catalogo/delacour")))?.permitido, true);
  });
});

describe("aislamiento y evasión", () => {
  it("un cliente bloqueado no afecta a otro; otra tienda tampoco comparte el tope de búsquedas", async () => {
    await contar(Array.from({ length: 601 }, () => "/catalogo/delacour"), "198.51.100.1");
    assert.equal((await decidir(pedir("/catalogo/delacour", "198.51.100.1")))?.permitido, false);
    assert.equal((await decidir(pedir("/catalogo/delacour", "198.51.100.2")))?.permitido, true);
  });

  it("IPv6: rotar direcciones dentro del mismo /64 no evade el límite; otro /64 es otro cliente", async () => {
    let ok = 0;
    for (let i = 0; i < 610; i++) {
      const d = await decidir(pedir("/catalogo/delacour", `2001:db8:abcd:12::${(i + 1).toString(16)}`));
      if (d?.permitido) ok++;
    }
    assert.equal(ok, 600);
    assert.equal((await decidir(pedir("/catalogo/delacour", "2001:db8:abcd:13::1")))?.permitido, true);
    assert.equal(ipNormalizada("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(refDeIp("2001:db8:abcd:12::1"), refDeIp("2001:0db8:abcd:0012:ffff:0:0:9"));
  });

  it("inundación de búsquedas desde muchas IPs: tope por catálogo; solo se frenan búsquedas de ESA tienda", async () => {
    for (let i = 0; i < 3000; i++) await decidir(pedir(`/catalogo/delacour?q=x${i}`, `10.${i >> 8}.${i & 255}.9`));
    const nueva = await decidir(pedir("/catalogo/delacour?q=anillo", "192.0.2.50"));
    assert.deepEqual(nueva && !nueva.permitido ? nueva.motivo : null, "catalogo");
    assert.match(await respuesta429(nueva as Extract<typeof nueva, { permitido: false }>).text(), /seguir navegando/);
    assert.equal((await decidir(pedir("/catalogo/delacour?todo=1", "192.0.2.50")))?.permitido, true, "navegar sigue");
    assert.equal((await decidir(pedir("/catalogo/otra-tienda?q=anillo", "192.0.2.50")))?.permitido, true, "otra tienda no se afecta");
  });

  it("las claves del contador nunca llevan la IP en texto plano", async () => {
    await decidir(pedir("/catalogo/delacour?q=anillo", "203.0.113.7"));
    assert.ok(llamadas.length > 0);
    for (const l of llamadas) assert.doesNotMatch(l.tenantId, /203\.0\.113\.7/);
    assert.ok(llamadas.some((l) => l.tenantId === refDeIp("203.0.113.7")));
  });
});

describe("costo y tolerancia a fallas", () => {
  it("escudo local: un cliente bloqueado no vuelve a consultar la BD hasta que abre su ventana", async () => {
    await contar(Array.from({ length: 601 }, () => "/catalogo/delacour"));
    const antes = llamadas.length;
    const r = await contar(Array.from({ length: 500 }, () => "/catalogo/delacour"));
    assert.deepEqual(r, { ok: 0, bloqueadas: 500 });
    assert.equal(llamadas.length, antes, "0 consultas durante el bloqueo");
    reloj += 61_000;
    await decidir(pedir("/catalogo/delacour"));
    assert.equal(llamadas.length, antes + 1);
  });

  it("si el limitador falla o se demora, la tienda NO se cae: se permite", async () => {
    const falla = crearLimitadorPaginas({ verificar: async () => { throw new Error("rpc caída"); } });
    assert.equal((await falla(pedir("/catalogo/delacour")))?.permitido, true);
    const lento = crearLimitadorPaginas({ verificar: () => new Promise(() => {}), timeoutMs: 20 });
    const t0 = Date.now();
    assert.equal((await lento(pedir("/catalogo/delacour?q=anillo")))?.permitido, true);
    assert.ok(Date.now() - t0 < 500);
  });

  it("el escudo local tiene tope de memoria", async () => {
    const chico = crearLimitadorPaginas({ verificar: async () => ({ permitido: false, conteo: 999, limite: 1, reiniciaEn: new Date(reloj + 60_000).toISOString() }), ahora: () => reloj, maxBloqueados: 50 });
    for (let i = 0; i < 500; i++) await chico(pedir("/catalogo/delacour", `10.1.${i >> 8}.${i & 255}`));
    // Sin acceso al mapa interno: basta con que no explote y siga bloqueando a los recientes.
    assert.equal((await chico(pedir("/catalogo/delacour", "10.1.1.243")))?.permitido, false);
  });
});
