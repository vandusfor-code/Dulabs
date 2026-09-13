/**
 * FASE 8.5 (Connection Lifecycle, autorizado) — tests puros de
 * `desconectarNumeroWhatsapp`/`escribirToleranteAColumnaFaltante`. Fake de
 * Supabase en memoria (mismo patrón que lib/amore-inventario.test.ts) y fetch
 * global interceptado SOLO hacia graph.facebook.com (mismo criterio que
 * app/api/auth/meta-callback/route.test.ts) -- nunca llama a Meta real.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");

import { cifrarSecreto } from "@/lib/crypto";
import { desconectarNumeroWhatsapp, escribirToleranteAColumnaFaltante } from "@/lib/whatsapp-connection-lifecycle";

type FilaConfig = {
  id_tenant: string;
  phone_number_id: string;
  whatsapp_business_account_id: string;
  meta_permanent_token: string | null;
  flow_activo: boolean;
  flow_id: string | null;
  trigger_routing_activo: boolean;
  nombre_negocio: string;
  ia_pausada: boolean;
  estado_conexion?: string;
  desconectado_en?: string | null;
  updated_at?: string;
};

/** Simula si la migración 20260928000000 ya se aplicó -- controla si el fake rechaza escribir `estado_conexion`. */
function crearFakeSupabase(seed: FilaConfig[], opts: { columnaEstadoConexionExiste: boolean }) {
  const filas = seed;
  const actualizaciones: Record<string, unknown>[] = [];

  function from(tabla: string) {
    if (tabla !== "dulabs_clientes_config") throw new Error(`fake de prueba: tabla inesperada "${tabla}"`);
    const filtros: [string, unknown][] = [];
    const builder = {
      select() {
        return builder;
      },
      eq(campo: string, valor: unknown) {
        filtros.push([campo, valor]);
        return builder;
      },
      maybeSingle() {
        const fila = filas.find((f) => filtros.every(([campo, valor]) => (f as unknown as Record<string, unknown>)[campo] === valor));
        return Promise.resolve({ data: fila ?? null, error: null });
      },
      update(datos: Record<string, unknown>) {
        actualizaciones.push(datos);
        const updater = {
          eq(campo: string, valor: unknown) {
            filtros.push([campo, valor]);
            return updater;
          },
          then(resolve: (r: { error: { code?: string; message?: string } | null }) => unknown) {
            if (!opts.columnaEstadoConexionExiste && Object.prototype.hasOwnProperty.call(datos, "estado_conexion")) {
              return resolve({ error: { code: "42703", message: 'column "estado_conexion" of relation "dulabs_clientes_config" does not exist' } });
            }
            for (const f of filas) {
              if (filtros.every(([campo, valor]) => (f as unknown as Record<string, unknown>)[campo] === valor)) {
                Object.assign(f, datos);
              }
            }
            return resolve({ error: null });
          },
        };
        return updater;
      },
    };
    return builder;
  }

  return { supabase: { from } as unknown as SupabaseClient, filas, actualizaciones };
}

function filaBase(overrides: Partial<FilaConfig> = {}): FilaConfig {
  return {
    id_tenant: "tenant-a",
    phone_number_id: "phone-a",
    whatsapp_business_account_id: "waba-a",
    meta_permanent_token: cifrarSecreto("token-real-de-meta"),
    flow_activo: true,
    flow_id: "flow-a",
    trigger_routing_activo: true,
    nombre_negocio: "Negocio de prueba",
    ia_pausada: false,
    ...overrides,
  };
}

let fetchOriginal: typeof fetch;
let llamadasGraph: { url: string; token: string | null }[];

beforeEach(() => {
  fetchOriginal = global.fetch;
  llamadasGraph = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("graph.facebook.com")) throw new Error(`fetch real bloqueado en test: ${url}`);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    llamadasGraph.push({ url, token: auth ? auth.replace("Bearer ", "") : null });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  global.fetch = fetchOriginal;
});

