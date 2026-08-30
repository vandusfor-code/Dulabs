import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { FlowDefinition } from "@/lib/flow/types";

/**
 * Fase 0 (migración Daniela → Flow) — DISEÑO, no activado.
 *
 * Reproduce la secuencia real de agendamiento de LEGACY
 * (lib/especialista-solicitud-ia.ts) sobre el adaptador de especialistas
 * (lib/especialistas-flow-adaptador.ts):
 *
 *   saludo → identificar servicio → fecha/hora → nombre
 *   → consultar disponibilidad REAL (acción, no la IA)
 *   → ¿disponible? no → avisar y terminar
 *                  sí → proponer horario a la IA para confirmar con la clienta
 *   → agendar cita REAL (acción crítica, constraint EXCLUDE real)
 *   → ¿se creó? no → informar "ocupado"/error, nunca decir que quedó agendada
 *                sí → SOLO ENTONCES un nodo AI (mode: respond) redacta la
 *                     confirmación, leyendo las variables reales que dejó la
 *                     acción (citaId, estadoCita, especialista) — su texto
 *                     pasa igual por applyAiResponseClaimSecurity en
 *                     runtime (flow-orchestrator.ts), así que aunque el
 *                     texto generado dijera de más, el guard existente lo
 *                     bloquearía por falta de evidencia si la acción no
 *                     hubiera corrido antes en este mismo turno.
 *
 * Simplificado a propósito para esta fase de diseño (documentado en
 * DANIELA_PROMPT_A_FLOW.md): sin ramas de cancelar/reagendar, sin las
 * frases exactas de la personalidad de marca, sin el desvío a "Daniela por
 * producto" — esas son iteraciones de Builder posteriores, no necesarias
 * para demostrar que el adaptador y la arquitectura de evidencia sostienen
 * el caso de uso central.
 */
