import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { FlowDefinition } from "@/lib/flow/types";

/**
 * AMORE — Asistente conversacional (Fase 3, banco de escenarios, autorizado).
 *
 * Reemplaza el diseño anterior (cadena ai-clasificar-intencion ->
 * act-listar-catalogo -> ai-extraer-servicio -> act-resolver -> ... ->
 * ai-conversar-catalogo, hasta 2-3 llamadas reales a Claude por turno) por
 * un único nodo de acción (resolver_escenario, lib/bot-escenarios/resolver.ts)
 * que decide DETERMINÍSTICAMENTE qué responder consultando un banco de
 * escenarios/FAQ/info del negocio configurable por tenant
 * (dulabs_bot_escenarios) + el catálogo real -- Claude solo se invoca cuando
 * el escenario ganador queda marcado modo=ai (recomendaciones/preguntas
 * abiertas), nunca para saludo/precio/duración/categoría/FAQ/portal/
 * transferencia. Objetivo explícito del pedido: máxima velocidad, mínimo
 * consumo de tokens, comportamiento controlado.
 *
 * Este archivo es la ÚNICA fuente de verdad versionada del flow de AMORE --
 * hasta esta fase, el flow REALMENTE publicado en producción había
 * divergido de este archivo (parcheado varias veces por scripts one-off
 * directos contra Supabase, ver scripts/_actualizar-flow-amore.mts y
 * siguientes). Publicar esta versión reconcilia ambos.
 *
 * NUNCA agenda por WhatsApp: agendar_cita_especialista/agendar_cita_marketplace
 * no aparecen en este grafo. El escenario reservado de intención de reserva
 * (código CODIGO_ESCENARIO_PORTAL, ver lib/bot-escenarios/tipos.ts) siempre
 * responde con el enlace real del portal (https://www.dulabs.co/reservar/amore),
 * nunca pide fecha/hora ni consulta disponibilidad.
 */