describe("desconectarNumeroWhatsapp — ownership y fail-closed", () => {
  it("1. tenant/número inexistente -> no_encontrado, no llama a Meta", async () => {
    const { supabase } = crearFakeSupabase([], { columnaEstadoConexionExiste: true });
    const r = await desconectarNumeroWhatsapp(supabase, { tenantId: "t1", phoneNumberId: "p1" });
    assert.deepEqual(r, { ok: false, motivo: "no_encontrado" });
    assert.equal(llamadasGraph.length, 0);
  });

  it("2. phone_number_id existe pero pertenece a OTRO tenant -> no_encontrado (fail-closed, nunca cruza tenants)", async () => {
    const { supabase } = crearFakeSupabase([filaBase({ id_tenant: "tenant-dueño" })], { columnaEstadoConexionExiste: true });
    const r = await desconectarNumeroWhatsapp(supabase, { tenantId: "tenant-atacante", phoneNumberId: "phone-a" });
    assert.deepEqual(r, { ok: false, motivo: "no_encontrado" });
    assert.equal(llamadasGraph.length, 0, "nunca debe intentar desuscribir un WABA que no es del tenant que pide el disconnect");
  });
});

describe("desconectarNumeroWhatsapp — preservación de datos de negocio", () => {
  it("3. limpia SOLO meta_permanent_token -- flow_activo/flow_id/trigger_routing_activo/nombre_negocio/ia_pausada quedan intactos", async () => {
    const { supabase, filas } = crearFakeSupabase([filaBase()], { columnaEstadoConexionExiste: true });
    const r = await desconectarNumeroWhatsapp(supabase, { tenantId: "tenant-a", phoneNumberId: "phone-a" });
    assert.equal(r.ok, true);
    const fila = filas[0];
    assert.equal(fila.meta_permanent_token, null);
    assert.equal(fila.flow_activo, true, "flow_activo NUNCA se toca al desconectar");
    assert.equal(fila.flow_id, "flow-a", "flow_id NUNCA se toca al desconectar");
    assert.equal(fila.trigger_routing_activo, true, "trigger_routing_activo NUNCA se toca al desconectar");
    assert.equal(fila.nombre_negocio, "Negocio de prueba");
    assert.equal(fila.ia_pausada, false);
  });

  it("4. marca estado_conexion='desconectado' y desconectado_en cuando la migración ya está aplicada", async () => {
    const { supabase, filas } = crearFakeSupabase([filaBase()], { columnaEstadoConexionExiste: true });
    const r = await desconectarNumeroWhatsapp(supabase, { tenantId: "tenant-a", phoneNumberId: "phone-a" });
    assert.deepEqual(r, { ok: true, migracionPendiente: false });
    assert.equal(filas[0].estado_conexion, "desconectado");
    assert.ok(filas[0].desconectado_en);
  });

  it("5. migración NO aplicada todavía -> igual desconecta (token limpio), reporta migracionPendiente=true, nunca falla", async () => {
    const { supabase, filas } = crearFakeSupabase([filaBase()], { columnaEstadoConexionExiste: false });
    const r = await desconectarNumeroWhatsapp(supabase, { tenantId: "tenant-a", phoneNumberId: "phone-a" });
    assert.deepEqual(r, { ok: true, migracionPendiente: true });
    assert.equal(filas[0].meta_permanent_token, null, "el disconnect real (invalidar la credencial) funciona aunque falte la migración");
    assert.equal(filas[0].flow_activo, true);
  });
});

