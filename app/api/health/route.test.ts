/**
 * /api/health — vida del proceso y sondeo honesto de Supabase Auth (con las rutas REALES; el fetch hacia Supabase es de mentira).
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { olvidarSondeoParaPruebas } from "@/lib/salud";
import { GET, POST } from "@/app/api/health/route";

const URL_SUPABASE = "https://proyecto-de-prueba.supabase.co";
const LLAVE = "llave-publica-de-prueba-123";
const ENV = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

let fetchOriginal: typeof fetch;
let envOriginal: Record<string, string | undefined>;
let preguntasASupabase: number;

const peticion = (ruta: string, metodo = "GET") => new NextRequest(`http://localhost${ruta}`, { method: metodo });
const simular = (respuesta: () => Promise<Response>) => {
  globalThis.fetch = (async () => {
    preguntasASupabase++;
    return respuesta();
  }) as typeof fetch;
};

beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  envOriginal = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  preguntasASupabase = 0;
  olvidarSondeoParaPruebas();
  process.env.SUPABASE_URL = URL_SUPABASE;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = LLAVE;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const k of ENV) {
    if (envOriginal[k] === undefined) delete process.env[k];
    else process.env[k] = envOriginal[k];
  }
});

describe("vida (sin ?deep)", () => {
  it("GET y POST (QStash hace POST) responden 200 con el estado básico, sin caché y SIN preguntar a Supabase", async () => {
    simular(async () => new Response("{}", { status: 500 }));
    for (const respuesta of [await GET(peticion("/api/health")), await POST(peticion("/api/health", "POST"))]) {
      assert.equal(respuesta.status, 200);
      assert.equal(respuesta.headers.get("cache-control"), "no-store");
      const cuerpo = await respuesta.json();
      assert.deepEqual({ ok: cuerpo.ok, servicio: cuerpo.servicio, auth: cuerpo.auth }, { ok: true, servicio: "dulabs", auth: undefined });
      assert.equal(typeof cuerpo.uptime_s, "number");
    }
    assert.equal(preguntasASupabase, 0, "la vida no depende de Supabase");
  });

  it("responde 200 aunque no haya NINGUNA variable de Supabase (el proceso está vivo)", async () => {
    for (const k of ENV) delete process.env[k];
    assert.equal((await GET(peticion("/api/health"))).status, 200);
  });
});

describe("sondeo de Supabase Auth (?deep=1)", () => {
  it("Supabase responde: 200 con auth ok", async () => {
    simular(async () => new Response("{}", { status: 200 }));
    const respuesta = await GET(peticion("/api/health?deep=1"));
    assert.equal(respuesta.status, 200);
    assert.deepEqual((await respuesta.json()).auth, { estado: "ok" });
  });

  it("Supabase restringido (402): 503 y ok:false — el inicio de sesión NO aparenta funcionar", async () => {
    simular(async () => new Response("{}", { status: 402 }));
    const respuesta = await GET(peticion("/api/health?deep=1"));
    assert.equal(respuesta.status, 503);
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.ok, false);
    assert.deepEqual(cuerpo.auth, { estado: "no-disponible", motivo: "http-402" });
  });

  it("el proyecto no existe o está pausado (sin DNS): 503 por «dns»", async () => {
    simular(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    });
    const respuesta = await POST(peticion("/api/health?deep=1", "POST"));
    assert.equal(respuesta.status, 503);
    assert.deepEqual((await respuesta.json()).auth, { estado: "no-disponible", motivo: "dns" });
  });

  it("sin configurar las variables de Supabase: 503 «sin-configurar»", async () => {
    for (const k of ENV) delete process.env[k];
    simular(async () => new Response("{}", { status: 200 }));
    const respuesta = await GET(peticion("/api/health?deep=1"));
    assert.equal(respuesta.status, 503);
    assert.deepEqual((await respuesta.json()).auth, { estado: "sin-configurar" });
    assert.equal(preguntasASupabase, 0);
  });

  it("una respuesta LENTA no saca de servicio una instancia sana: 200 con auth «lento»", async () => {
    simular(async () => {
      throw Object.assign(new Error("tiempo"), { name: "TimeoutError" });
    });
    const respuesta = await GET(peticion("/api/health?deep=1"));
    assert.equal(respuesta.status, 200);
    assert.deepEqual((await respuesta.json()).auth, { estado: "lento", motivo: "tiempo" });
  });

  it("usa NEXT_PUBLIC_SUPABASE_URL si falta SUPABASE_URL, y solo pregunta una vez en 10 s aunque la pidan muchas veces", async () => {
    delete process.env.SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_SUPABASE;
    simular(async () => new Response("{}", { status: 200 }));
    for (let i = 0; i < 15; i++) assert.equal((await GET(peticion("/api/health?deep=1"))).status, 200);
    assert.equal(preguntasASupabase, 1);
  });

  it("jamás devuelve la URL, la llave ni lo que contestó Supabase", async () => {
    simular(async () => new Response('{"detalle":"texto-privado-de-supabase"}', { status: 500 }));
    const texto = await (await GET(peticion("/api/health?deep=1"))).text();
    for (const secreto of ["proyecto-de-prueba", "supabase.co", LLAVE, "texto-privado-de-supabase"]) assert.ok(!texto.includes(secreto), `se coló «${secreto}»`);
  });
});
