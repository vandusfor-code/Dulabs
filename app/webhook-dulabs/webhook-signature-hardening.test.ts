/**
 * FASE F8.6 (Final Hardening + Full E2E, autorizado) — tests directos de
 * POST /webhook-dulabs para los DOS gates que corren ANTES de cualquier
 * `after()` (firma HMAC inválida y JSON malformado). Deliberadamente NO se
 * testea acá el resto del cascade (tenant desconocido, dedup, etc.):
 * llamar POST() fuera de un request real de Next.js hace que `after()`
 * lance "called outside a request scope" (verificado empíricamente durante
 * esta fase) -- esos casos se prueban en procesar-cambio-hardening.test.ts,
 * contra la función `procesarCambio` exportada, que evita ese obstáculo por
 * completo sin necesitar ningún refactor del archivo real.
 *
 * Nunca toca Supabase (ambos gates devuelven antes de cualquier query) ni
 * Meta real.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

process.env.META_APP_SECRET = process.env.META_APP_SECRET || "test-app-secret-f86";
process.env.META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "test-verify-token-f86";

function firmar(body: string): string {
  return "sha256=" + createHmac("sha256", process.env.META_APP_SECRET!).update(body, "utf8").digest("hex");
}

function req(body: string, signature: string | null): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  return new NextRequest("http://localhost/webhook-dulabs", { method: "POST", headers, body });
}

describe("POST /webhook-dulabs — gates de seguridad (firma HMAC + JSON)", () => {
  it("1. sin cabecera X-Hub-Signature-256 -> 401, nunca procesa nada", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(JSON.stringify({ entry: [] }), null));
    assert.equal(res.status, 401);
  });

  it("2. firma con formato inválido (sin prefijo 'sha256=') -> 401", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ entry: [] });
    const res = await POST(req(body, "no-es-una-firma-valida"));
    assert.equal(res.status, 401);
  });

  it("3. firma bien formada pero INCORRECTA (no coincide con el body real) -> 401", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "x" } } }] }] });
    const firmaDeOtroBody = firmar(JSON.stringify({ entry: [] }));
    const res = await POST(req(body, firmaDeOtroBody));
    assert.equal(res.status, 401);
  });

  it("4. firma calculada sobre un body DISTINTO al enviado (tampering) -> 401", async () => {
    const { POST } = await import("./route");
    const bodyFirmado = JSON.stringify({ entry: [] });
    const firma = firmar(bodyFirmado);
    const bodyAlterado = JSON.stringify({ entry: [{ changes: [] }] }); // mismo tamaño de firma, contenido distinto
    const res = await POST(req(bodyAlterado, firma));
    assert.equal(res.status, 401);
  });

  it("5. firma VÁLIDA pero JSON malformado -> 400 (nunca 401 -- la firma sí se verificó bien contra ese texto crudo)", async () => {
    const { POST } = await import("./route");
    const bodyCrudo = "{ esto no es json válido ";
    const res = await POST(req(bodyCrudo, firmar(bodyCrudo)));
    assert.equal(res.status, 400);
  });

  it("6. sin META_APP_SECRET configurado -> rechaza SIEMPRE (fail-closed), aunque la firma 'parezca' correcta", async () => {
    const original = process.env.META_APP_SECRET;
    delete process.env.META_APP_SECRET;
    try {
      const { POST } = await import("./route");
      const body = JSON.stringify({ entry: [] });
      // Sin secreto, no hay forma de calcular una firma "correcta" -- cualquier valor debe rechazarse.
      const res = await POST(req(body, "sha256=" + "0".repeat(64)));
      assert.equal(res.status, 401);
    } finally {
      process.env.META_APP_SECRET = original;
    }
  });

  it("7. GET de verificación (handshake) con verify_token correcto -> 200 y devuelve el challenge", async () => {
    const { GET } = await import("./route");
    const url = `http://localhost/webhook-dulabs?hub.mode=subscribe&hub.verify_token=${process.env.META_VERIFY_TOKEN}&hub.challenge=abc123`;
    const res = await GET(new NextRequest(url));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "abc123");
  });

  it("8. GET de verificación con verify_token incorrecto -> 403", async () => {
    const { GET } = await import("./route");
    const url = `http://localhost/webhook-dulabs?hub.mode=subscribe&hub.verify_token=token-incorrecto&hub.challenge=abc123`;
    const res = await GET(new NextRequest(url));
    assert.equal(res.status, 403);
  });
});
