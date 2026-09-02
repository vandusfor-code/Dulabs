import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { FlowDefinition } from "@/lib/flow/types";
import { DANIELA_BUTTON_IDS } from "@/lib/flows/daniela-button-ids";

/**
 * Fase 1 (Blocker #5, autorizado) — Daniela: reagendamiento de citas.
 *
 * Flow independiente de agendar/cancelar -- NO activado para ningún tenant.
 * El enrutamiento por intención (agendar/cancelar/reagendar) sigue fuera de
 * alcance, igual que en el Blocker #4.
 *
 * Estrategia de reagendamiento (ver informe de diseño): UPDATE atómico
 * sobre la MISMA fila vía editarCitaConfirmada (lib/especialistas.ts, YA
 * existente, YA usada hoy por el dashboard, SIN modificar) -- nunca
 * "cancelar la vieja y crear una nueva". El constraint EXCLUDE real decide
 * si el nuevo horario choca con otra cita, igual que decide un INSERT
 * nuevo. Jamás existe una segunda fila.
 *
 * Secuencia:
 *   consultar TODAS las citas activas reales
 *   → ¿cuántas? 0 → informar y terminar
 *              1 → identificar esa cita
 *              2+ → listar las reales y preguntar cuál (nunca elige sola)
 *   → (converge) preguntar nueva fecha y nueva hora
 *   → consultar disponibilidad REAL para ese día (acción, no la IA)
 *   → ¿disponible? no → informar, conservar la cita original, terminar
 *                  sí → preguntar confirmación explícita
 *   → clasificar respuesta: confirma / no confirma
 *       no confirma → abandona, la cita original queda intacta
 *       confirma → proponer mover_cita_especialista (UPDATE atómico real)
 *   → mover cita REAL (acción crítica)
 *       éxito → SOLO ENTONCES un nodo IA redacta la confirmación con datos reales
 *       fallo (ocupado por una carrera, u otro error) → informar, cita original intacta
 */
