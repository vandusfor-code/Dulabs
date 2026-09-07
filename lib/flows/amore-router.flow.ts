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
 * NUNCA usa agendar_cita_especialista/agendar_cita_marketplace (acciones de
 * OTROS tenants) -- el escenario reservado de intención de reserva "directa
 * al portal" (código CODIGO_ESCENARIO_PORTAL) sigue existiendo tal cual para
 * cuando el agendamiento conversacional no aplica.
 *
 * FASE 1 -- Agendamiento conversacional (autorizado). resolver_escenario
 * puede devolver modo="agendar_buscar_disponibilidad"/"agendar_crear_cita"
 * (ver lib/bot-escenarios/tipos.ts) cuando decidirSiguientePasoAgendamiento
 * ya validó datos reales -- dos ramas NUEVAS y aditivas, insertadas ANTES
 * de la rama modo="ai" ya existente, ejecutan la acción real de Nylas
 * correspondiente (buscar_disponibilidad_nylas/crear_cita_nylas, wrappers
 * finos sobre lib/disponibilidad-servicio-nylas.ts/lib/reserva-servicio-nylas.ts,
 * sin cambios) y REUTILIZAN el mismo nodo "ai-generar-respuesta" para
 * redactar el resultado -- nunca un segundo nodo IA. Para cualquier otro
 * modo, el comportamiento y el grafo son EXACTAMENTE los mismos de antes de
 * esta fase.
 */
