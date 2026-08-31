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
 *   → consultar disponibilidad REAL (acción directa, sin nodo AI intermedio
 *     -- ver nota de Fase 1 más abajo)
 *   → ¿disponible? no → avisar y terminar
 *                  sí → un nodo AI (mode: respond) le cuenta a la clienta lo
 *                       que encontró disponible (servicio/fecha/hora/
 *                       especialista, datos REALES de la acción, nunca
 *                       inventados) -- todavía NO pregunta nada
 *   → PREGUNTA EXPLÍCITA "¿Deseas confirmar la cita?" (nodo question)
 *   → clasificar la respuesta: confirma / no_confirma
 *       no confirma (o cualquier respuesta ambigua, por default) → abandona,
 *                                                                   NO agenda nada
 *       confirma → agendar cita REAL (acción directa, constraint EXCLUDE real)
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
 * Fase 1 (bug crítico real, prueba con el 314, autorizado) — dos cambios
 * sobre el diseño original:
 *
 *   1. `ai-consultar` y `ai-agendar` (ambos `mode: "propose_action"`)
 *      quedaron eliminados. Investigación confirmó que eran puro
 *      passthrough: `act-consultar`/`act-agendar` ya reciben servicio/
 *      fecha/hora/nombreCliente directamente de `state.variables` (el motor
 *      mezcla el payload de la acción con las variables reales, ver
 *      internal-action-executor.ts::mergeParams) -- el nodo AI no aportaba
 *      ninguna interpretación real, solo "proponía" una llamada con datos
 *      que ya existían. Consumían presupuesto de IA (`checkAiBudget`) sin
 *      necesidad, y ESE fue el mecanismo exacto del bug real: el
 *      presupuesto de ejecución (`maxExecutionDurationMs`, ver
 *      lib/flow/claude/claude-budget.ts) se mide desde la PRIMERA llamada
 *      AI de toda la ejecución (el classify del router), y una clienta real
 *      tardando minutos en escribir servicio/fecha/hora/nombre agotaba ese
 *      presupuesto antes de llegar a `ai-consultar`, sin que ninguna
 *      llamada real a Claude/Supabase hubiera sido lenta. `validate-
 *      security.ts` solo exige rama de fallo para acciones `critical`
 *      (agendar_cita_especialista) -- no exige que una acción esté
 *      precedida por un nodo AI, así que conectar `q-nombre`/`ai-clasificar-
 *      confirmacion` directo a los nodos `action` es válido para publicar.
 *
 *   2. Se agregó la barrera de confirmación explícita
 *      (`q-confirmar-cita` → `ai-clasificar-confirmacion`) que este diseño
 *      NUNCA tuvo -- replicando el patrón ya probado de
 *      lib/flows/daniela-cancelar-cita.flow.ts. Antes de este cambio, el
 *      camino "sí hay disponibilidad" iba derecho a agendar sin preguntar
 *      nada; la única garantía existente era "no mentir sobre el resultado
 *      antes de que la acción corriera", no "pedir permiso antes de actuar".
 *      `act-agendar` ahora es alcanzable ÚNICAMENTE desde la arista
 *      `class:confirma` de `ai-clasificar-confirmacion` -- verificado por
 *      test de alcanzabilidad en daniela-agendar-cita.flow.test.ts, igual
 *      que ya existe para `act-cancelar` en el flow de cancelación.
 *
 * Simplificado a propósito para esta fase de diseño (documentado en
 * DANIELA_PROMPT_A_FLOW.md): sin ramas de reagendar, sin las frases exactas
 * de la personalidad de marca, sin el desvío a "Daniela por producto" --
 * esas son iteraciones de Builder posteriores, no necesarias para demostrar
 * que el adaptador y la arquitectura de evidencia sostienen el caso de uso
 * central.
 */
