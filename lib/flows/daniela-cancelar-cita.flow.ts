import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { FlowDefinition } from "@/lib/flow/types";
import { DANIELA_BUTTON_IDS } from "@/lib/flows/daniela-button-ids";

/**
 * Fase 1 (Blocker #4, autorizado) — Daniela: cancelación de citas.
 *
 * Flow independiente del de agendar (lib/flows/daniela-agendar-cita.flow.ts)
 * -- NO activado para ningún tenant. El enrutamiento por intención
 * (¿"agendar" o "cancelar"?) es una decisión de diseño aparte, fuera del
 * alcance de este blocker (que es exclusivamente sobre cancelación); ver
 * reporte de diseño para el detalle.
 *
 * Secuencia:
 *   consultar TODAS las citas activas reales (acción, no la IA)
 *   → ¿cuántas? 0 → informar y terminar, nunca inventa una cita
 *              1 → identificar esa cita (IA lee el dato real, no decide nada)
 *              2+ → listar las reales y preguntar cuál (nunca elige por su cuenta)
 *   → (converge) preguntar confirmación explícita
 *   → clasificar la respuesta: confirma / no confirma
 *       no confirma (o cualquier respuesta ambigua, por default) → abandona, NO cancela nada
 *       confirma → proponer cancelar_cita_especialista con el citaId ya identificado
 *   → cancelar cita REAL (acción crítica)
 *       éxito → SOLO ENTONCES un nodo IA (mode: respond) redacta la confirmación,
 *               leyendo las variables reales que dejó la acción (citaId, cancelada)
 *       fallo → informar que no se pudo, nunca decir que se canceló
 */
