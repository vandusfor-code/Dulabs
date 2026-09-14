/**
 * FASE 11 (Completion & Debt Zero, autorizado) — tests puros de
 * lib/rate-limit.ts. Fake de Supabase en memoria para el RPC
 * dulabs_rate_limit_incrementar: no necesita Supabase real para probar la
 * lógica de decisión (permitido/bloqueado/fail-open).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verificarLimiteTasa, respuestaSiLimiteTasaExcedido, LIMITES_TASA } from "@/lib/rate-limit";

function fakeSupabase(respuesta: { data: unknown; error: unknown }): SupabaseClient {
  return {
    rpc(nombre: string, params: Record<string, unknown>) {
      assert.equal(nombre, "dulabs_rate_limit_incrementar");
      assert.equal(typeof params.p_clave, "string");
      return Promise.resolve(respuesta);
    },
  } as unknown as SupabaseClient;
}

describe("verificarLimiteTasa", () => {
  it("por debajo del límite -> permitido:true", async () => {
    const supabase = fakeSupabase({
      data: [{ permitido: true, conteo: 5, reinicia_en: new Date(Date.now() + 60_000).toISOString() }],
      error: null,
    });
    const r = await verificarLimiteTasa(supabase, { recurso: "test", tenantId: "t1", categoria: "lectura" });
    assert.equal(r.permitido, true);
    assert.equal(r.conteo, 5);
    assert.equal(r.limite, LIMITES_TASA.lectura.limite);
  });

  it("límite excedido -> permitido:false", async () => {
    const supabase = fakeSupabase({
      data: [{ permitido: false, conteo: 999, reinicia_en: new Date(Date.now() + 30_000).toISOString() }],
      error: null,
    });
    const r = await verificarLimiteTasa(supabase, { recurso: "test", tenantId: "t1", categoria: "escritura" });
    assert.equal(r.permitido, false);
  });

  it("RPC no disponible (migración sin aplicar) -> fail-open, nunca bloquea la petición real", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "función no encontrada" } });
    const r = await verificarLimiteTasa(supabase, { recurso: "test", tenantId: "t1", categoria: "costosa" });
    assert.equal(r.permitido, true);
  });

  it("aislamiento por tenant: la clave incluye tenantId -- dos tenants nunca comparten contador", async () => {
    const clavesVistas: string[] = [];
    const supabase = {
      rpc(_nombre: string, params: Record<string, unknown>) {
        clavesVistas.push(params.p_clave as string);
        return Promise.resolve({ data: [{ permitido: true, conteo: 1, reinicia_en: new Date().toISOString() }], error: null });
      },
    } as unknown as SupabaseClient;
    await verificarLimiteTasa(supabase, { recurso: "mensajes", tenantId: "tenant-A", categoria: "escritura" });
    await verificarLimiteTasa(supabase, { recurso: "mensajes", tenantId: "tenant-B", categoria: "escritura" });
    assert.notEqual(clavesVistas[0], clavesVistas[1]);
    assert.ok(clavesVistas[0].includes("tenant-A"));
    assert.ok(clavesVistas[1].includes("tenant-B"));
  });
});

describe("respuestaSiLimiteTasaExcedido", () => {
  it("dentro del límite -> null (la petición continúa)", async () => {
    const supabase = fakeSupabase({
      data: [{ permitido: true, conteo: 1, reinicia_en: new Date().toISOString() }],
      error: null,
    });
    const r = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "test", tenantId: "t1", categoria: "lectura" });
    assert.equal(r, null);
  });

  it("excedido -> Response 429 con Retry-After", async () => {
    const reiniciaEn = new Date(Date.now() + 20_000).toISOString();
    const supabase = fakeSupabase({ data: [{ permitido: false, conteo: 200, reinicia_en: reiniciaEn }], error: null });
    const r = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "test", tenantId: "t1", categoria: "lectura" });
    assert.ok(r);
    assert.equal(r!.status, 429);
    assert.ok(Number(r!.headers.get("Retry-After")) > 0);
  });
});