export function amoreRouterFlow(): FlowDefinition {
  return {
    name: "AMORE — Asistente conversacional (Fase 3, banco de escenarios)",
    description:
      "Responde con el banco de escenarios/FAQ/información real de AMORE (dulabs_bot_escenarios), 100% determinístico salvo cuando el escenario ganador requiere IA (recomendaciones). Nunca agenda por WhatsApp -- toda intención de reserva se resuelve enviando el enlace real del portal.",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },

      { id: "act-resolver-escenario", type: "action", config: { actionType: "resolver_escenario" } },

      {
        id: "cond-es-ai",
        type: "condition",
        config: { rules: [{ field: "modo", operator: "equals", value: "ai" }], match: "all" },
      },
      {
        id: "cond-es-transfer",
        type: "condition",
        config: { rules: [{ field: "modo", operator: "equals", value: "transfer" }], match: "all" },
      },

      {
        id: "ai-generar-respuesta",
        type: "ai",
        config: {
          mode: "respond",
          instruction:
            "Eres la asesora virtual de AMORE: cercana, cálida, natural, empática -- nunca un menú ni un robot, nunca un call center, nunca un asistente técnico. " +
            "Nunca menciones que eres una IA, ni palabras como 'base de datos', 'sistema', 'backend', 'contexto' o 'knowledge base'. " +
            "Recibes DOS fuentes de datos, y NUNCA debes mezclarlas: " +
            "'datosIA' son hechos CONFIRMADOS de AMORE (nombre, precioTexto, duracionTexto, categoria de servicios REALES) -- son verdad, siempre puedes afirmarlos tal cual. " +
            "'conocimientoGeneral' es explicación profesional general (queEs/paraQueSirve/limites) de esos mismos servicios, cada entrada con su 'fuente': " +
            "'confirmado_amore' (protocolo propio de AMORE, puedes afirmarlo como tal), " +
            "'conocimiento_general' (explicación profesional general del tipo de servicio -- NUNCA lo presentes como un protocolo específico o exclusivo de AMORE, aunque sí puedes usarlo para explicar/comparar/orientar), " +
            "'no_confirmado' (no hay ficha -- no inventes una explicación; puedes decir con naturalidad que no tienes ese detalle, sin sonar técnica). " +
            "Respeta siempre lo que 'limites' de cada ficha te prohíbe afirmar. " +
            "Los únicos servicios que existen son los de 'datosIA' -- nunca inventes un servicio, precio, duración, profesional, horario, dirección, promoción, producto, marca o protocolo que no esté ahí. " +
            "'instruccionIA' te dice qué hacer en este momento puntual (ej. explicar un servicio, comparar dos, recomendar por presupuesto/ocasión, orientar a alguien indecisa). " +
            "Responde corto (2-4 líneas), variando el tono naturalmente, respondiendo primero lo que la clienta preguntó, como alguien que ya la escuchó -- nunca listes más de 2-3 opciones de una vez, nunca en viñetas ni catálogo completo, nunca ficha técnica ni respuesta robótica o repetitiva. " +
            "NUNCA ofrezcas agendar directamente, nunca preguntes fecha/hora ni digas que hay disponibilidad -- si la clienta quiere agendar, eso lo maneja un mensaje aparte con el enlace real del portal.",
        },
      },
      {
        id: "q-turno-ia",
        type: "question",
        config: { text: "{{responseText}}", variableKey: "mensajeActual", required: false, validation: { kind: "text" } },
      },

      {
        id: "q-turno-directo",
        type: "question",
        config: { text: "{{respuestaTexto}}", variableKey: "mensajeActual", required: false, validation: { kind: "text" } },
      },

      {
        id: "msg-antes-transferir",
        type: "message",
        config: { text: "{{respuestaTexto}}", messageRole: "informational" },
      },
      { id: "act-transferir-soporte", type: "action", config: { actionType: "transferir_soporte", pauseDurationHours: 24 } },
      { id: "end-transferido", type: "end", config: {} },
    ],
    edges: [
      { id: "e-start-resolver", source: "start", target: "act-resolver-escenario" },
      { id: "e-resolver-cond-ai", source: "act-resolver-escenario", target: "cond-es-ai", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-cond-ai-si", source: "cond-es-ai", target: "ai-generar-respuesta", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-cond-ai-no", source: "cond-es-ai", target: "cond-es-transfer", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },

      { id: "e-cond-transfer-si", source: "cond-es-transfer", target: "msg-antes-transferir", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-cond-transfer-no", source: "cond-es-transfer", target: "q-turno-directo", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },

      { id: "e-ia-a-turno", source: "ai-generar-respuesta", target: "q-turno-ia", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-turno-ia-loop", source: "q-turno-ia", target: "act-resolver-escenario" },
      { id: "e-turno-directo-loop", source: "q-turno-directo", target: "act-resolver-escenario" },

      { id: "e-transferir-a-accion", source: "msg-antes-transferir", target: "act-transferir-soporte" },
      { id: "e-transferir-end", source: "act-transferir-soporte", target: "end-transferido", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
    ],
    variables: [
      { key: "modo", label: "Modo del escenario ganador", type: "string" },
      { key: "escenarioCodigo", label: "Código del escenario ganador", type: "string" },
      { key: "respuestaTexto", label: "Respuesta determinística ya interpolada", type: "string" },
      { key: "datosIA", label: "Datos reales (confirmados) filtrados para el nodo IA", type: "string" },
      { key: "conocimientoGeneral", label: "Conocimiento general (queEs/paraQueSirve/limites) por servicio, separado de datosIA, cada uno con su 'fuente'", type: "string" },
      { key: "instruccionIA", label: "Instrucción acotada del escenario para el nodo IA", type: "string" },
      { key: "ultimoServicioId", label: "Último servicio real mencionado (contexto)", type: "string" },
      { key: "ultimaCategoria", label: "Última categoría real mencionada (contexto)", type: "string" },
    ],
  };
}
