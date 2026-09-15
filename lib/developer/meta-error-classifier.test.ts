import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clasificarErrorMeta } from "./meta-error-classifier";

describe("DuLabs Developer V1 — meta-error-classifier (Fase 5, decisión D5)", () => {
  it("código permanente real de Meta (131026, destinatario no es usuario de WhatsApp) -> permanente", () => {
    assert.equal(clasificarErrorMeta({ error: { code: 131026, message: "..." } }), "permanente");
  });

  it("otros códigos permanentes documentados (131021, 131047, 131050, 132001) -> permanente", () => {
    for (const codigo of [131021, 131047, 131050, 132001]) {
      assert.equal(clasificarErrorMeta({ error: { code: codigo } }), "permanente", `código ${codigo} debe ser permanente`);
    }
  });

  it("código de rate limit real de Meta (130429, throughput de la Cloud API) -> retryable", () => {
    assert.equal(clasificarErrorMeta({ error: { code: 130429, message: "..." } }), "retryable");
  });

  it("otros códigos de rate limit/throughput documentados (4, 80007, 131048, 131056) -> retryable", () => {
    for (const codigo of [4, 80007, 131048, 131056]) {
      assert.equal(clasificarErrorMeta({ error: { code: codigo } }), "retryable", `código ${codigo} debe ser retryable`);
    }
  });

  it("códigos genéricos de servicio (1, 2, 131016, 133004) -> incertidumbre, NUNCA rechazo cierto", () => {
    for (const codigo of [1, 2, 131016, 133004]) {
      assert.equal(clasificarErrorMeta({ error: { code: codigo } }), "incertidumbre", `código ${codigo} debe ser incertidumbre`);
    }
  });

  it("código desconocido/no catalogado -> retryable (mismo comportamiento que existía ANTES de esta clasificación, nunca más agresivo)", () => {
    assert.equal(clasificarErrorMeta({ error: { code: 999999 } }), "retryable");
  });

  it("cuerpo sin error.code parseable -> retryable (comportamiento previo preservado)", () => {
    assert.equal(clasificarErrorMeta({ error: { message: "algo salió mal, sin código" } }), "retryable");
    assert.equal(clasificarErrorMeta({}), "retryable");
    assert.equal(clasificarErrorMeta(null), "retryable");
    assert.equal(clasificarErrorMeta("texto plano"), "retryable");
    assert.equal(clasificarErrorMeta(undefined), "retryable");
  });

  it("error.code como string (malformado) -> retryable, nunca lanza", () => {
    assert.equal(clasificarErrorMeta({ error: { code: "131026" } }), "retryable");
  });
});
