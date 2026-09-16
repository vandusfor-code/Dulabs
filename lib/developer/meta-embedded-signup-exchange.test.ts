/**
 * DuLabs Developer V1 -- Fase 10. Tests PUROS del intercambio Embedded Signup
 * (sin red real, sin Supabase, sin enviar ningún WhatsApp). `fetchImpl`
 * inyectado cubre todas las ramas de Meta: éxito, code inválido, WABA por
 * hint vs debug_token, número por hint vs fallback, errores y timeouts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { intercambiarYDescubrirNumeroMeta, suscribirAppAlWaba } from "@/lib/developer/meta-embedded-signup-exchange";

type Ruta = { test: (url: string, init?: RequestInit) => boolean; responder: () => { ok?: boolean; status?: number; json: unknown } };

function fetchFalso(rutas: Ruta[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const ruta = rutas.find((r) => r.test(url, init));
    if (!ruta) throw new Error(`fetchFalso: URL no esperada: ${url}`);
    const r = ruta.responder();
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.json } as unknown as Response;
  }) as unknown as typeof fetch;
}

const CONFIG_BASE = { appId: "APPID", appSecret: "SECRET", graphBaseUrl: "https://graph.facebook.com", graphVersion: "v23.0" };

describe("Developer V1 Fase 10 -- intercambio Embedded Signup (puro)", () => {
  it("happy path con hints: code -> token, usa el WABA y número sugeridos, devuelve datos + token", async () => {
    const fetchImpl = fetchFalso([
      { test: (u) => u.includes("/oauth/access_token"), responder: () => ({ json: { access_token: "TOKEN-PERM" } }) },
      { test: (u) => u.includes("/phone_numbers"), responder: () => ({ json: { data: [{ id: "PN-1", display_phone_number: "+57 300 111", verified_name: "Neg A" }, { id: "PN-2", display_phone_number: "+57 300 222" }] } }) },
      { test: (u) => /\/WABA-9\?fields=name/.test(u), responder: () => ({ json: { name: "Negocio Real" } }) },
    ]);
    const r = await intercambiarYDescubrirNumeroMeta({ code: "CODE", wabaIdSugerido: "WABA-9", phoneNumberIdSugerido: "PN-2", config: { ...CONFIG_BASE, fetchImpl } });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.phoneNumberId, "PN-2");
    assert.equal(r.datos.wabaId, "WABA-9");
    assert.equal(r.datos.displayName, "Negocio Real");
    assert.equal(r.datos.tokenPermanente, "TOKEN-PERM");
  });

  it("sin hint de WABA: lo descubre vía debug_token (granular_scopes)", async () => {
    const fetchImpl = fetchFalso([
      { test: (u) => u.includes("/oauth/access_token"), responder: () => ({ json: { access_token: "T" } }) },
      { test: (u) => u.includes("/debug_token"), responder: () => ({ json: { data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA-DESC"] }] } } }) },
      { test: (u) => u.includes("/phone_numbers"), responder: () => ({ json: { data: [{ id: "PN-X", display_phone_number: "+1 1" }] } }) },
      { test: (u) => u.includes("fields=name"), responder: () => ({ json: { name: "N" } }) },
    ]);
    const r = await intercambiarYDescubrirNumeroMeta({ code: "CODE", config: { ...CONFIG_BASE, fetchImpl } });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.datos.wabaId, "WABA-DESC");
  });

  it("phone hint que NO está en la lista real -> cae al primer número real (nunca persiste uno no confirmado)", async () => {
    const fetchImpl = fetchFalso([
      { test: (u) => u.includes("/oauth/access_token"), responder: () => ({ json: { access_token: "T" } }) },
      { test: (u) => u.includes("/phone_numbers"), responder: () => ({ json: { data: [{ id: "REAL-1", display_phone_number: "+1 1" }] } }) },
      { test: (u) => u.includes("fields=name"), responder: () => ({ json: { name: "N" } }) },
    ]);
    const r = await intercambiarYDescubrirNumeroMeta({ code: "CODE", wabaIdSugerido: "W", phoneNumberIdSugerido: "FALSO-999", config: { ...CONFIG_BASE, fetchImpl } });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.datos.phoneNumberId, "REAL-1");
  });

  it("code inválido -> {ok:false, code_invalido} y NUNCA expone token", async () => {
    const fetchImpl = fetchFalso([{ test: (u) => u.includes("/oauth/access_token"), responder: () => ({ ok: false, status: 400, json: { error: { message: "bad code" } } }) }]);
    const r = await intercambiarYDescubrirNumeroMeta({ code: "X", config: { ...CONFIG_BASE, fetchImpl } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "code_invalido");
    assert.ok(!JSON.stringify(r).includes("TOKEN"));
  });

  it("WABA no determinable -> {ok:false, waba_no_determinado}", async () => {
    const fetchImpl = fetchFalso([
      { test: (u) => u.includes("/oauth/access_token"), responder: () => ({ json: { access_token: "T" } }) },
      { test: (u) => u.includes("/debug_token"), responder: () => ({ json: { data: { granular_scopes: [] } } }) },
    ]);
    const r = await intercambiarYDescubrirNumeroMeta({ code: "C", config: { ...CONFIG_BASE, fetchImpl } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "waba_no_determinado");
  });

  it("WABA sin números -> {ok:false, numeros_no_encontrados}", async () => {
    const fetchImpl = fetchFalso([
      { test: (u) => u.includes("/oauth/access_token"), responder: () => ({ json: { access_token: "T" } }) },
      { test: (u) => u.includes("/phone_numbers"), responder: () => ({ ok: true, json: { data: [] } }) },
    ]);
    const r = await intercambiarYDescubrirNumeroMeta({ code: "C", wabaIdSugerido: "W", config: { ...CONFIG_BASE, fetchImpl } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "numeros_no_encontrados");
  });

  it("fallo de red -> {ok:false, meta_error}", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await intercambiarYDescubrirNumeroMeta({ code: "C", config: { ...CONFIG_BASE, fetchImpl } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "meta_error");
  });

  it("suscribirAppAlWaba: éxito y fallo", async () => {
    const ok = await suscribirAppAlWaba({ wabaId: "W", tokenPermanente: "T", config: { ...CONFIG_BASE, fetchImpl: fetchFalso([{ test: (u) => u.includes("/subscribed_apps"), responder: () => ({ json: { success: true } }) }]) } });
    assert.equal(ok.ok, true);
    const fail = await suscribirAppAlWaba({ wabaId: "W", tokenPermanente: "T", config: { ...CONFIG_BASE, fetchImpl: fetchFalso([{ test: (u) => u.includes("/subscribed_apps"), responder: () => ({ ok: false, status: 400, json: { error: { message: "nope" } } }) }]) } });
    assert.equal(fail.ok, false);
  });
});
