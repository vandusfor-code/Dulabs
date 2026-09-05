import { FIRST_MESSAGE_TEXT_VARIABLE_KEY, FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { FlowDefinition } from "@/lib/flow/types";

/**
 * AMORE — Fase 2 (asistente conversacional, autorizado).
 *
 * Piezas reutilizadas TAL CUAL de Daniela (sin tocar ninguno de sus
 * archivos):
 * - Patrón de clasificación de intención con IA leyendo __firstMessageText
 *   (mismo mecanismo que lib/flows/daniela-router.flow.ts::ai-clasificar-intencion,
 *   sembrado por el Engine en el evento "start", ver Fase 1 Blocker #1).
 * - actionType "validar_fecha_especialista" (lib/flow/executors/internal-action-executor.ts)
 *   -- parser de fecha determinista (parse-fecha-colombia.ts), 100%
 *   agnóstico de tenant/modelo de datos, reutilizado sin ningún cambio.
 * - actionType "transferir_soporte" -- mismo mecanismo genérico de traspaso
 *   a un humano ya usado por Daniela (escape hatch) y Solotalento (opción
 *   "Hablar con nuestra asesora"), reutilizado tal cual como placeholder de
 *   "iniciar el proceso de reserva" mientras no exista el portal conectado.
 * - El patrón completo de "listar catálogo -> extraer hint del primer
 *   mensaje -> resolver por hint -> si falla, preguntar y resolver por
 *   selección -> si falla, reintentar" -- calcado del grafo de
 *   daniela-agendar-cita.flow.ts (mismo orden de nodos/edges), pero contra
 *   actionTypes NUEVOS (listar_catalogo_servicios/resolver_servicio_catalogo/
 *   consultar_disponibilidad_catalogo) que sí leen el modelo ESTRUCTURADO
 *   real de AMORE (dulabs_servicios/dulabs_servicio_especialista) en vez del
 *   modelo de base_conocimiento de Daniela -- ver
 *   lib/catalogo-servicios-flow-adaptador.ts para el porqué completo.
 *
 * Alcance de esta fase (autorizado, explícito): NO crea ninguna cita real
 * (agendar_cita_especialista/agendar_cita_marketplace NUNCA aparecen en este
 * grafo). "Iniciar el proceso de reserva" termina en un traspaso a un humano
 * (transferir_soporte) -- el mismo mecanismo que después, cuando exista el
 * portal de reservas de AMORE, se reemplaza por un mensaje con el enlace
 * real (ver TODO en msg-camino-reserva más abajo). No hay cron, no hay envío
 * de plantillas, no hay campañas.
 */

export const AMORE_MSG_BIENVENIDA = "¡Hola! 💗 Bienvenida a AMORE. ¿En qué podemos ayudarte?";

export function amoreRouterFlow(): FlowDefinition {
  return {
    name: "AMORE — Asistente conversacional (Fase 2)",
    description:
      "Saluda, entiende qué servicio quiere la clienta (catálogo REAL de AMORE), informa precio/duración reales, y si quiere agendar, consulta disponibilidad REAL (resolver existente) y ofrece a las profesionales elegibles antes de pasar el proceso a un humano. Sin creación de citas todavía.",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },

      {
        id: "ai-clasificar-intencion",
        type: "ai",
        config: {
          instruction:
            "Lee el mensaje de la clienta en la variable __firstMessageText y clasifica su intención en UNA de estas categorías: " +
            "'agendar' (quiere una cita o reservar, ej. 'quiero una cita', 'quiero reservar', 'quiero hacerme las uñas', 'quiero un peinado para el sábado'). " +
            "'info_servicio' (solo pregunta precio/duración/información de un servicio, SIN pedir cita, ej. 'cuánto cuesta el semipermanente', 'cuánto dura el dipping'). " +
            "'menu' (saludo o apertura sin otra intención clara: 'hola', 'buenas', 'buenos días'). " +
            "'otro' (mensaje ambiguo, sin intención clara, o si __firstMessageText no existe o no aporta nada claro). " +
            "Ante la duda entre agendar e info_servicio, si NO pidió cita usa 'info_servicio'. Ante cualquier otra duda genuina, clasifica como 'otro' -- nunca asumas 'agendar' por defecto.",
          mode: "classify",
          classifications: ["agendar", "info_servicio", "menu", "otro"],
        },
      },

      // "menu"/"otro" -- misma pregunta abierta para ambos casos (mismo
      // criterio de simplicidad pedido: sin menú de botones, conversación
      // natural). La respuesta vuelve a pasar por ai-clasificar-intencion.
      {
        id: "q-bienvenida",
        type: "question",
        config: { text: AMORE_MSG_BIENVENIDA, variableKey: FIRST_MESSAGE_TEXT_VARIABLE_KEY, required: true, validation: { kind: "text" } },
      },

      // --- Catálogo real (dulabs_servicios) -----------------------------
      { id: "act-listar-catalogo", type: "action", config: { actionType: "listar_catalogo_servicios" } },
      {
        id: "cond-hay-catalogo",
        type: "condition",
        config: { rules: [{ field: "cantidadCatalogo", operator: "greater_than", value: 0 }], match: "all" },
      },
      {
        id: "msg-catalogo-no-disponible",
        type: "message",
        config: { text: "En este momento no tengo el catálogo a la mano 😔 En un momento nuestro equipo te ayuda directamente.", messageRole: "informational" },
      },
      { id: "act-handoff-sin-catalogo", type: "action", config: { actionType: "transferir_soporte", pauseDurationHours: 24 } },
      { id: "end-sin-catalogo", type: "end", config: {} },

      // Camino rápido: si el primer mensaje ya nombró un servicio real
      // ("quiero hacerme las uñas" no es un nombre exacto, pero
      // "Cambio de Esmalte" sí podría venir tal cual) se intenta resolver
      // directo; si no calza (o es ambiguo), se muestra el catálogo real y
      // se pregunta -- mismo patrón exacto que Daniela.
      {
        id: "ai-extraer-servicio",
        type: "ai",
        config: {
          instruction:
            "Lee el mensaje de la clienta en __firstMessageText y extrae SOLO 'servicio' si menciona claramente el NOMBRE de un servicio real (ej. 'uñas', 'dipping', 'peinado'). Nunca lo inventes ni lo normalices a un catálogo que no has visto -- si no hay un nombre claro, OMITE la clave.",
          mode: "extract",
          outputVariables: ["servicio"],
        },
      },
      { id: "act-resolver-servicio-inicial", type: "action", config: { actionType: "resolver_servicio_catalogo" } },
      {
        id: "q-seleccionar-servicio",
        type: "question",
        config: {
          text: "💅 Estos son nuestros servicios:\n\n{{catalogoTexto}}\n\n👉 Cuéntame cuál te interesa.",
          variableKey: "seleccionServicioTexto",
          required: true,
          validation: { kind: "text" },
        },
      },
      {
        id: "ai-interpretar-seleccion-servicio",
        type: "ai",
        config: {
          instruction:
            "La clienta respondió, en seleccionServicioTexto, a cuál de los servicios reales mostrados en catalogoTexto (numerados) se refiere. Si menciona una POSICIÓN ('la primera', 'el 3', '3️⃣'), devuelve 'seleccionTipo'='index' y 'seleccionIndice' = ese número (1-based). Si menciona el NOMBRE de un servicio, devuelve 'seleccionTipo'='nombre' y 'seleccionNombre' tal como aparece en la lista. Si es ambiguo o no calza con nada mostrado, NO inventes: devuelve solo 'seleccionTipo'='ambiguo'.",
          mode: "extract",
          outputVariables: ["seleccionTipo", "seleccionIndice", "seleccionNombre"],
        },
      },
      { id: "act-resolver-servicio-elegido", type: "action", config: { actionType: "resolver_servicio_catalogo" } },
      {
        id: "msg-seleccion-servicio-no-clara",
        type: "message",
        config: {
          text: "No logré identificarlo con certeza 😔 Estas son las opciones reales que tengo:\n\n{{catalogoTexto}}\n\n¿Cuál prefieres?",
          messageRole: "informational",
        },
      },

      // Precio/duración reales -- nunca inventados, siempre de dulabs_servicios.
      {
        id: "msg-precio-duracion",
        type: "message",
        config: {
          text: "¡Perfecto! 💕 El servicio de {{servicio}} tiene un valor de {{precioTexto}} y una duración aproximada de {{duracionTexto}}.",
          messageRole: "informational",
        },
      },

      {
        id: "q-desea-agendar",
        type: "question",
        // "agendar"/"reservar" quedan bloqueados por Claim Security en este
        // punto (ninguna cita existe todavía) -- verificado con
        // filterClaimSecuredEffects antes de fijar este texto.
        config: { text: "¿Te gustaría continuar con este servicio? 💗", variableKey: "deseaAgendarTexto", required: true, validation: { kind: "text" } },
      },
      {
        id: "ai-clasificar-desea-agendar",
        type: "ai",
        config: {
          instruction:
            "La clienta respondió, en deseaAgendarTexto, si quiere agendar una cita para el servicio que ya se le informó. Clasifica como 'si' SOLO ante un sí claro (ej. 'sí', 'dale', 'claro que sí'). Cualquier otra cosa -- un no, una duda, silencio sobre el tema -- clasifícala como 'no'. Ante la duda, SIEMPRE 'no'.",
          mode: "classify",
          classifications: ["si", "no"],
        },
      },
      {
        id: "msg-gracias-sin-agendar",
        type: "message",
        config: { text: "¡Perfecto! Aquí estamos si necesitas algo más 💕", messageRole: "informational" },
      },
      { id: "end-info-servicio", type: "end", config: {} },

      // --- Fecha + disponibilidad REAL (resolver existente, sin cambios) -
      {
        id: "q-fecha",
        type: "question",
        // "cita" queda bloqueada por Claim Security en este punto (ninguna
        // existe todavía) -- verificado con filterClaimSecuredEffects.
        config: {
          text: "¿Para qué fecha te gustaría este servicio? (por ejemplo: \"mañana\", \"el sábado\", \"20 de septiembre\")",
          variableKey: "fechaTexto",
          required: true,
          validation: { kind: "text" },
        },
      },
      {
        id: "ai-extraer-fecha",
        type: "ai",
        config: {
          instruction:
            "Lee la respuesta de la clienta en fechaTexto y conviértela a formato YYYY-MM-DD. Usa la variable 'hoy' (fecha real de hoy en Colombia) para resolver referencias relativas ('mañana', 'el sábado', 'el 20'). Nunca inventes una fecha si el texto no la menciona con claridad -- en ese caso omite 'fecha'.",
          mode: "extract",
          outputVariables: ["fecha"],
        },
      },
      { id: "act-validar-fecha", type: "action", config: { actionType: "validar_fecha_especialista" } },
      {
        id: "msg-fecha-invalida",
        type: "message",
        config: { text: "No logré identificar esa fecha 😔 ¿me la puedes decir de otra forma? (ej: \"mañana\", \"20 de septiembre\")", messageRole: "informational" },
      },

      { id: "act-consultar-disponibilidad", type: "action", config: { actionType: "consultar_disponibilidad_catalogo" } },
      {
        id: "cond-hay-disponibilidad",
        type: "condition",
        config: { rules: [{ field: "hayDisponibilidad", operator: "equals", value: "true" }], match: "all" },
      },
      {
        id: "msg-disponibilidad-real",
        type: "message",
        // disponibilidadTexto ya viene agrupado por profesional real y
        // elegible para ESTE servicio puntual (dulabs_servicio_especialista)
        // -- nunca se enumera nada acá, solo se interpola el texto real.
        config: { text: "Estos son los horarios reales disponibles:\n\n{{disponibilidadTexto}}", messageRole: "informational" },
      },
      {
        id: "msg-sin-cupo-ese-dia",
        type: "message",
        // Mismo texto real que ya devuelve consultarDisponibilidadCatalogoReal
        // cuando ningún especialista elegible tiene cupo -- se interpola tal
        // cual, sin inventar una alternativa.
        config: { text: "{{disponibilidadTexto}}", messageRole: "informational" },
      },
      {
        id: "msg-sin-especialistas",
        type: "message",
        config: { text: "En este momento no hay ninguna profesional habilitada para ese servicio 😔 En un momento nuestro equipo te ayuda directamente.", messageRole: "informational" },
      },

      // "Iniciar el proceso de reserva" (autorizado, alcance de esta fase):
      // el portal de reservas de AMORE (/reservar/amore) YA existe y es
      // real -- pero intenté enlazarlo directo desde este mensaje y
      // Claim Security (lib/flow/external-claim-security.ts, regex de
      // "reserv\w+|agend\w+|cita...") lo bloqueó de inmediato por
      // appointment.reserved sin evidencia verificada (prueba real:
      // "todos los mensajes estáticos pasan Claim Security", ver
      // amore-router.flow.test.ts). Revertido a propósito -- conectar el
      // enlace real requiere trabajar CON la lista de patrones "seguros"
      // de ese motor (isPropositionClearlySafe), no forzarlo con un texto
      // improvisado. Queda documentado como pendiente real, no arreglado.
      {
        id: "msg-camino-reserva",
        type: "message",
        // Verificado con filterClaimSecuredEffects antes de fijar este
        // texto, mismo criterio que solotalento.flow.ts.
        config: {
          text: "💗 Perfecto. En un momento nuestro equipo se pondrá en contacto contigo para continuar. ¡Gracias por escribirnos!",
          messageRole: "informational",
        },
      },
      { id: "act-transferir-reserva", type: "action", config: { actionType: "transferir_soporte", pauseDurationHours: 24 } },
      { id: "end-reserva-iniciada", type: "end", config: {} },
      { id: "end-sin-especialistas", type: "end", config: {} },
    ],
    edges: [
      { id: "e-start-clasificar", source: "start", target: "ai-clasificar-intencion" },

      { id: "e-clasificar-agendar", source: "ai-clasificar-intencion", target: "act-listar-catalogo", sourceHandle: FLOW_EDGE_HANDLE.aiClass("agendar") },
      { id: "e-clasificar-info", source: "ai-clasificar-intencion", target: "act-listar-catalogo", sourceHandle: FLOW_EDGE_HANDLE.aiClass("info_servicio") },
      { id: "e-clasificar-menu", source: "ai-clasificar-intencion", target: "q-bienvenida", sourceHandle: FLOW_EDGE_HANDLE.aiClass("menu") },
      { id: "e-clasificar-otro", source: "ai-clasificar-intencion", target: "q-bienvenida", sourceHandle: FLOW_EDGE_HANDLE.aiClass("otro") },
      { id: "e-clasificar-default", source: "ai-clasificar-intencion", target: "q-bienvenida", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },
      { id: "e-bienvenida-clasificar", source: "q-bienvenida", target: "ai-clasificar-intencion" },

      { id: "e-listar-catalogo-cond", source: "act-listar-catalogo", target: "cond-hay-catalogo", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-catalogo-vacio", source: "cond-hay-catalogo", target: "msg-catalogo-no-disponible", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-catalogo-vacio-handoff", source: "msg-catalogo-no-disponible", target: "act-handoff-sin-catalogo" },
      { id: "e-catalogo-vacio-end", source: "act-handoff-sin-catalogo", target: "end-sin-catalogo", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-catalogo-ok", source: "cond-hay-catalogo", target: "ai-extraer-servicio", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },

      { id: "e-extraer-a-resolver-inicial", source: "ai-extraer-servicio", target: "act-resolver-servicio-inicial", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-inicial-ok", source: "act-resolver-servicio-inicial", target: "msg-precio-duracion", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-inicial-fail", source: "act-resolver-servicio-inicial", target: "q-seleccionar-servicio", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },

      { id: "e-seleccionar-a-interpretar", source: "q-seleccionar-servicio", target: "ai-interpretar-seleccion-servicio" },
      { id: "e-interpretar-a-resolver", source: "ai-interpretar-seleccion-servicio", target: "act-resolver-servicio-elegido", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-elegido-ok", source: "act-resolver-servicio-elegido", target: "msg-precio-duracion", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-elegido-fail", source: "act-resolver-servicio-elegido", target: "msg-seleccion-servicio-no-clara", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-no-clara-reintentar", source: "msg-seleccion-servicio-no-clara", target: "q-seleccionar-servicio" },

      { id: "e-precio-a-desea", source: "msg-precio-duracion", target: "q-desea-agendar" },
      { id: "e-desea-a-clasificar", source: "q-desea-agendar", target: "ai-clasificar-desea-agendar" },
      { id: "e-desea-si", source: "ai-clasificar-desea-agendar", target: "q-fecha", sourceHandle: FLOW_EDGE_HANDLE.aiClass("si") },
      { id: "e-desea-no", source: "ai-clasificar-desea-agendar", target: "msg-gracias-sin-agendar", sourceHandle: FLOW_EDGE_HANDLE.aiClass("no") },
      { id: "e-desea-default", source: "ai-clasificar-desea-agendar", target: "msg-gracias-sin-agendar", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },
      { id: "e-gracias-end", source: "msg-gracias-sin-agendar", target: "end-info-servicio" },

      { id: "e-fecha-a-extraer", source: "q-fecha", target: "ai-extraer-fecha" },
      { id: "e-extraer-fecha-a-validar", source: "ai-extraer-fecha", target: "act-validar-fecha", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-validar-fecha-ok", source: "act-validar-fecha", target: "act-consultar-disponibilidad", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-validar-fecha-fail", source: "act-validar-fecha", target: "msg-fecha-invalida", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-fecha-invalida-reintentar", source: "msg-fecha-invalida", target: "q-fecha" },

      { id: "e-disponibilidad-cond", source: "act-consultar-disponibilidad", target: "cond-hay-disponibilidad", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-disponibilidad-fail", source: "act-consultar-disponibilidad", target: "msg-sin-especialistas", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-sin-especialistas-end", source: "msg-sin-especialistas", target: "end-sin-especialistas" },

      { id: "e-hay-disponibilidad", source: "cond-hay-disponibilidad", target: "msg-disponibilidad-real", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-sin-disponibilidad", source: "cond-hay-disponibilidad", target: "msg-sin-cupo-ese-dia", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-sin-cupo-reintentar", source: "msg-sin-cupo-ese-dia", target: "q-fecha" },

      { id: "e-disponibilidad-a-reserva", source: "msg-disponibilidad-real", target: "msg-camino-reserva" },
      { id: "e-reserva-a-transferir", source: "msg-camino-reserva", target: "act-transferir-reserva" },
      { id: "e-reserva-end", source: "act-transferir-reserva", target: "end-reserva-iniciada", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
    ],
    variables: [
      { key: "servicio", label: "Servicio", type: "string" },
      { key: "servicioId", label: "ID del servicio real", type: "string" },
      { key: "fecha", label: "Fecha validada", type: "string" },
      { key: "cantidadCatalogo", label: "Cantidad de servicios en el catálogo real", type: "number" },
      { key: "hayDisponibilidad", label: "Si algún especialista elegible tiene cupo real ese día", type: "string" },
    ],
  };
}