export function danielaCancelarCitaFlow(): FlowDefinition {
  return {
    name: "Daniela — Cancelar cita (Fase 1, diseño)",
    description:
      "Cancelación real de citas sobre dulabs_citas_especialista vía el adaptador de Fase 0/1. NO activado para ningún tenant.",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },

      {
        id: "act-consultar-citas",
        type: "action",
        config: { actionType: "consultar_citas_activas_especialista" },
      },

      {
        id: "cond-tiene-citas",
        type: "condition",
        config: { rules: [{ field: "cantidadCitas", operator: "greater_than", value: 0 }], match: "all" },
      },
      {
        id: "msg-sin-cita-activa",
        type: "message",
        config: { text: "No encuentro ninguna cita activa por acá 🤔", messageRole: "informational" },
      },

      {
        id: "cond-multiples-citas",
        type: "condition",
        config: { rules: [{ field: "cantidadCitas", operator: "greater_than", value: 1 }], match: "all" },
      },

      // Una sola cita activa: la identifica Y se la muestra a la clienta
      // (lee el dato real, no decide ni inventa nada) -- Caso B. mode:
      // "respond" en vez de "extract" a propósito: los nodos question/message
      // no interpolan variables en su texto (ver resolverTextoPlano en
      // send-message-executor.ts), así que la única forma de que la clienta
      // VEA cuál cita se identificó es que un nodo AI se lo diga -- el
      // merge de outputVariables ocurre para cualquier mode, no solo extract.
      {
        id: "ai-identificar-unica",
        type: "ai",
        config: {
          instruction:
            "La clienta tiene EXACTAMENTE una cita activa real, en la variable citasActivas (un solo elemento). Dile con naturalidad cuál es (servicio + fecha/hora) para que sepa de cuál se trata -- todavía NO le preguntes si la cancela, eso lo hace la pregunta siguiente. Además, guarda su id en citaObjetivoId y una descripción corta en citaObjetivoDescripcion. No inventes ni asumas nada que no esté en esa variable.",
          mode: "respond",
          outputVariables: ["citaObjetivoId", "citaObjetivoDescripcion"],
        },
      },

      // Varias citas activas: las lista TODAS (reales) y pregunta cuál —
      // nunca elige por su cuenta (Caso E / Regla 6).
      {
        id: "ai-listar-citas",
        type: "ai",
        config: {
          instruction:
            "La clienta tiene varias citas activas reales, en la variable citasActivas. Preséntaselas con naturalidad (servicio + fecha/hora de cada una) y pregúntale cuál quiere cancelar. No canceles nada todavía ni asumas cuál quiere.",
          mode: "respond",
        },
      },
      {
        id: "q-cual-cita",
        type: "question",
        config: { text: "¿Cuál de esas citas quieres cancelar?", variableKey: "seleccionCitaTexto", required: true, validation: { kind: "text" } },
      },
      {
        id: "ai-identificar-seleccionada",
        type: "ai",
        config: {
          instruction:
            "La clienta tiene varias citas reales en citasActivas y acaba de responder, en seleccionCitaTexto, cuál quiere cancelar. Identifica a CUÁL de las citas reales de citasActivas se refiere (por servicio, fecha u hora), confírmale con naturalidad cuál entendiste que es, y guarda su id en citaObjetivoId y una descripción corta en citaObjetivoDescripcion. Si su respuesta es ambigua y no puedes identificar con certeza cuál es, dile que no quedó claro cuál es, y deja citaObjetivoId vacío -- nunca la adivines.",
          mode: "respond",
          outputVariables: ["citaObjetivoId", "citaObjetivoDescripcion"],
        },
      },
      {
        id: "cond-seleccion-clara",
        type: "condition",
        config: { rules: [{ field: "citaObjetivoId", operator: "exists" }], match: "all" },
      },
      {
        id: "msg-seleccion-no-clara",
        type: "message",
        config: { text: "No logré identificar cuál de tus citas quieres decir 😅 ¿me la describes de nuevo?", messageRole: "informational" },
      },

      // Punto de convergencia: ya hay una cita objetivo identificada
      // (única o seleccionada de varias) -- Regla 7: pedir confirmación
      // explícita ANTES de tocar nada.
      {
        id: "q-confirmar-cancelacion",
        type: "buttons",
        config: {
          text: "¿Deseas cancelar esta cita?",
          variableKey: "respuestaConfirmacionTexto",
          buttons: [
            { id: DANIELA_BUTTON_IDS.CANCELAR_CITA, label: "Cancelar cita" },
            { id: DANIELA_BUTTON_IDS.MANTENER_CITA, label: "Mantener cita" },
          ],
        },
      },
      {
        id: "ai-clasificar-confirmacion",
        type: "ai",
        config: {
          instruction:
            "La clienta respondió, en respuestaConfirmacionTexto, a la pregunta de si quiere cancelar su cita. Clasifica como 'confirma' SOLO si es un sí claro e inequívoco a CANCELAR (ej. 'sí', 'sí, cancélala', 'confirmo') o si el valor es exactamente 'cancelar_cita'. Cualquier otra cosa -- un no, 'mantener_cita', una duda, 'mejor no', un cambio de tema, o cualquier respuesta que no sea un sí claro a cancelar -- clasifícala como 'no_confirma'. Ante la duda, SIEMPRE 'no_confirma': nunca asumas que sí quiere cancelar.",
          mode: "classify",
          classifications: ["confirma", "no_confirma"],
        },
      },
      {
        id: "msg-cancelacion-abandonada",
        type: "message",
        config: { text: "Perfecto, no cancelo nada entonces 💛 Todo sigue como estaba.", messageRole: "informational" },
      },

      {
        id: "ai-proponer-cancelar",
        type: "ai",
        config: {
          instruction:
            "La clienta YA confirmó que quiere cancelar la cita identificada en citaObjetivoId. Propone la acción cancelar_cita_especialista con citaId=citaObjetivoId y confirmado=true. NUNCA le digas a la clienta que su cita quedó cancelada antes de que esta acción corra y tengas su resultado real.",
          mode: "propose_action",
          allowedTools: ["cancelar_cita_especialista"],
        },
      },
      {
        id: "act-cancelar",
        type: "action",
        config: { actionType: "cancelar_cita_especialista" },
      },
      {
        id: "msg-no-se-pudo-cancelar",
        type: "message",
        config: { text: "No pude cancelarla en este momento 😔 ¿quieres que lo intentemos de nuevo?", messageRole: "informational" },
      },
      {
        id: "ai-confirmar-cancelacion",
        type: "ai",
        config: {
          instruction:
            "La acción de cancelar YA CORRIÓ y tienes su resultado real en las variables citaId y cancelada=true. Redacta la confirmación a la clienta usando ESOS datos reales, nunca inventados -- dile con calidez que ya la eliminaste de la agenda. Evita literalmente la palabra 'cancelada'/'cancelé' (usa 'eliminé esa cita de la agenda', 'ya no queda en la agenda', o similar).",
          mode: "respond",
        },
      },
      // Red de seguridad: applyAiResponseClaimSecurity (existente, sin
      // tocar) puede rechazar el texto que redacte la IA si coincide con el
      // patrón (más amplio de lo ideal, ver reporte del Blocker #4) de
      // appointment.reserved -- sin esta rama de fallo, ESO haría crashear
      // el camino feliz de una cancelación real y exitosa. El mensaje
      // estático de respaldo es honesto: la cancelación YA ocurrió de
      // verdad (venimos de la rama success de act-cancelar), solo cambia
      // cómo se lo decimos si el redactado de la IA no pasó el filtro.
      {
        id: "msg-cancelada-respaldo",
        type: "message",
        config: { text: "Listo, la eliminé de la agenda por acá 💛", messageRole: "informational" },
      },

      { id: "end-sin-cita", type: "end", config: {} },
      { id: "end-seleccion-no-clara", type: "end", config: {} },
      { id: "end-abandonada", type: "end", config: {} },
      { id: "end-cancelada", type: "end", config: {} },
      { id: "end-cancelada-respaldo", type: "end", config: {} },
      { id: "end-fallo-cancelar", type: "end", config: {} },
    ],
    edges: [
      { id: "e-start", source: "start", target: "act-consultar-citas" },

      { id: "e-consultar-cond", source: "act-consultar-citas", target: "cond-tiene-citas" },

      { id: "e-sin-citas", source: "cond-tiene-citas", target: "msg-sin-cita-activa", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-sin-citas-end", source: "msg-sin-cita-activa", target: "end-sin-cita" },

      { id: "e-con-citas", source: "cond-tiene-citas", target: "cond-multiples-citas", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },

      { id: "e-una-cita", source: "cond-multiples-citas", target: "ai-identificar-unica", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-unica-a-confirmar", source: "ai-identificar-unica", target: "q-confirmar-cancelacion", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-varias-citas", source: "cond-multiples-citas", target: "ai-listar-citas", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-listar-a-pregunta", source: "ai-listar-citas", target: "q-cual-cita", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-pregunta-a-identificar", source: "q-cual-cita", target: "ai-identificar-seleccionada" },
      { id: "e-identificada-cond", source: "ai-identificar-seleccionada", target: "cond-seleccion-clara", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-seleccion-no-clara", source: "cond-seleccion-clara", target: "msg-seleccion-no-clara", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-seleccion-no-clara-end", source: "msg-seleccion-no-clara", target: "end-seleccion-no-clara" },
      { id: "e-seleccion-clara-a-confirmar", source: "cond-seleccion-clara", target: "q-confirmar-cancelacion", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },

      { id: "e-confirmar-cancelar-btn", source: "q-confirmar-cancelacion", target: "ai-clasificar-confirmacion", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.CANCELAR_CITA) },
      { id: "e-confirmar-mantener-btn", source: "q-confirmar-cancelacion", target: "msg-cancelacion-abandonada", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.MANTENER_CITA) },
      { id: "e-confirmar-texto", source: "q-confirmar-cancelacion", target: "ai-clasificar-confirmacion", sourceHandle: FLOW_EDGE_HANDLE.text },

      { id: "e-no-confirma", source: "ai-clasificar-confirmacion", target: "msg-cancelacion-abandonada", sourceHandle: FLOW_EDGE_HANDLE.aiClass("no_confirma") },
      { id: "e-no-confirma-default", source: "ai-clasificar-confirmacion", target: "msg-cancelacion-abandonada", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },
      { id: "e-abandonada-end", source: "msg-cancelacion-abandonada", target: "end-abandonada" },

      { id: "e-confirma", source: "ai-clasificar-confirmacion", target: "ai-proponer-cancelar", sourceHandle: FLOW_EDGE_HANDLE.aiClass("confirma") },
      { id: "e-proponer-a-cancelar", source: "ai-proponer-cancelar", target: "act-cancelar", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-cancelar-exito", source: "act-cancelar", target: "ai-confirmar-cancelacion", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-cancelar-exito-end", source: "ai-confirmar-cancelacion", target: "end-cancelada", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-cancelar-confirmacion-bloqueada", source: "ai-confirmar-cancelacion", target: "msg-cancelada-respaldo", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-cancelada-respaldo-end", source: "msg-cancelada-respaldo", target: "end-cancelada-respaldo" },
      { id: "e-cancelar-fallo", source: "act-cancelar", target: "msg-no-se-pudo-cancelar", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-cancelar-fallo-end", source: "msg-no-se-pudo-cancelar", target: "end-fallo-cancelar" },
    ],
    variables: [
      { key: "cantidadCitas", label: "Cantidad de citas activas", type: "number" },
      { key: "citasActivas", label: "Lista de citas activas reales", type: "string" },
      { key: "citaObjetivoId", label: "Id de la cita a cancelar", type: "string" },
      { key: "citaObjetivoDescripcion", label: "Descripción de la cita a cancelar", type: "string" },
      { key: "seleccionCitaTexto", label: "Respuesta de la clienta sobre cuál cita", type: "string" },
      { key: "respuestaConfirmacionTexto", label: "Respuesta de la clienta a la confirmación", type: "string" },
      { key: "citaId", label: "Id real de la cita cancelada", type: "string" },
      { key: "cancelada", label: "¿Se canceló de verdad?", type: "boolean" },
    ],
  };
}
