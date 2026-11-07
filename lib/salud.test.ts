/**
 * Salud para el alojamiento y sondeo honesto de Supabase Auth (lib/salud.ts), sin red: el `fetch` es de mentira y el reloj se inyecta.
 * Lo que debe quedar protegido: nunca se aparenta que el inicio de sesión funciona si el servicio no responde; un sondeo LENTO no se toma por una caída;
 * nada sensible (URL, llave, cuerpo) sale en el resultado; y el sondeo público no puede golpear a Supabase más de una vez cada 10 s.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { VIGENCIA_SONDEO_MS, olvidarSondeoParaPruebas, sondearAuth, sondearAuthConCache } from "@/lib/salud";

const URL_SUPABASE = "https://proyecto-de-prueba.supabase.co";
const LLAVE = "llave-publica-de-prueba-123";

const responde = (status: number) => async () => new Response('{"detalle":"texto-privado-de-supabase"}', { status });
const fallaCon = (err: unknown) => async (): Promise<Response> => {
  throw err;
};
const errorDeRed = (codigo: string) => Object.assign(new TypeError("fetch failed"), { cause: { code: codigo } });

beforeEach(() => olvidarSondeoParaPruebas());

describe("sondearAuth", () => {
  it("sin URL o sin llave: «sin configurar», y ni siquiera se pregunta a la red", async () => {
    let llamadas = 0;
    const fetchFn = (async () => {
      llamadas++;
      return new Response("{}");
    }) as typeof fetch;
    for (const opciones of [{}, { url: URL_SUPABASE }, { llave: LLAVE }, { url: "", llave: LLAVE }, { url: URL_SUPABASE, llave: null }]) {
      assert.deepEqual(await sondearAuth({ ...opciones, fetchFn }), { estado: "sin-configurar" });
    }
    assert.equal(llamadas, 0);
  });

  it("200: ok, y se pregunta a /auth/v1/health con la llave pública y un tiempo máximo (también si la URL termina en «/»)", async () => {
    const pedidos: Array<{ url: string; apikey: string | null; conTiempoMaximo: boolean }> = [];
    const fetchFn = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      pedidos.push({ url: String(entrada), apikey: new Headers(init?.headers).get("apikey"), conTiempoMaximo: init?.signal instanceof AbortSignal });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    assert.deepEqual(await sondearAuth({ url: URL_SUPABASE, llave: LLAVE, fetchFn }), { estado: "ok" });
    assert.deepEqual(await sondearAuth({ url: `${URL_SUPABASE}///`, llave: LLAVE, fetchFn }), { estado: "ok" });
    assert.deepEqual(pedidos, [
      { url: `${URL_SUPABASE}/auth/v1/health`, apikey: LLAVE, conTiempoMaximo: true },
      { url: `${URL_SUPABASE}/auth/v1/health`, apikey: LLAVE, conTiempoMaximo: true },
    ]);
  });

  it("402 (proyecto restringido), 5xx y 4xx (proyecto o llave que no son): NO disponible, con su motivo", async () => {
    const caso = async (status: number) => sondearAuth({ url: URL_SUPABASE, llave: LLAVE, fetchFn: responde(status) as typeof fetch });
    assert.deepEqual(await caso(402), { estado: "no-disponible", motivo: "http-402" });
    for (const s of [500, 502, 503, 504, 540]) assert.deepEqual(await caso(s), { estado: "no-disponible", motivo: "http-5xx" }, String(s));
    for (const s of [401, 403, 404, 429]) assert.deepEqual(await caso(s), { estado: "no-disponible", motivo: "http-4xx" }, String(s));
  });

  it("sin DNS (el proyecto no existe o está pausado): no disponible por «dns»; el resto de fallos de red: «conexion»", async () => {
    const caso = async (err: unknown) => sondearAuth({ url: URL_SUPABASE, llave: LLAVE, fetchFn: fallaCon(err) as typeof fetch });
    assert.deepEqual(await caso(errorDeRed("ENOTFOUND")), { estado: "no-disponible", motivo: "dns" });
    assert.deepEqual(await caso(errorDeRed("EAI_AGAIN")), { estado: "no-disponible", motivo: "dns" });
    assert.deepEqual(await caso(errorDeRed("ECONNREFUSED")), { estado: "no-disponible", motivo: "conexion" });
    assert.deepEqual(await caso(new Error("algo raro")), { estado: "no-disponible", motivo: "conexion" });
    assert.deepEqual(await caso(undefined), { estado: "no-disponible", motivo: "conexion" });
  });

  it("si no contesta a tiempo es «lento», NO una caída (puede estar sano)", async () => {
    const caso = async (nombre: string) => sondearAuth({ url: URL_SUPABASE, llave: LLAVE, fetchFn: fallaCon(Object.assign(new Error("x"), { name: nombre })) as typeof fetch });
    assert.deepEqual(await caso("TimeoutError"), { estado: "lento", motivo: "tiempo" });
    assert.deepEqual(await caso("AbortError"), { estado: "lento", motivo: "tiempo" });
  });

  it("el tiempo máximo es REAL: un fetch que nunca contesta se corta y queda «lento» sin esperar de más", async () => {
    const colgado = ((_entrada: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolver, rechazar) => init?.signal?.addEventListener("abort", () => rechazar(init.signal?.reason ?? new Error("abortado"))))) as typeof fetch;
    const inicio = Date.now();
    const r = await sondearAuth({ url: URL_SUPABASE, llave: LLAVE, fetchFn: colgado, esperaMs: 30 });
    assert.deepEqual(r, { estado: "lento", motivo: "tiempo" });
    assert.ok(Date.now() - inicio < 1_500, "no esperó el tiempo máximo normal de 3 s");
  });

  it("el resultado nunca lleva la URL, la llave ni lo que contestó Supabase", async () => {
    for (const fetchFn of [responde(200), responde(402), responde(500), fallaCon(errorDeRed("ENOTFOUND"))]) {
      const texto = JSON.stringify(await sondearAuth({ url: URL_SUPABASE, llave: LLAVE, fetchFn: fetchFn as typeof fetch }));
      for (const secreto of ["proyecto-de-prueba", "supabase.co", LLAVE, "texto-privado-de-supabase"]) assert.ok(!texto.includes(secreto), `se coló «${secreto}» en ${texto}`);
    }
  });
});

describe("sondearAuthConCache", () => {
  it("reutiliza el resultado durante 10 s: muchas consultas, una sola pregunta a Supabase por instancia", async () => {
    let llamadas = 0;
    const fetchFn = (async () => {
      llamadas++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    let ahora = 1_000_000;
    const consulta = () => sondearAuthConCache({ url: URL_SUPABASE, llave: LLAVE, fetchFn }, () => ahora);
    for (let i = 0; i < 20; i++) assert.deepEqual(await consulta(), { estado: "ok" });
    assert.equal(llamadas, 1);
    ahora += VIGENCIA_SONDEO_MS - 1;
    await consulta();
    assert.equal(llamadas, 1, "todavía vigente");
    ahora += 1;
    await consulta();
    assert.equal(llamadas, 2, "vencido: vuelve a preguntar");
  });

  it("si Supabase cambia de estado, se nota al vencer la vigencia (no antes ni nunca)", async () => {
    let status = 200;
    const fetchFn = (async () => new Response("{}", { status })) as typeof fetch;
    let ahora = 5_000_000;
    const consulta = () => sondearAuthConCache({ url: URL_SUPABASE, llave: LLAVE, fetchFn }, () => ahora);
    assert.equal((await consulta()).estado, "ok");
    status = 402;
    assert.equal((await consulta()).estado, "ok", "dentro de la vigencia se conserva lo anterior");
    ahora += VIGENCIA_SONDEO_MS;
    assert.deepEqual(await consulta(), { estado: "no-disponible", motivo: "http-402" });
  });
});