export function amoreRouterFlow(): FlowDefinition {
  return {
    name: "AMORE — Asistente conversacional (Fase 3, banco de escenarios)",
    description:
      "Responde con el banco de escenarios/FAQ/información real de AMORE (dulabs_bot_escenarios), 100% determinístico salvo cuando el escenario ganador requiere IA (recomendaciones), y agenda citas reales por el mismo chat (FASE 1, vía Nylas) cuando la clienta lo pide conversacionalmente.",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },

      { id: "act-resolver-escenario", type: "action", config: { actionType: "resolver_escenario" } },

      // FASE 1 -- Agendamiento conversacional (autorizado). Estas dos ramas
      // se evalúan ANTES que cond-es-ai a propósito: son más específicas
      // (piden una acción real de Nylas antes de redactar), mientras que
      // modo="ai" es el caso general de siempre.
      {
        id: "cond-es-agendar-disponibilidad",
        type: "condition",
        config: { rules: [{ field: "modo", operator: "equals", value: "agendar_buscar_disponibilidad" }], match: "all" },
      },
      { id: "act-buscar-disponibilidad-nylas", type: "action", config: { actionType: "buscar_disponibilidad_nylas" } },

      {
        id: "cond-es-agendar-crear-cita",
        type: "condition",
        config: { rules: [{ field: "modo", operator: "equals", value: "agendar_crear_cita" }], match: "all" },
      },
      { id: "act-crear-cita-nylas", type: "action", config: { actionType: "crear_cita_nylas" } },
      // Revisión (autorizada) -- rama de fallo REAL (a diferencia del
      // diseño original): un rechazo real (horario ocupado, error técnico,
      // inconsistencia) devuelve success:false (ver internal-action-executor.ts
      // -- necesario para que Claim Security nunca otorgue "appointment.reserved"
      // en un rechazo). Mismo patrón EXACTO que
      // daniela-agendar-cita.flow.ts (act-agendar --aiFailure--> msg-ocupado
      // --> act-relistar-horarios): mensaje estático (nunca depende de datos
      // de ESE turno, que no sobreviven por la rama de fallo) + re-consulta
      // de disponibilidad real inmediata, para no dejar a la clienta en un
      // punto muerto. Redacción deliberadamente neutra (sin "cita"/"horario"/
      // "reserva"/"disponible") -- Claim Security corre SIEMPRE para
      // contenido estático (detectDomainCapabilities), aunque sea
      // informational; msg-ocupado de Daniela nunca se probó contra ese
      // chequeo exacto (ver amore-router.flow.test.ts, único de este flow).
      {
        id: "msg-reserva-no-completada",
        type: "message",
        config: {
          text: "Uy 😔 justo se complicó algo de mi lado. Dame un segundo, reviso qué opciones tienes.",
          messageRole: "informational",
        },
      },

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
            "Eres la asesora virtual de AMORE: cercana, cálida, femenina, natural, amable, segura, conocedora, conversacional, empática, elegante y profesional -- " +
            "nunca un menú, nunca un robot, nunca un call center, nunca un asistente técnico, nunca 'IA corporativa'. Quiero que se sienta como una asesora real del salón atendiendo por WhatsApp. " +
            "Nunca menciones que eres una IA, ni palabras como 'base de datos', 'sistema', 'backend', 'contexto', 'knowledge base', 'información verificada' o 'datos disponibles'. " +
            "Evita también sonar como página web/FAQ: nunca digas 'actualmente cuento con', 'según la información disponible', 'con base en los datos' o 'nuestro sistema indica'. " +
            "\n\n=== CONTINUIDAD: NO eres un formulario pregunta-respuesta, eres UNA conversación ===\n" +
            "'esPrimerTurno' te dice si este es el PRIMER mensaje de la conversación (true) o si ya viene en curso (false). " +
            "Si esPrimerTurno es false, la clienta YA fue saludada -- NUNCA vuelvas a decir '¡Hola!', 'Qué gusto saludarte' ni ninguna variante de saludo inicial; responde directo, como si continuaras la misma charla. " +
            "Solo saluda así cuando esPrimerTurno sea true. " +
            "Usa 'ultimoServicioId'/'ultimoServicioNombre'/'ultimaCategoria'/'ultimasOpcionesIds' (mismo contexto que ya trae el motor) para no repetir explicaciones que ya diste -- si ya explicaste qué es un servicio y ahora solo preguntan el precio, responde SOLO el precio, no repitas la explicación completa. " +
            "\n\n=== NOMBRE DE LA CLIENTA: con naturalidad, nunca mecánico (revisión, autorizada) ===\n" +
            "'nombreClienteConocido' viene con el nombre real ya registrado de la clienta SOLO en el primer turno (vacío si es nueva o no lo tienes) -- nunca lo inventes ni lo infieras de otro lado. " +
            "Úsalo en el saludo inicial cuando esPrimerTurno sea true y tengas el nombre -- ej. \"Hola, Mariana, qué lindo volver a tenerte por aquí 💗 ¿En qué te puedo ayudar hoy?\" -- pero NUNCA lo repitas en los turnos siguientes de la misma conversación: \"Claro 💗 Tenemos estas opciones...\" está bien, \"Claro, Mariana...\" no. " +
            "No empieces cada respuesta con su nombre ni lo uses como muletilla -- se siente mecánico, no humano. " +
            "\n\n=== ESTILO: variar, nunca sonar a plantilla ===\n" +
            "No repitas mecánicamente las mismas muletillas en cada respuesta ('¡Hola!', '¡Claro que sí!', 'Con todo el gusto', 'Qué gusto saludarte', 'Perfecto', 'Excelente', o cerrar siempre con '¿te gustaría saber algo más?'/'¿en qué más te ayudo?'). Pueden aparecer de vez en cuando, nunca como fórmula fija. " +
            "'Amiga' está bien para dar cercanía, pero con moderación -- no en cada mensaje. " +
            "Responde PRIMERO lo que la clienta preguntó concretamente, antes de preguntar nada tú. Si necesitas preguntar algo, UNA sola pregunta a la vez -- nunca un interrogatorio de varias preguntas seguidas. " +
            "No agregues una pregunta de cierre si la conversación fluye bien sin ella. " +
            "\n\n=== DATOS: dos fuentes, nunca mezcladas ===\n" +
            "'datosIA' son hechos CONFIRMADOS de AMORE (nombre, precioTexto, duracionTexto, categoria de servicios REALES) -- son verdad, siempre puedes afirmarlos tal cual. " +
            "'conocimientoGeneral' es explicación profesional general (queEs/paraQueSirve/limites) de esos mismos servicios, cada entrada con su 'fuente': " +
            "'confirmado_amore' (protocolo propio de AMORE, puedes afirmarlo como tal), " +
            "'conocimiento_general' (explicación profesional general del tipo de servicio -- NUNCA lo presentes como un protocolo específico o exclusivo de AMORE, aunque sí puedes usarlo para explicar/comparar/orientar), " +
            "'no_confirmado' (no hay ficha -- no inventes una explicación; dilo con naturalidad y variando la forma, nunca con la misma frase fija, sin sonar técnica -- ej. 'sobre ese detalle no tengo algo confirmado de AMORE, así que prefiero no inventarte nada 💗', pero nunca la repitas igual cada vez). " +
            "Respeta siempre lo que 'limites' de cada ficha te prohíbe afirmar. " +
            "Los únicos servicios que existen son los de 'datosIA' -- nunca inventes un servicio, precio, duración, profesional, horario, dirección, promoción, producto, marca o protocolo que no esté ahí. " +
            "'instruccionIA' te dice qué hacer en este momento puntual (ej. explicar un servicio, comparar dos, recomendar por presupuesto/ocasión, orientar a alguien indecisa). " +
            "\n\n=== LARGO Y FORMATO ===\n" +
            "Responde de forma breve y natural, nunca listes más de 2-3 opciones de una vez salvo que te pidan explícitamente ver todas, nunca en viñetas de catálogo completo, nunca como ficha técnica. " +
            "Si tu respuesta tiene más de una idea separable (por ejemplo: una frase breve de apertura + una lista corta + una pregunta de cierre), separa esas ideas con una línea en blanco entre cada una -- un mecanismo aparte decide cuántos mensajes reales de WhatsApp enviar según esos bloques, tú no decides eso. Si tu respuesta es una sola idea corta, no uses líneas en blanco. " +
            "\n\n=== AGENDAMIENTO REAL (FASE 1) ===\n" +
            "AMORE ya puede agendar citas reales por este mismo chat, no solo por el portal. 'instruccionIA' te dirá exactamente qué hacer en cada paso del agendamiento (pedir un dato, presentar horarios reales, pedir confirmación, confirmar una reserva ya creada, o explicar que algo falló) -- síguelo al pie de la letra, con la misma calidez y naturalidad de siempre, UNA sola pregunta a la vez. " +
            "Cuando te den horarios/profesionales reales en 'datosIA', preséntalos tal cual -- nunca inventes ni ofrezcas una hora, profesional, servicio o día que no esté ahí. " +
            "NUNCA digas que una hora está disponible, que una profesional está libre, o que la cita quedó reservada/confirmada, salvo que 'instruccionIA' de ESE turno puntual te lo pida explícitamente (eso solo ocurre justo después de que el sistema ya la creó de verdad, nunca antes). " +
            "Si la clienta ya eligió un horario, pide su confirmación explícita antes de dar nada por reservado -- una respuesta ambigua ('creo que sí', 'me gusta') nunca cuenta como confirmación. " +
            "Si un intento de reservar falla (el horario se ocupó justo antes, o hubo un error técnico), explícalo con calidez y sin tecnicismos, sin decir en ningún momento que la cita quedó confirmada.",
        },
      },
      {
        id: "q-turno-ia",
        type: "question",
        config: { text: "{{responseText}}", variableKey: "mensajeActual", required: false, validation: { kind: "text" } },
      },
      // Diagnóstico forense (autorizado, incidente AMORE 2026-09-06 18:43) --
      // ai-generar-respuesta NO tenía ninguna rama aiFailure: un rechazo de
      // Claim Security (ej. Gemini afirmando una reserva sin evidencia, ver
      // buscarDisponibilidadNylasAction) terminaba en engineError SIN enviar
      // ningún mensaje. Como el canal WhatsApp-QR de AMORE no tiene ningún
      // LEGACY al que ceder el turno (ver ejecutarBotWhatsAppQR), eso hacía
      // que se cerrara la ejecución y se reintentara el mismo mensaje con un
      // "start" limpio -- perdiendo agendamiento/servicio/fecha/datosIA por
      // completo. Mismo patrón EXACTO que act-crear-cita-nylas --aiFailure-->
      // msg-reserva-no-completada: mensaje estático, honesto, deliberadamente
      // neutro (sin "cita"/"reservad"/"confirmad"/"agendad", ver
      // amore-router.flow.test.ts que corre Claim Security real sobre todo
      // texto estático del grafo), que espera el siguiente mensaje real y
      // vuelve a act-resolver-escenario SIN tocar ninguna variable -- el
      // turno SIEMPRE termina enviando algo, así que ejecutarBotWhatsAppQR
      // nunca ve "no se envió nada" y nunca reintenta con una ejecución nueva.
      {
        id: "q-ia-fallback",
        type: "question",
        config: {
          text: "Uy 😔 se me complicó un poco por acá. ¿Me lo puedes repetir, por favor?",
          variableKey: "mensajeActual",
          required: false,
          validation: { kind: "text" },
        },
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
      // FASE 1 -- Agendamiento conversacional (autorizado). El resultado de
      // resolver_escenario ahora entra PRIMERO a las dos condiciones nuevas
      // (más específicas); si ninguna aplica, sigue exactamente el mismo
      // camino de siempre hacia cond-es-ai.
      { id: "e-resolver-cond-agendar-disp", source: "act-resolver-escenario", target: "cond-es-agendar-disponibilidad", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-cond-agendar-disp-si", source: "cond-es-agendar-disponibilidad", target: "act-buscar-disponibilidad-nylas", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-cond-agendar-disp-no", source: "cond-es-agendar-disponibilidad", target: "cond-es-agendar-crear-cita", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-buscar-disp-a-ia", source: "act-buscar-disponibilidad-nylas", target: "ai-generar-respuesta", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-cond-agendar-crear-si", source: "cond-es-agendar-crear-cita", target: "act-crear-cita-nylas", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-cond-agendar-crear-no", source: "cond-es-agendar-crear-cita", target: "cond-es-ai", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-crear-cita-a-ia", source: "act-crear-cita-nylas", target: "ai-generar-respuesta", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      // Revisión (autorizada) -- rama de fallo real, ver comentario del nodo
      // msg-reserva-no-completada arriba.
      { id: "e-crear-cita-fail", source: "act-crear-cita-nylas", target: "msg-reserva-no-completada", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-reserva-fallo-relistar", source: "msg-reserva-no-completada", target: "act-buscar-disponibilidad-nylas" },

      { id: "e-cond-ai-si", source: "cond-es-ai", target: "ai-generar-respuesta", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-cond-ai-no", source: "cond-es-ai", target: "cond-es-transfer", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },

      { id: "e-cond-transfer-si", source: "cond-es-transfer", target: "msg-antes-transferir", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-cond-transfer-no", source: "cond-es-transfer", target: "q-turno-directo", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },

      { id: "e-ia-a-turno", source: "ai-generar-respuesta", target: "q-turno-ia", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      // Diagnóstico forense (autorizado) -- ver comentario del nodo q-ia-fallback arriba.
      { id: "e-ia-fail", source: "ai-generar-respuesta", target: "q-ia-fallback", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-ia-fallback-loop", source: "q-ia-fallback", target: "act-resolver-escenario" },
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
      { key: "esPrimerTurno", label: "true solo en el primer mensaje de la conversación -- evita que el nodo IA vuelva a saludar en turnos posteriores", type: "boolean" },
      {
        key: "nombreClienteConocido",
        label:
          "Revisión (autorizada) -- nombre real ya registrado de la clienta (dulabs_clientes_conocidos), presente SOLO en el primer turno; vacío si es nueva o desconocida. Nunca inventar/inferir un nombre distinto.",
        type: "string",
      },
      { key: "instruccionIA", label: "Instrucción acotada del escenario para el nodo IA", type: "string" },
      { key: "ultimoServicioId", label: "Último servicio real mencionado (contexto)", type: "string" },
      { key: "ultimaCategoria", label: "Última categoría real mencionada (contexto)", type: "string" },
      {
        key: "agendamiento",
        label:
          "FASE 1 -- acumulador completo del agendamiento conversacional en curso (servicio/fecha/hora/profesional/selección/confirmación), objeto anidado, ver AgendamientoEnCurso",
        type: "string",
      },
    ],
  };
}
