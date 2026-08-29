/**
 * Tests de sanitización para observabilidad (Fase 4.0.1).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizePayloadForObservability } from "@/lib/flow/sanitize-observability-payload";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

const PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJj
-----END RSA PRIVATE KEY-----`;

describe("sanitizePayloadForObservability — Fase 4.0.1", () => {
  it("1. apiKey", () => {
    const out = sanitizePayloadForObservability({ apiKey: "sk-live-abc1234567890" }) as Record<
      string,
      unknown
    >;
    assert.equal(out.apiKey, "[REDACTED]");
  });

  it("2. api_key", () => {
    const out = sanitizePayloadForObservability({ api_key: "sk-test-abcdefghij" }) as Record<
      string,
      unknown
    >;
    assert.equal(out.api_key, "[REDACTED]");
  });

  it("3. x-api-key", () => {
    const out = sanitizePayloadForObservability({
      "x-api-key": "super-secret-key-value-12345",
    }) as Record<string, unknown>;
    assert.equal(out["x-api-key"], "[REDACTED]");
  });

  it("4. client_secret", () => {
    const out = sanitizePayloadForObservability({
      client_secret: "my-client-secret-value-12",
    }) as Record<string, unknown>;
    assert.equal(out.client_secret, "[REDACTED]");
  });

  it("5. authorization bearer real", () => {
    const token = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjoidG9rIn0.signaturepart";
    const out = sanitizePayloadForObservability({ authorization: token }) as Record<string, unknown>;
    assert.equal(out.authorization, "[REDACTED]");
  });

  it("6. JWT", () => {
    const out = sanitizePayloadForObservability({ token: JWT }) as Record<string, unknown>;
    assert.equal(out.token, "[REDACTED]");
  });

  it("7. private key", () => {
    const out = sanitizePayloadForObservability({ material: PRIVATE_KEY }) as Record<string, unknown>;
    assert.equal(out.material, "[REDACTED]");
  });

  it("8. AWS key", () => {
    const out = sanitizePayloadForObservability({ aws: "AKIAIOSFODNN7EXAMPLE" }) as Record<
      string,
      unknown
    >;
    assert.equal(out.aws, "[REDACTED]");
  });

  it("9. URL con credenciales", () => {
    const out = sanitizePayloadForObservability({
      callback: "https://user:password123@api.example.com/hook",
    }) as Record<string, unknown>;
    assert.equal(out.callback, "[REDACTED]");
  });

  it("10. secret dentro de objeto anidado", () => {
    const out = sanitizePayloadForObservability({
      config: { nested: { apiKey: "sk-live-abc1234567890" } },
    }) as Record<string, unknown>;
    assert.deepEqual(out, { config: { nested: { apiKey: "[REDACTED]" } } });
  });

  it("11. secret dentro de array", () => {
    const out = sanitizePayloadForObservability({
      items: ["sk-live-abc1234567890", "visible"],
    }) as Record<string, unknown>;
    assert.deepEqual(out, { items: ["[REDACTED]", "visible"] });
  });

  it("12. secret dentro de array de objetos", () => {
    const out = sanitizePayloadForObservability({
      rows: [{ password: "hunter2-extra-long" }, { label: "ok" }],
    }) as Record<string, unknown>;
    assert.deepEqual(out, {
      rows: [{ password: "[REDACTED]" }, { label: "ok" }],
    });
  });

  it("13. placeholder {{apiKey}}", () => {
    const out = sanitizePayloadForObservability({ apiKey: "{{apiKey}}" }) as Record<string, unknown>;
    assert.equal(out.apiKey, "{{apiKey}}");
  });

  it("14. texto normal", () => {
    const out = sanitizePayloadForObservability({
      message: "Hola, ¿en qué puedo ayudarte?",
    }) as Record<string, unknown>;
    assert.equal(out.message, "Hola, ¿en qué puedo ayudarte?");
  });

  it("15. Bearer authentication is required", () => {
    const original = {
      authorization: "Bearer authentication is required",
      note: "Bearer authentication is required",
    };
    const out = sanitizePayloadForObservability(original) as Record<string, unknown>;
    assert.equal(out.authorization, "Bearer authentication is required");
    assert.equal(out.note, "Bearer authentication is required");
    assert.deepEqual(original, {
      authorization: "Bearer authentication is required",
      note: "Bearer authentication is required",
    });
  });
});