export function danielaAgendarCitaFlow(): FlowDefinition {
  return {
    name: "Daniela — Agendar cita (Fase 0, diseño)",
    description:
      "Reproduce el camino real de agendamiento de Daniela sobre dulabs_especialistas / dulabs_citas_especialista vía el adaptador de Fase 0. NO activado para ningún tenant.",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },

      {
        id: "msg-saludo",
        type: "message",
        config: {
          text: "¿Qué servicio te gustaría agendar? 🥰",
          messageRole: "informational",
        },
      },

      {
        id: "q-servicio",
        type: "question",
        config: { text: "¿Qué servicio quieres agendar?", variableKey: "servicio", required: true, validation: { kind: "text" } },
      },
      {
        id: "q-fecha",
        type: "question",
        config: { text: "¿Para qué día? (AAAA-MM-DD)", variableKey: "fecha", required: true, validation: { kind: "text" } },
      },
      {
        id: "q-hora",
        type: "question",
        config: { text: "¿A qué hora te queda bien? (HH:MM)", variableKey: "hora", required: true, validation: { kind: "text" } },
      },
      {
        id: "q-nombre",
        type: "question",
        config: { text: "¿A nombre de quién la agendo?", variableKey: "nombreCliente", required: true, validation: { kind: "text" } },
      },

      {
        id: "ai-consultar",
        type: "ai",
        config: {
          instruction:
            "Vas a consultar disponibilidad real para el servicio, fecha y hora que dio la clienta. Propone la acción consultar_disponibilidad_especialista con esos datos. No afirmes nada sobre disponibilidad tú misma -- eso lo decide la herramienta.",
          mode: "propose_action",
          allowedTools: ["consultar_disponibilidad_especialista"],
        },
      },
      {
        id: "act-consultar",
        type: "action",
        config: { actionType: "consultar_disponibilidad_especialista" },
      },

      // Fase 1 (Blocker #3) — antes, este nodo no tenía rama de fallo: un
      // servicio no reconocido (ej. "masaje") hacía que consultar
      // disponibilidad fallara (servicio_no_manejado) y el Engine moría sin
      // enviar nada. Ahora informa con naturalidad y vuelve a preguntar el
      // servicio -- la conversación sigue, nunca se agenda a ciegas ni se
      // afirma disponibilidad inexistente.
      {
        id: "msg-servicio-no-reconocido",
        type: "message",
        config: {
          text: "Ese servicio no lo manejamos por acá 😔 ¿quieres intentar con otro (manos, pies o pestañas)?",
          messageRole: "informational",
        },
      },

      {
        id: "cond-disponible",
        type: "condition",
        config: { rules: [{ field: "disponible", operator: "equals", value: true }], match: "all" },
      },

      {
        id: "msg-sin-disponibilidad",
        type: "message",
        config: {
          text: "¿Quieres intentar con otra fecha para ese servicio? 😔",
          messageRole: "informational",
        },
      },

      {
        id: "ai-agendar",
        type: "ai",
        config: {
          instruction:
            "Hay disponibilidad real confirmada para lo que pidió la clienta. Propone la acción agendar_cita_especialista con servicio, fecha, hora y nombreCliente. NUNCA le digas a la clienta que su cita quedó agendada antes de que esta acción corra y tengas su resultado real.",
          mode: "propose_action",
          allowedTools: ["agendar_cita_especialista"],
        },
      },
      {
        id: "act-agendar",
        type: "action",
        config: { actionType: "agendar_cita_especialista" },
      },

      {
        id: "msg-ocupado",
        type: "message",
        config: {
          text: "¿Me das otra hora para intentarlo de nuevo? 😅",
          messageRole: "informational",
        },
      },

      {
        id: "ai-confirmar",
        type: "ai",
        config: {
          instruction:
            "La acción de agendar YA CORRIÓ y tienes su resultado real en las variables citaId, status ('confirmada' o 'pendiente') y especialista. Redacta la confirmación a la clienta usando ESOS datos, nunca inventados: si status es 'confirmada', dile que su cita quedó confirmada con esa especialista; si es 'pendiente', dile que quedó como solicitud y que en breve se la confirman por este mismo chat -- nunca digas 'confirmada' ni 'agendada' cuando status sea 'pendiente'.",
          mode: "respond",
        },
      },

      { id: "end-confirmado", type: "end", config: {} },
      { id: "end-sin-disponibilidad", type: "end", config: {} },
      { id: "end-ocupado", type: "end", config: {} },
    ],
    edges: [
      { id: "e-start", source: "start", target: "msg-saludo" },
      { id: "e-saludo-servicio", source: "msg-saludo", target: "q-servicio" },
      { id: "e-servicio-fecha", source: "q-servicio", target: "q-fecha" },
      { id: "e-fecha-hora", source: "q-fecha", target: "q-hora" },
      { id: "e-hora-nombre", source: "q-hora", target: "q-nombre" },
      { id: "e-nombre-ai-consultar", source: "q-nombre", target: "ai-consultar" },

      { id: "e-ai-consultar-success", source: "ai-consultar", target: "act-consultar", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-consultar-cond", source: "act-consultar", target: "cond-disponible", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-consultar-no-reconocido", source: "act-consultar", target: "msg-servicio-no-reconocido", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-no-reconocido-reintentar", source: "msg-servicio-no-reconocido", target: "q-servicio" },

      { id: "e-cond-true", source: "cond-disponible", target: "ai-agendar", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-cond-false", source: "cond-disponible", target: "msg-sin-disponibilidad", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-sin-disponibilidad-end", source: "msg-sin-disponibilidad", target: "end-sin-disponibilidad" },

      { id: "e-ai-agendar-success", source: "ai-agendar", target: "act-agendar", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-agendar-success", source: "act-agendar", target: "ai-confirmar", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-agendar-failure", source: "act-agendar", target: "msg-ocupado", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-ocupado-end", source: "msg-ocupado", target: "end-ocupado" },

      { id: "e-confirmar-end", source: "ai-confirmar", target: "end-confirmado", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
    ],
    variables: [
      { key: "servicio", label: "Servicio", type: "string", required: true },
      { key: "fecha", label: "Fecha", type: "string", required: true },
      { key: "hora", label: "Hora", type: "string", required: true },
      { key: "nombreCliente", label: "Nombre de la clienta", type: "string", required: true },
      { key: "disponible", label: "¿Hay disponibilidad?", type: "boolean" },
      { key: "citaId", label: "ID de la cita real creada", type: "string", linkedCapability: "appointment.reserved" },
      { key: "status", label: "Estado real de la cita (confirmada/pendiente)", type: "string" },
      { key: "especialista", label: "Especialista asignada realmente", type: "string" },
    ],
  };
}
