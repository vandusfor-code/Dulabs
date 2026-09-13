/**
 * FASE F8.3 (Meta Send Reliability, autorizado) — tests unitarios puros de
 * classifyMetaSendError/isSendMessageRetryableClassification. Sin I/O, sin
 * Supabase: solo mapea un `Error`/`MetaGraphApiError` a una clasificación.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MetaGraphApiError } from "@/lib/whatsapp";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";
import { classifyMetaSendError, isSendMessageRetryableClassification } from "@/lib/flow/executors/send-message-error-classifier";

describe("classifyMetaSendError", () => {
  it("1. HTTP 503 -> RETRYABLE", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 503, metaErrorMessage: "Service unavailable" }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
    assert.equal(r.httpStatus, 503);
  });

  it("2. HTTP 500 -> RETRYABLE", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 500 }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
  });

  it("3. HTTP 502 -> RETRYABLE", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 502 }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
  });

  it("4. HTTP 504 -> RETRYABLE", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 504 }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
  });

  it("5. HTTP 429 -> RATE_LIMIT, retryAfterMs propagado", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 429, retryAfterMs: 5000 }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT);
    assert.equal(r.retryAfterMs, 5000);
  });

  it("6. HTTP 429 sin Retry-After -> RATE_LIMIT igual, retryAfterMs undefined", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 429 }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT);
    assert.equal(r.retryAfterMs, undefined);
  });

  it("7. HTTP 400 (invalid parameter/payload) -> NON_RETRYABLE", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 400, metaErrorCode: 100, metaErrorMessage: "Invalid parameter" }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("8. HTTP 400 destinatario inválido -> NON_RETRYABLE", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 400, metaErrorCode: 131026, metaErrorMessage: "Message undeliverable" }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("9. HTTP 400 plantilla rechazada -> NON_RETRYABLE", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 400, metaErrorCode: 132000, metaErrorMessage: "Template rejected" }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("10. HTTP 403 (permission error) -> NON_RETRYABLE", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 403 }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("11. HTTP 404 -> NON_RETRYABLE", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 404 }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("12. HTTP 401 (invalid/expired token) -> AUTH_ERROR", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 401, metaErrorMessage: "Invalid OAuth access token" }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR);
  });

  it("13. código Meta 190 (invalid/expired token) con HTTP distinto de 401 -> AUTH_ERROR igual", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 400, metaErrorCode: 190, metaErrorMessage: "Error validating access token" }));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR);
  });

  it("14. AbortError (timeout del EffectExecutorFramework) -> TIMEOUT", () => {
    const err = Object.assign(new Error("executor_timeout"), { name: "AbortError" });
    const r = classifyMetaSendError(err);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT);
  });

  it("15. TimeoutError (AbortSignal.timeout nativo) -> TIMEOUT", () => {
    const err = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const r = classifyMetaSendError(err);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT);
  });

  it("16. TypeError de red (fetch failed, sin respuesta HTTP) -> RETRYABLE", () => {
    const err = new TypeError("fetch failed");
    const r = classifyMetaSendError(err);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
  });

  it("17. Error genérico no reconocido -> NON_RETRYABLE (default seguro)", () => {
    const r = classifyMetaSendError(new Error("algo inesperado y no relacionado con Meta"));
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("18. valor no-Error lanzado (string) -> NON_RETRYABLE (default seguro)", () => {
    const r = classifyMetaSendError("boom");
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("19. metaErrorMessage/metaErrorCode se preservan en el resultado clasificado", () => {
    const r = classifyMetaSendError(new MetaGraphApiError({ httpStatus: 500, metaErrorCode: 1, metaErrorMessage: "Internal error" }));
    assert.equal(r.metaErrorCode, 1);
    assert.equal(r.metaErrorMessage, "Internal error");
  });
});

describe("isSendMessageRetryableClassification", () => {
  it("20. RETRYABLE -> true", () => {
    assert.equal(isSendMessageRetryableClassification(EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE), true);
  });
  it("21. RATE_LIMIT -> true", () => {
    assert.equal(isSendMessageRetryableClassification(EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT), true);
  });
  it("22. TIMEOUT -> true", () => {
    assert.equal(isSendMessageRetryableClassification(EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT), true);
  });
  it("23. NON_RETRYABLE -> false", () => {
    assert.equal(isSendMessageRetryableClassification(EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE), false);
  });
  it("24. AUTH_ERROR -> false", () => {
    assert.equal(isSendMessageRetryableClassification(EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR), false);
  });
  it("25. VALIDATION_ERROR -> false", () => {
    assert.equal(isSendMessageRetryableClassification(EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR), false);
  });
  it("26. SECURITY_REJECTED -> false", () => {
    assert.equal(isSendMessageRetryableClassification(EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED), false);
  });
  it("27. SUCCESS -> false (no aplica reintento a un éxito)", () => {
    assert.equal(isSendMessageRetryableClassification(EFFECT_RESULT_CLASSIFICATIONS.SUCCESS), false);
  });
  it("28. EXTERNAL_AMBIGUOUS -> false (no es una de las 3 categorías retryable de send_message)", () => {
    assert.equal(isSendMessageRetryableClassification(EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS), false);
  });
});
