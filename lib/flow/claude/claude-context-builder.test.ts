/**
 * Diagnóstico forense (autorizado, incidente AMORE 2026-09-06 18:43) —
 * buildAIRequest() resuelve "userMessage" con una cadena de prioridad; antes
 * de este fix, "mensajeActual" (el campo real que usan los flows con nodos
 * "question" -> variableKey:"mensajeActual", ej. amore-router.flow.ts) NO
 * estaba en esa cadena, así que cualquier turno sin __userMessage/userMessage/
 * lastUserMessage/text caía directo al fallback __firstMessageText -- el
 * PRIMER mensaje de la ejecución, sin importar cuántos turnos reales hubieran
 * pasado desde entonces. Ver lib/flow/executors/internal-action-executor.ts:
 * resolverEscenarioAction ya usa exactamente esta misma prioridad
 * (mensajeActual primero, __firstMessageText como último recurso) -- este fix
 * alinea buildAIRequest con ese mismo criterio, sin inventar uno nuevo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAIRequest } from "@/lib/flow/claude/claude-context-builder";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { AiNodeConfig } from "@/lib/flow/types";

const AI_CONFIG: AiNodeConfig = { mode: "respond", instruction: "Responde con naturalidad." };

function request(payload: Record<string, unknown>): EffectDispatchRequest {
  return {
    effectId: "eff-1",
    executionRowId: "row-1",
    tenantId: "tenant-1",
    nodeId: "ai-generar-respuesta",
    kind: "ai",
    payload,
    attempt: 1,
    ai: AI_CONFIG,
  };
}

describe("buildAIRequest — prioridad de userMessage (incidente AMORE 'viernes')", () => {
  it("usa mensajeActual cuando está presente, aunque __firstMessageText sea de un turno viejo", () => {
    const ai = buildAIRequest({
      request: request({
        mensajeActual: "Quiero una cita",
        __firstMessageText: "Ok, me gustaría la cita para el día viernes",
      }),
      ai: AI_CONFIG,
      model: "gemini-test",
    });
    assert.equal(ai.userMessage, "Quiero una cita");
  });

  it("cae a __firstMessageText SOLO si mensajeActual no existe (primer turno real, antes de cualquier nodo question)", () => {
    const ai = buildAIRequest({
      request: request({ __firstMessageText: "Hola, quiero una cita" }),
      ai: AI_CONFIG,
      model: "gemini-test",
    });
    assert.equal(ai.userMessage, "Hola, quiero una cita");
  });

  it("mensajeActual vacío/blanco NO cuenta -- sigue cayendo a __firstMessageText", () => {
    const ai = buildAIRequest({
      request: request({ mensajeActual: "   ", __firstMessageText: "Hola" }),
      ai: AI_CONFIG,
      model: "gemini-test",
    });
    assert.equal(ai.userMessage, "Hola");
  });

  it("no cambia la prioridad de campos existentes: __userMessage/userMessage/lastUserMessage/text siguen ganando sobre mensajeActual", () => {
    const ai1 = buildAIRequest({
      request: request({ __userMessage: "explícito", mensajeActual: "otro texto" }),
      ai: AI_CONFIG,
      model: "gemini-test",
    });
    assert.equal(ai1.userMessage, "explícito");

    const ai2 = buildAIRequest({
      request: request({ text: "del evento", mensajeActual: "otro texto" }),
      ai: AI_CONFIG,
      model: "gemini-test",
    });
    assert.equal(ai2.userMessage, "del evento");
  });

  it("reproduce el incidente real: turno 'Quiero una cita' con __firstMessageText de una conversación de prueba anterior nunca contamina la respuesta", () => {
    // Reproduce el payload REAL observado en producción (dulabs_flow_effects,
    // ejecución 130fb6d5, turno "Quiero una cita") antes del fix: agendamiento
    // vacío, instruccionIA sobre preguntar el servicio, y __firstMessageText
    // heredado de un turno 83 minutos antes.
    const ai = buildAIRequest({
      request: request({
        modo: "ai",
        agendamiento: {},
        instruccionIA: "La clienta quiere agendar una cita pero todavía no dijo qué servicio. Pregúntale amablemente qué servicio desea, UNA sola pregunta, sin listar el catálogo completo.",
        mensajeActual: "Quiero una cita",
        __firstMessageText: "Ok, me gustaría la cita para el día viernes",
      }),
      ai: AI_CONFIG,
      model: "gemini-test",
    });
    assert.equal(ai.userMessage, "Quiero una cita");
    assert.doesNotMatch(ai.userMessage ?? "", /viernes/i);
  });
});