export function danielaAgendarCitaFlow(): FlowDefinition {
  return {
    name: "Daniela — Agendar cita (Fase 1, corrección bug confirmación)",
    description:
      "Reproduce el camino real de agendamiento de Daniela sobre dulabs_especialistas / dulabs_citas_especialista vía el adaptador de Fase 0, con barrera de confirmación explícita antes de agendar (Fase 1). NO activado para ningún tenant.",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },

      // Fase 3 (Bug raíz #4, slot-filling) — extrae del PRIMER mensaje de la
      // clienta (userMessage = __firstMessageText, ver Fix B) lo que ya haya
      // dicho: servicio, fecha, hora, nombre. Resuelve referencias relativas
      // ("el viernes") usando la variable 'hoy' (sembrada por el orchestrator
      // al crear la ejecución). Solo escribe una variable si está claramente
      // presente; si no, la omite y la pregunta correspondiente se hará. La
      // disponibilidad NUNCA se infiere acá -- eso lo decide act-consultar.
      // outputVariables limita EXACTAMENTE qué puede escribir el modelo.
      {
        id: "ai-extraer",
        type: "ai",
        config: {
          instruction:
            "Lee el mensaje de la clienta (contenido del usuario) y extrae SOLO los datos que estén claramente presentes para agendar una cita. Devuelve un objeto con las claves que apliquen: " +
            "'servicio' (el servicio que menciona, ej. 'semipermanente', 'pestañas', 'manos'; NO lo inventes ni normalices a un catálogo), " +
            "'fecha' (en formato YYYY-MM-DD; si la clienta usa una referencia relativa como 'el viernes', 'mañana', 'el 2', resuélvela usando la variable 'hoy' que contiene la fecha de hoy en Colombia; si no da ninguna fecha, OMITE esta clave), " +
            "'hora' (en formato HH:MM de 24h; ej. '5:00 PM' -> '17:00'; si no da hora, OMITE esta clave), " +
            "'nombreCliente' (solo si dice explícitamente a nombre de quién, ej. 'para Ana'; si no, OMITE esta clave). " +
            "NO incluyas ninguna clave para un dato que la clienta no haya dado de forma clara. NO afirmes disponibilidad ni agendes nada -- esto solo interpreta el mensaje inicial.",
          mode: "extract",
          outputVariables: ["servicio", "fecha", "hora", "nombreCliente"],
        },
      },

      // Fase 3 — slot-filling condicional: cada dato se pregunta SOLO si no se
      // extrajo (o quedó vacío -- el operador 'exists' trata "" como faltante,
      // ver flow-engine.ts evaluateRule). Una sola pregunta por dato (Bug raíz
      // #5: ya no hay msg-saludo + q-servicio duplicados).
      {
        id: "cond-servicio",
        type: "condition",
        config: { rules: [{ field: "servicio", operator: "exists" }], match: "all" },
      },
      {
        id: "q-servicio",
        type: "question",
        config: { text: "¿Qué servicio deseas agendar? 🥰", variableKey: "servicio", required: true, validation: { kind: "text" } },
      },
      {
        id: "cond-fecha",
        type: "condition",
        config: { rules: [{ field: "fecha", operator: "exists" }], match: "all" },
      },
      {
        id: "q-fecha",
        type: "question",
        config: { text: "¿Para qué día? (AAAA-MM-DD)", variableKey: "fecha", required: true, validation: { kind: "text" } },
      },
      {
        id: "cond-hora",
        type: "condition",
        config: { rules: [{ field: "hora", operator: "exists" }], match: "all" },
      },
      {
        id: "q-hora",
        type: "question",
        config: { text: "¿A qué hora te queda bien? (HH:MM)", variableKey: "hora", required: true, validation: { kind: "text" } },
      },
      {
        id: "cond-nombre",
        type: "condition",
        config: { rules: [{ field: "nombreCliente", operator: "exists" }], match: "all" },
      },
      {
        id: "q-nombre",
        type: "question",
        config: { text: "¿A nombre de quién la agendo?", variableKey: "nombreCliente", required: true, validation: { kind: "text" } },
      },

      // Fase 1 — acción DIRECTA, sin nodo AI intermedio (ver nota de diseño
      // arriba). servicio/fecha ya están en state.variables.
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

      // Fase 1 — informa la disponibilidad real encontrada (datos de
      // act-consultar: servicio/fecha/hora/especialista), pero TODAVÍA no
      // pregunta nada -- eso lo hace q-confirmar-cita a continuación. Mismo
      // patrón que ai-identificar-unica en daniela-cancelar-cita.flow.ts.
      {
        id: "ai-proponer-cita",
        type: "ai",
        config: {
          instruction:
            "Hay disponibilidad real confirmada para lo que pidió la clienta, en las variables servicio, fecha, hora y especialista (ya reales, verificadas por la herramienta de consulta -- no las inventes ni las cambies). Cuéntale con naturalidad qué encontraste disponible: el servicio, el día, la hora y con quién sería. Todavía NO le preguntes si confirma -- eso lo hace la pregunta siguiente. NUNCA digas que la cita ya quedó agendada, solo que hay disponibilidad para eso.",
          mode: "respond",
        },
      },

      // Fase 1 — barrera de confirmación explícita (nunca existió antes).
      // Replica el patrón ya probado de daniela-cancelar-cita.flow.ts:
      // question (texto fijo) -> classify (confirma/no_confirma) -> SOLO
      // "confirma" llega a la acción real.
      {
        id: "q-confirmar-cita",
        type: "question",
        config: {
          text: "¿Deseas confirmar la cita?",
          variableKey: "respuestaConfirmacionAgendarTexto",
          required: true,
          validation: { kind: "text" },
        },
      },
      {
        id: "ai-clasificar-confirmacion",
        type: "ai",
        config: {
          instruction:
            "La clienta respondió, en respuestaConfirmacionAgendarTexto, a la pregunta de si confirma agendar la cita propuesta. Clasifica su respuesta como 'confirma' SOLO si es un sí claro e inequívoco (ej. 'sí', 'confirmo', 'dale', 'correcto', 'de una'). Cualquier otra cosa -- un no, una duda, 'mejor no', un cambio de tema, o cualquier respuesta que no sea un sí claro -- clasifícala como 'no_confirma'. Ante la duda, SIEMPRE 'no_confirma': nunca asumas que sí quiere agendar.",
          mode: "classify",
          classifications: ["confirma", "no_confirma"],
        },
      },
      {
        id: "msg-cita-no-confirmada",
        type: "message",
        config: {
          text: "Entendido, no agendo nada por ahora 💛 Aquí estoy si quieres agendar en otro momento.",
          messageRole: "informational",
        },
      },

      // Fase 1 — acción DIRECTA, sin nodo AI intermedio. Solo alcanzable
      // desde la arista class:confirma de ai-clasificar-confirmacion (ver
      // test de alcanzabilidad). Fase 2b (defense-in-depth) — params.confirmado
      // fijo en "true": es seguro porque este nodo es estructuralmente
      // inalcanzable salvo tras 'confirma', y el adaptador
      // (especialistas-flow-adaptador.ts::agendarCitaEspecialista) vuelve a
      // exigirlo como segunda barrera independiente, no decorativa.
      {
        id: "act-agendar",
        type: "action",
        config: { actionType: "agendar_cita_especialista", params: { confirmado: "true" } },
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

      // Fase 3 (Bug raíz #2) — red de seguridad para ai-confirmar, igual que
      // ya existe en cancelar/reagendar (msg-*-respaldo). act-agendar YA creó
      // la cita real (venimos de su rama success); si por CUALQUIER razón
      // ai-confirmar falla (claim-security, timeout, error de API), este
      // mensaje estático deja claro que la cita SÍ quedó, sin volver a
      // consultar ni crear nada, y CIERRA el flujo -- así el turno queda
      // "manejado por Flow" (yaEnvioAlgo=true) y JAMÁS cae a LEGACY. Con el
      // Fix del Bug raíz #1 este camino casi nunca se toma, pero es la
      // garantía estructural de que una acción crítica exitosa nunca termina
      // en una contradicción de LEGACY (incidente de la cita #796).
      {
        id: "msg-confirmada-respaldo",
        type: "message",
        config: {
          text: "¡Listo! Tu cita quedó agendada 💛 Te esperamos.",
          messageRole: "informational",
        },
      },

      { id: "end-confirmado", type: "end", config: {} },
      { id: "end-confirmado-respaldo", type: "end", config: {} },
      { id: "end-sin-disponibilidad", type: "end", config: {} },
      { id: "end-ocupado", type: "end", config: {} },
      { id: "end-no-confirmada", type: "end", config: {} },
    ],
    edges: [
      // Fase 3 — slot-filling condicional. start -> extracción -> por cada
      // dato: si YA existe (extraído), se salta la pregunta; si no, se
      // pregunta y luego se sigue al siguiente dato.
      { id: "e-start", source: "start", target: "ai-extraer" },
      { id: "e-extraer-servicio", source: "ai-extraer", target: "cond-servicio", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-servicio-falta", source: "cond-servicio", target: "q-servicio", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-servicio-tiene", source: "cond-servicio", target: "cond-fecha", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-servicio-a-fecha", source: "q-servicio", target: "cond-fecha" },

      { id: "e-fecha-falta", source: "cond-fecha", target: "q-fecha", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-fecha-tiene", source: "cond-fecha", target: "cond-hora", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-fecha-a-hora", source: "q-fecha", target: "cond-hora" },

      { id: "e-hora-falta", source: "cond-hora", target: "q-hora", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-hora-tiene", source: "cond-hora", target: "cond-nombre", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-hora-a-nombre", source: "q-hora", target: "cond-nombre" },

      { id: "e-nombre-falta", source: "cond-nombre", target: "q-nombre", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-nombre-tiene", source: "cond-nombre", target: "act-consultar", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-nombre-consultar", source: "q-nombre", target: "act-consultar" },

      { id: "e-consultar-cond", source: "act-consultar", target: "cond-disponible", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-consultar-no-reconocido", source: "act-consultar", target: "msg-servicio-no-reconocido", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      // Servicio no reconocido: se vuelve a preguntar SOLO el servicio; la
      // fecha/hora ya recolectadas se conservan (cond-fecha/cond-hora las
      // saltarán). q-servicio sobrescribe el servicio inválido.
      { id: "e-no-reconocido-reintentar", source: "msg-servicio-no-reconocido", target: "q-servicio" },

      { id: "e-cond-true", source: "cond-disponible", target: "ai-proponer-cita", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-cond-false", source: "cond-disponible", target: "msg-sin-disponibilidad", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-sin-disponibilidad-end", source: "msg-sin-disponibilidad", target: "end-sin-disponibilidad" },

      { id: "e-proponer-a-confirmar", source: "ai-proponer-cita", target: "q-confirmar-cita", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-confirmar-a-clasificar", source: "q-confirmar-cita", target: "ai-clasificar-confirmacion" },

      { id: "e-no-confirma", source: "ai-clasificar-confirmacion", target: "msg-cita-no-confirmada", sourceHandle: FLOW_EDGE_HANDLE.aiClass("no_confirma") },
      { id: "e-no-confirma-default", source: "ai-clasificar-confirmacion", target: "msg-cita-no-confirmada", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },
      { id: "e-no-confirmada-end", source: "msg-cita-no-confirmada", target: "end-no-confirmada" },

      { id: "e-confirma-agendar", source: "ai-clasificar-confirmacion", target: "act-agendar", sourceHandle: FLOW_EDGE_HANDLE.aiClass("confirma") },

      { id: "e-agendar-success", source: "act-agendar", target: "ai-confirmar", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-agendar-failure", source: "act-agendar", target: "msg-ocupado", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-ocupado-end", source: "msg-ocupado", target: "end-ocupado" },

      { id: "e-confirmar-end", source: "ai-confirmar", target: "end-confirmado", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      // Fase 3 (Bug raíz #2) — si ai-confirmar falla, cae al respaldo estático
      // (la cita YA está creada) y cierra el flujo. NUNCA vuelve a act-agendar
      // ni a act-consultar.
      { id: "e-confirmar-respaldo", source: "ai-confirmar", target: "msg-confirmada-respaldo", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-respaldo-end", source: "msg-confirmada-respaldo", target: "end-confirmado-respaldo" },
    ],
    variables: [
      // 'hoy' la siembra el orchestrator al crear la ejecución (fecha de hoy
      // en Colombia, YYYY-MM-DD); la usa ai-extraer para resolver fechas
      // relativas. Declarada aquí solo como documentación (sin defaultValue).
      { key: "hoy", label: "Fecha de hoy (Colombia)", type: "string" },
      { key: "servicio", label: "Servicio", type: "string", required: true },
      { key: "fecha", label: "Fecha", type: "string", required: true },
      { key: "hora", label: "Hora", type: "string", required: true },
      { key: "nombreCliente", label: "Nombre de la clienta", type: "string", required: true },
      { key: "disponible", label: "¿Hay disponibilidad?", type: "boolean" },
      { key: "respuestaConfirmacionAgendarTexto", label: "Respuesta de la clienta a la confirmación de agendar", type: "string" },
      { key: "citaId", label: "ID de la cita real creada", type: "string", linkedCapability: "appointment.reserved" },
      { key: "status", label: "Estado real de la cita (confirmada/pendiente)", type: "string" },
      { key: "especialista", label: "Especialista asignada realmente", type: "string" },
    ],
  };
}