export function danielaReagendarCitaFlow(): FlowDefinition {
  return {
    name: "Daniela — Reagendar cita (Fase 1, diseño)",
    description:
      "Reagendamiento real (UPDATE atómico sobre la misma fila, vía editarCitaConfirmada) sobre dulabs_citas_especialista. NO activado para ningún tenant.",
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
      // -- mismo criterio que el flow de cancelar (mode "respond"): el
      // identificador le cuenta la cita real a la clienta.
      {
        id: "ai-identificar-unica",
        type: "ai",
        config: {
          instruction:
            "La clienta tiene EXACTAMENTE una cita activa real, en la variable citasActivas (un solo elemento). Dile con naturalidad cuál es (servicio + fecha/hora) para que sepa de cuál se trata -- todavía NO le preguntes la nueva fecha, eso lo hace la pregunta siguiente. Además, guarda su id en citaObjetivoId, una descripción corta en citaObjetivoDescripcion, y su servicio exacto en citaObjetivoServicio. No inventes ni asumas nada que no esté en esa variable.",
          mode: "respond",
          outputVariables: ["citaObjetivoId", "citaObjetivoDescripcion", "citaObjetivoServicio"],
        },
      },

      // Varias citas activas: las lista y pregunta cuál -- nunca elige sola.
      {
        id: "ai-listar-citas",
        type: "ai",
        config: {
          instruction:
            "La clienta tiene varias citas activas reales, en la variable citasActivas. Preséntaselas con naturalidad (servicio + fecha/hora de cada una) y pregúntale cuál quiere reagendar. No asumas cuál quiere.",
          mode: "respond",
        },
      },
      {
        id: "q-cual-cita",
        type: "question",
        config: { text: "¿Cuál de esas citas quieres reagendar?", variableKey: "seleccionCitaTexto", required: true, validation: { kind: "text" } },
      },
      {
        id: "ai-identificar-seleccionada",
        type: "ai",
        config: {
          instruction:
            "La clienta tiene varias citas reales en citasActivas y acaba de responder, en seleccionCitaTexto, cuál quiere reagendar. Identifica a CUÁL de las citas reales de citasActivas se refiere, confírmale con naturalidad cuál entendiste que es, y guarda su id en citaObjetivoId, una descripción corta en citaObjetivoDescripcion, y su servicio exacto en citaObjetivoServicio. Si su respuesta es ambigua y no puedes identificar con certeza cuál es, dile que no quedó claro cuál es, y deja citaObjetivoId vacío -- nunca la adivines.",
          mode: "respond",
          outputVariables: ["citaObjetivoId", "citaObjetivoDescripcion", "citaObjetivoServicio"],
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

      // Punto de convergencia: ya hay una cita objetivo identificada.
      //
      // Rediseño de agendamiento (autorizado) — misma disciplina que
      // daniela-agendar-cita.flow.ts: la fecha en texto libre SIEMPRE pasa
      // por el parser determinista (act-validar-nueva-fecha) antes de tocar
      // disponibilidad; la hora usa la validación determinista nativa
      // hora_colombia (mismo parseHoraColombia que ya usaba el q-hora
      // original de agendar) en vez de aceptar texto libre sin validar
      // (hallazgo 🟠 de la auditoría -- reagendar no tenía NINGUNA
      // protección, ni siquiera la parcial que agendar sí tenía).
      {
        id: "q-nueva-fecha",
        type: "question",
        config: { text: "¿Para qué día te gustaría moverla? 📅 (por ejemplo: \"el sábado\", \"mañana\" o \"4 de septiembre\")", variableKey: "nuevaFechaTexto", required: true, validation: { kind: "text" } },
      },
      {
        id: "act-validar-nueva-fecha",
        type: "action",
        config: { actionType: "validar_fecha_especialista" },
      },
      {
        id: "msg-nueva-fecha-invalida",
        type: "message",
        config: {
          text: "No logré identificar bien esa fecha 😅 ¿Me la puedes decir de otra forma? (por ejemplo: \"el sábado\", \"mañana\" o \"4 de septiembre\")",
          messageRole: "informational",
        },
      },
      {
        id: "q-nueva-hora",
        type: "question",
        config: { text: "¿A qué hora te queda mejor? 🕓", variableKey: "nuevaHoraTexto", required: true, validation: { kind: "hora_colombia" } },
      },

      // Rediseño de agendamiento (autorizado) — acción DIRECTA, sin nodo AI
      // intermedio. ai-proponer-consultar (propose_action) era passthrough
      // puro (solo copiaba citaObjetivoServicio/nuevaFechaTexto a
      // servicio/fecha, sin ninguna interpretación real). El executor ahora
      // acepta esos nombres directo (ver internal-action-executor.ts::
      // consultarDisponibilidadEspecialistaAction).
      {
        id: "act-consultar-disponibilidad",
        type: "action",
        config: { actionType: "consultar_disponibilidad_especialista" },
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
          text: "Justo ese día no se pudo con ese horario 😔 ¿me das otra fecha o alguna hora distinta?",
          messageRole: "informational",
        },
      },

      // Disponible: se lo confirma Y le pide autorización explícita en el
      // MISMO paso -- todavía no toca nada, solo pregunta.
      {
        id: "q-confirmar-reagendar",
        type: "buttons",
        config: {
          text: "Sí, ese día hay espacio. ¿Confirmas que quieres moverla a esa fecha y hora?",
          variableKey: "respuestaConfirmacionTexto",
          buttons: [
            { id: DANIELA_BUTTON_IDS.CONFIRMAR_CAMBIO, label: "Confirmar cambio" },
            { id: DANIELA_BUTTON_IDS.MANTENER_CITA, label: "Mantener cita" },
          ],
        },
      },
      {
        id: "ai-clasificar-confirmacion",
        type: "ai",
        config: {
          instruction:
            "La clienta respondió, en respuestaConfirmacionTexto, a la pregunta de si quiere mover su cita a la nueva fecha/hora. Clasifica como 'confirma' SOLO si es un sí claro e inequívoco a MOVERLA (ej. 'sí', 'sí, muévela', 'confirmo') o si el valor es exactamente 'confirmar_cambio'. Cualquier otra cosa -- un no, 'mantener_cita', una duda, 'mejor no', o cualquier respuesta que no sea un sí claro -- clasifícala como 'no_confirma'. Ante la duda, SIEMPRE 'no_confirma': nunca asumas que sí quiere cambiar su cita.",
          mode: "classify",
          classifications: ["confirma", "no_confirma"],
        },
      },
      {
        id: "msg-reagendamiento-abandonado",
        type: "message",
        config: { text: "Perfecto, entonces dejo todo como estaba 💛", messageRole: "informational" },
      },

      // Rediseño de agendamiento (autorizado) — acción DIRECTA, sin nodo AI
      // intermedio. ai-proponer-mover (propose_action) era passthrough puro
      // (solo copiaba citaObjetivoId/nuevaFechaTexto/nuevaHoraTexto a
      // citaId/nuevaFecha/nuevaHora, sin ninguna interpretación real) --
      // mismo criterio ya aplicado en agendar/cancelar. confirmado="true"
      // fijo, solo alcanzable tras class:confirma, revalidado además por el
      // adaptador (defense-in-depth, igual que en agendar/cancelar).
      {
        id: "act-mover-cita",
        type: "action",
        config: { actionType: "mover_cita_especialista", params: { confirmado: "true" } },
      },
      {
        id: "msg-no-se-pudo-mover",
        type: "message",
        config: { text: "Justo a esa hora no se pudo 😔 ¿me das otra?", messageRole: "informational" },
      },
      {
        id: "ai-confirmar-reagendamiento",
        type: "ai",
        config: {
          instruction:
            "La acción de mover la cita YA CORRIÓ y tienes su resultado real en las variables citaId, inicio y fin. Redacta la confirmación a la clienta usando ESOS datos reales, nunca inventados -- dile con calidez que ya la dejaste en el nuevo horario. Evita literalmente las palabras 'cambiada'/'movida'/'reagendada' (usa 'la dejé en el nuevo horario', 'ya quedó ahí', o similar).",
          mode: "respond",
        },
      },
      // Misma red de seguridad que en cancelación (Blocker #4): si
      // applyAiResponseClaimSecurity rechaza la redacción de la IA, cae a
      // un mensaje estático de respaldo -- la operación YA ocurrió de
      // verdad (venimos de la rama success de act-mover-cita), solo
      // cambia cómo se lo decimos.
      {
        id: "msg-reagendado-respaldo",
        type: "message",
        config: { text: "Listo, la dejé en el nuevo horario por acá 💛", messageRole: "informational" },
      },

      { id: "end-sin-cita", type: "end", config: {} },
      { id: "end-seleccion-no-clara", type: "end", config: {} },
      { id: "end-sin-disponibilidad", type: "end", config: {} },
      { id: "end-abandonado", type: "end", config: {} },
      { id: "end-reagendado", type: "end", config: {} },
      { id: "end-reagendado-respaldo", type: "end", config: {} },
      { id: "end-fallo-mover", type: "end", config: {} },
    ],
    edges: [
      { id: "e-start", source: "start", target: "act-consultar-citas" },
      { id: "e-consultar-cond", source: "act-consultar-citas", target: "cond-tiene-citas" },

      { id: "e-sin-citas", source: "cond-tiene-citas", target: "msg-sin-cita-activa", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-sin-citas-end", source: "msg-sin-cita-activa", target: "end-sin-cita" },
      { id: "e-con-citas", source: "cond-tiene-citas", target: "cond-multiples-citas", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },

      { id: "e-una-cita", source: "cond-multiples-citas", target: "ai-identificar-unica", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-unica-a-fecha", source: "ai-identificar-unica", target: "q-nueva-fecha", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-varias-citas", source: "cond-multiples-citas", target: "ai-listar-citas", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-listar-a-pregunta", source: "ai-listar-citas", target: "q-cual-cita", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-pregunta-a-identificar", source: "q-cual-cita", target: "ai-identificar-seleccionada" },
      { id: "e-identificada-cond", source: "ai-identificar-seleccionada", target: "cond-seleccion-clara", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-seleccion-no-clara", source: "cond-seleccion-clara", target: "msg-seleccion-no-clara", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-seleccion-no-clara-end", source: "msg-seleccion-no-clara", target: "end-seleccion-no-clara" },
      { id: "e-seleccion-clara-a-fecha", source: "cond-seleccion-clara", target: "q-nueva-fecha", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },

      { id: "e-fecha-a-validar", source: "q-nueva-fecha", target: "act-validar-nueva-fecha" },
      { id: "e-validar-fecha-ok", source: "act-validar-nueva-fecha", target: "q-nueva-hora", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-validar-fecha-fail", source: "act-validar-nueva-fecha", target: "msg-nueva-fecha-invalida", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-fecha-invalida-reintentar", source: "msg-nueva-fecha-invalida", target: "q-nueva-fecha" },
      { id: "e-hora-a-consultar", source: "q-nueva-hora", target: "act-consultar-disponibilidad" },
      { id: "e-consultar-a-cond", source: "act-consultar-disponibilidad", target: "cond-disponible", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-sin-disponibilidad", source: "cond-disponible", target: "msg-sin-disponibilidad", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-sin-disponibilidad-end", source: "msg-sin-disponibilidad", target: "end-sin-disponibilidad" },
      { id: "e-disponible-a-confirmar", source: "cond-disponible", target: "q-confirmar-reagendar", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },

      { id: "e-confirmar-reagendar-btn", source: "q-confirmar-reagendar", target: "ai-clasificar-confirmacion", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.CONFIRMAR_CAMBIO) },
      { id: "e-confirmar-mantener-btn", source: "q-confirmar-reagendar", target: "msg-reagendamiento-abandonado", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.MANTENER_CITA) },
      { id: "e-confirmar-texto", source: "q-confirmar-reagendar", target: "ai-clasificar-confirmacion", sourceHandle: FLOW_EDGE_HANDLE.text },
      { id: "e-no-confirma", source: "ai-clasificar-confirmacion", target: "msg-reagendamiento-abandonado", sourceHandle: FLOW_EDGE_HANDLE.aiClass("no_confirma") },
      { id: "e-no-confirma-default", source: "ai-clasificar-confirmacion", target: "msg-reagendamiento-abandonado", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },
      { id: "e-abandonado-end", source: "msg-reagendamiento-abandonado", target: "end-abandonado" },

      { id: "e-confirma", source: "ai-clasificar-confirmacion", target: "act-mover-cita", sourceHandle: FLOW_EDGE_HANDLE.aiClass("confirma") },

      { id: "e-mover-exito", source: "act-mover-cita", target: "ai-confirmar-reagendamiento", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-mover-exito-end", source: "ai-confirmar-reagendamiento", target: "end-reagendado", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-confirmacion-bloqueada", source: "ai-confirmar-reagendamiento", target: "msg-reagendado-respaldo", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-respaldo-end", source: "msg-reagendado-respaldo", target: "end-reagendado-respaldo" },
      { id: "e-mover-fallo", source: "act-mover-cita", target: "msg-no-se-pudo-mover", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-mover-fallo-end", source: "msg-no-se-pudo-mover", target: "end-fallo-mover" },
    ],
    variables: [
      { key: "cantidadCitas", label: "Cantidad de citas activas", type: "number" },
      { key: "citasActivas", label: "Lista de citas activas reales", type: "string" },
      { key: "citaObjetivoId", label: "Id de la cita a reagendar", type: "string" },
      { key: "citaObjetivoDescripcion", label: "Descripción de la cita a reagendar", type: "string" },
      { key: "citaObjetivoServicio", label: "Servicio real de la cita a reagendar", type: "string" },
      { key: "seleccionCitaTexto", label: "Respuesta de la clienta sobre cuál cita", type: "string" },
      { key: "nuevaFechaTexto", label: "Nueva fecha solicitada (texto crudo de la clienta)", type: "string" },
      { key: "nuevaFecha", label: "Nueva fecha validada (YYYY-MM-DD real)", type: "string" },
      { key: "hoy", label: "Fecha de hoy (Colombia), usada por act-validar-nueva-fecha", type: "string" },
      { key: "nuevaHoraTexto", label: "Nueva hora solicitada (ya validada, hora_colombia)", type: "string" },
      { key: "disponible", label: "¿Hay disponibilidad en la nueva fecha?", type: "boolean" },
      { key: "respuestaConfirmacionTexto", label: "Respuesta de la clienta a la confirmación", type: "string" },
      { key: "citaId", label: "Id real de la cita movida", type: "string" },
      { key: "inicio", label: "Nuevo inicio real de la cita", type: "string" },
      { key: "fin", label: "Nuevo fin real de la cita", type: "string" },
    ],
  };
}