describe("desconectarNumeroWhatsapp — Meta (best-effort, nunca bloquea)", () => {
  it("6. desuscribe el WABA usando el token descifrado real", async () => {
    const { supabase } = crearFakeSupabase([filaBase()], { columnaEstadoConexionExiste: true });
    await desconectarNumeroWhatsapp(supabase, { tenantId: "tenant-a", phoneNumberId: "phone-a" });
    assert.equal(llamadasGraph.length, 1);
    assert.match(llamadasGraph[0].url, /waba-a\/subscribed_apps/);
    assert.equal(llamadasGraph[0].token, "token-real-de-meta");
  });

  it("7. sin token guardado -> no intenta llamar a Meta, pero igual desconecta localmente", async () => {
    const { supabase, filas } = crearFakeSupabase([filaBase({ meta_permanent_token: null })], { columnaEstadoConexionExiste: true });
    const r = await desconectarNumeroWhatsapp(supabase, { tenantId: "tenant-a", phoneNumberId: "phone-a" });
    assert.equal(r.ok, true);
    assert.equal(llamadasGraph.length, 0);
    assert.equal(filas[0].estado_conexion, "desconectado");
  });

  it("8. si Meta responde con error al desuscribir, el disconnect local sigue completándose (best-effort, nunca lanza)", async () => {
    global.fetch = (async () => new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 })) as typeof fetch;
    const { supabase, filas } = crearFakeSupabase([filaBase()], { columnaEstadoConexionExiste: true });
    const r = await desconectarNumeroWhatsapp(supabase, { tenantId: "tenant-a", phoneNumberId: "phone-a" });
    assert.equal(r.ok, true);
    assert.equal(filas[0].meta_permanent_token, null);
  });
});

describe("desconectarNumeroWhatsapp — idempotencia", () => {
  it("9. desconectar dos veces seguidas no falla ni cambia el resultado", async () => {
    const { supabase, filas } = crearFakeSupabase([filaBase()], { columnaEstadoConexionExiste: true });
    const r1 = await desconectarNumeroWhatsapp(supabase, { tenantId: "tenant-a", phoneNumberId: "phone-a" });
    const r2 = await desconectarNumeroWhatsapp(supabase, { tenantId: "tenant-a", phoneNumberId: "phone-a" });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(filas[0].estado_conexion, "desconectado");
    assert.equal(filas[0].meta_permanent_token, null);
  });
});

describe("escribirToleranteAColumnaFaltante", () => {
  it("10. sin error -> usa el resultado del primer intento, migracionPendiente=false", async () => {
    const ejecutar = async (datos: Record<string, unknown>) => ({ error: null, datosRecibidos: datos });
    const { resultado, migracionPendiente } = await escribirToleranteAColumnaFaltante(ejecutar, { estado_conexion: "conectado" }, {});
    assert.equal(migracionPendiente, false);
    assert.deepEqual(resultado.datosRecibidos, { estado_conexion: "conectado" });
  });

  it("11. error 42703 mencionando estado_conexion -> reintenta SIN ese campo, migracionPendiente=true", async () => {
    let intentos = 0;
    const ejecutar = async (datos: Record<string, unknown>) => {
      intentos += 1;
      if (intentos === 1) return { error: { code: "42703", message: 'column "estado_conexion" does not exist' } };
      return { error: null, datosRecibidos: datos };
    };
    const { resultado, migracionPendiente } = await escribirToleranteAColumnaFaltante(
      ejecutar,
      { estado_conexion: "conectado", nombre_negocio: "X" },
      { nombre_negocio: "X" },
    );
    assert.equal(migracionPendiente, true);
    assert.equal(intentos, 2);
    assert.deepEqual((resultado as { datosRecibidos?: object }).datosRecibidos, { nombre_negocio: "X" });
  });

  it("12. error 42703 de OTRA columna (no estado_conexion) -> NO reintenta, propaga el error tal cual", async () => {
    let intentos = 0;
    const ejecutar = async () => {
      intentos += 1;
      return { error: { code: "42703", message: 'column "otra_columna" does not exist' } };
    };
    const { migracionPendiente, resultado } = await escribirToleranteAColumnaFaltante(ejecutar, { estado_conexion: "x" }, {});
    assert.equal(migracionPendiente, false);
    assert.equal(intentos, 1);
    assert.equal(resultado.error?.message, 'column "otra_columna" does not exist');
  });

  it("13. error de otro código (no 42703) -> NO reintenta, propaga el error tal cual", async () => {
    let intentos = 0;
    const ejecutar = async () => {
      intentos += 1;
      return { error: { code: "23505", message: "duplicate key" } };
    };
    const { migracionPendiente, resultado } = await escribirToleranteAColumnaFaltante(ejecutar, { estado_conexion: "x" }, {});
    assert.equal(migracionPendiente, false);
    assert.equal(intentos, 1);
    assert.equal(resultado.error?.code, "23505");
  });
});
