/**
 * El texto que el modelo escribe en un nodo que NO responde al cliente (propose_action/extract/hybrid) no se envía y no debe
 * pasar por el filtro de afirmaciones; el de los nodos respond/classify sí. Puro.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchResult } from "@/lib/flow/executor-types";
import { applyAiResponseClaimSecurity, stripUnsentAiText } from "@/lib/flow/ai-runtime/ai-response-security";

const ok = (data: Record<string, unknown>): EffectDispatchResult => ({ success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data });
const FRASE_BLOQUEABLE = "Ya consulté la disponibilidad para ese día.";

describe("stripUnsentAiText", () => {
  it("1. propose_action/extract/hybrid: se descarta responseText (y solo eso)", () => {
    for (const mode of ["propose_action", "extract", "hybrid"]) {
      const r = stripUnsentAiText({ dispatchResult: ok({ responseText: FRASE_BLOQUEABLE, otro: 1 }), mode });
      assert.deepEqual(r.appliedResult, { otro: 1 }, mode);
      assert.deepEqual(r.data, { otro: 1 }, mode);
    }
  });

  it("2. respond/classify (o modo desconocido): NO se toca; se sigue validando con el filtro completo", () => {
    for (const mode of ["respond", "classify", undefined]) {
      const entrada = ok({ responseText: FRASE_BLOQUEABLE });
      assert.equal(stripUnsentAiText({ dispatchResult: entrada, mode }), entrada);
    }
  });

  it("3. un fallo previo o un resultado sin texto pasan tal cual", () => {
    const fallo: EffectDispatchResult = { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, error: "x" };
    assert.equal(stripUnsentAiText({ dispatchResult: fallo, mode: "propose_action" }), fallo);
    const sinTexto = ok({ a: 1 });
    assert.equal(stripUnsentAiText({ dispatchResult: sinTexto, mode: "propose_action" }), sinTexto);
  });

  it("4. la frase bloqueable en propose_action YA NO tumba el resultado; en respond SIGUE bloqueada", () => {
    const propuesta = stripUnsentAiText({ dispatchResult: ok({ responseText: FRASE_BLOQUEABLE }), mode: "propose_action" });
    assert.equal(applyAiResponseClaimSecurity({ dispatchResult: propuesta, variables: {} }).success, true);
    const respuesta = applyAiResponseClaimSecurity({ dispatchResult: stripUnsentAiText({ dispatchResult: ok({ responseText: FRASE_BLOQUEABLE }), mode: "respond" }), variables: {} });
    assert.equal(respuesta.success, false, "el texto que SÍ se envía sigue pasando por el filtro");
    assert.match(String(respuesta.error), /unverified_external_claim/);
  });
});
