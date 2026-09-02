import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { FlowDefinition } from "@/lib/flow/types";
import { DANIELA_BUTTON_IDS } from "@/lib/flows/daniela-button-ids";
import { MENSAJE_TRANSFERENCIA_PESTANAS } from "@/lib/flow-pestanas-hatch";

/** Mensaje estático post-confirmación (sin Claude) tras act-agendar exitoso. */
export const DANIELA_MSG_RECORDATORIO_ASISTENCIA =
  "📌 Importante: recuerda confirmar tu asistencia 1 hora antes de tu cita. De no hacerlo, la cita será cancelada automáticamente.";

/**
 * Fase 0 (migración Daniela → Flow) — DISEÑO, no activado. Ver
 * DANIELA_PROMPT_A_FLOW.md para el histórico completo hasta Fase 3.
 *
 * REDISEÑO DE AGENDAMIENTO (autorizado, sept. 2026) — cambia el modelo
 * central de "pedir servicio/fecha/HORA puntual y comprobar sí/no" a
 * "pedir servicio/fecha, consultar disponibilidad REAL y mostrar los
 * horarios que de verdad existen para que la clienta elija uno". Motivado
 * por la auditoría técnica previa (informe "AUDITORÍA BOT DANIELA"), que
 * encontró dos huecos reales:
 *
 *   1. No existía ningún parser determinista de fecha -- "el sábado" podía
 *      llegar como texto crudo hasta ventanaAtencion()/hayHuecoLibreEseDia()
 *      y producir "sin disponibilidad" en vez de "no entendí la fecha".
 *      Ahora `act-validar-fecha` (parse-fecha-colombia.ts, mismo criterio
 *      que ya usa parseHoraColombia para horas) es OBLIGATORIO antes de
 *      consultar cualquier disponibilidad.
 *   2. `consultarDisponibilidadEspecialista` solo confirmaba "hay ALGÚN
 *      hueco ese día", nunca la hora exacta pedida -- la propuesta que se
 *      le mostraba a la clienta interpolaba su hora pedida SIN haberla
 *      verificado de verdad. Ahora `act-listar-horarios` (nueva función,
 *      lib/especialistas-flow-adaptador.ts::listarHorariosDisponiblesEspecialista,
 *      MISMAS reglas de negocio que ya usaba agendarCitaEspecialista, sin
 *      duplicarlas) devuelve la lista REAL de horarios libres, y
 *      `act-resolver-seleccion-horario` es la ÚNICA función que decide qué
 *      hora quedó seleccionada -- SIEMPRE comparando contra esa lista real,
 *      nunca aceptando un horario que la IA pueda inventar.
 *
 * La IA (ai-interpretar-seleccion) SOLO interpreta lenguaje natural ("la
 * segunda", "la de las 4", "esa") en un candidato estructurado
 * (índice 1-based o una hora HH:MM); el candidato que no exista en la
 * lista real se rechaza siempre, sin excepción.
 *
 * Todo lo demás de las Fases 1-3 (barrera de confirmación explícita,
 * act-agendar directo sin nodo AI intermedio, red de seguridad de
 * ai-confirmar con respaldo estático, act-validar-servicio antes de pedir
 * fecha) se conserva EXACTAMENTE igual -- ver comentarios inline.
 *
 * NUEVO (Parte 13 del pedido) — antes de recolectar nada, se consulta si
 * la clienta YA tiene una cita activa; si la tiene, se le informa con
 * datos reales y se le pregunta explícitamente si quiere agendar una
 * ADICIONAL (nunca se bloquea ni se asume en automático).
 */
export function danielaAgendarCitaFlow(): FlowDefinition {
  return {
    name: "Daniela — Agendar cita (rediseño de agendamiento, autorizado)",
    description:
      "Servicio → fecha → disponibilidad REAL → horarios REALES → selección → confirmación explícita → creación real, sobre dulabs_especialistas / dulabs_citas_especialista vía el adaptador. NO activado para ningún tenant.",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },

      // --- Parte 13 (autorizado) — cita(s) activa(s) existente(s) --------
      {
        id: "act-consultar-citas-previas",
        type: "action",
        config: { actionType: "consultar_citas_activas_especialista" },
      },
      {
        id: "cond-tiene-citas-previas",
        type: "condition",
        config: { rules: [{ field: "cantidadCitas", operator: "greater_than", value: 0 }], match: "all" },
      },
      {
        id: "ai-informar-cita-existente",
        type: "ai",
        config: {
          instruction:
            "La clienta ya tiene al menos una cita activa real, en la variable citasActivas (servicio, fecha y hora reales). Cuéntale con naturalidad y calidez cuál es (o cuáles, si hay más de una) -- nunca inventes ni redondees el dato. Todavía NO le preguntes si quiere agendar otra, eso lo hace la siguiente pregunta.",
          mode: "respond",
        },
      },
      {
        id: "q-agendar-adicional",
        type: "buttons",
        config: {
          text: "¿Deseas agendar una cita adicional?",
          variableKey: "respuestaAdicionalTexto",
          buttons: [
            { id: DANIELA_BUTTON_IDS.AGENDAR_ADICIONAL, label: "Sí, quiero otra" },
            { id: DANIELA_BUTTON_IDS.NO_AGENDAR_ADICIONAL, label: "No, gracias" },
          ],
        },
      },
      {
        id: "ai-clasificar-adicional",
        type: "ai",
        config: {
          instruction:
            "La clienta respondió, en respuestaAdicionalTexto, si quiere agendar una cita ADICIONAL a la que ya tiene. Clasifica como 'quiere_adicional' SOLO si es un sí claro (ej. 'sí', 'sí quiero otra', 'dale') o si el valor es exactamente 'agendar_adicional'. Cualquier otra cosa -- un no, una duda, 'no_agendar_adicional', o cualquier respuesta que no sea un sí claro -- clasifícala como 'no_quiere'. Ante la duda, SIEMPRE 'no_quiere'.",
          mode: "classify",
          classifications: ["quiere_adicional", "no_quiere"],
        },
      },
      {
        id: "msg-mantiene-cita-existente",
        type: "message",
        config: { text: "Perfecto, entonces dejo tu cita como está 💛 Aquí estoy si necesitas algo más.", messageRole: "informational" },
      },

      // Fase 3 (Bug raíz #4, slot-filling) — extrae del PRIMER mensaje de la
      // clienta (userMessage = __firstMessageText, ver Fix B) lo que ya haya
      // dicho: servicio, fecha, hora, nombre. Resuelve referencias relativas
      // ("el viernes") usando la variable 'hoy' (sembrada por el orchestrator
      // al crear la ejecución). Solo escribe una variable si está claramente
      // presente; si no, la omite y la pregunta correspondiente se hará. La
      // disponibilidad NUNCA se infiere acá -- eso lo decide act-listar-horarios.
      // outputVariables limita EXACTAMENTE qué puede escribir el modelo.
      //
      // REDISEÑO -- sin cambios en este nodo: sigue extrayendo 'hora' como
      // antes, pero ahora ese valor es SOLO un HINT para el camino rápido
      // (Parte 12) -- NUNCA se acepta directo, act-resolver-seleccion-horario
      // lo revalida SIEMPRE contra la lista real de horarios antes de
      // usarlo para nada.
      {
        id: "ai-extraer",
        type: "ai",
        config: {
          instruction:
            "Lee el mensaje de la clienta (contenido del usuario) y extrae SOLO los datos que estén claramente presentes para agendar una cita. Devuelve un objeto con las claves que apliquen: " +
            "'servicio' (el servicio que menciona, ej. 'semipermanente', 'pestañas', 'manos'; NO lo inventes ni normalices a un catálogo; NUNCA uses servicio para días de la semana, fechas, horas ni nombres de persona — si el mensaje solo dice cuándo, ej. 'sábado', 'el viernes', 'mañana', OMITE servicio), " +
            "'fecha' (en formato YYYY-MM-DD; si la clienta usa una referencia relativa como 'el viernes', 'mañana', 'el 2', resuélvela usando la variable 'hoy' que contiene la fecha de hoy en Colombia; si no da ninguna fecha, OMITE esta clave), " +
            "'hora' (en formato HH:MM de 24h; ej. '5:00 PM' -> '17:00'; si no da hora, OMITE esta clave -- esto es solo un HINT, se revalida siempre contra la disponibilidad real, nunca se acepta directo), " +
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
      // (cond-servicio se eliminó -- cierre final Daniela, autorizado: el
      // catálogo real siempre se consulta primero, ver act-listar-servicios;
      // el hint 'servicio' del primer mensaje lo consume directamente
      // act-resolver-seleccion-inicial-servicio, sin necesitar este gate.)
      // Cierre final Daniela (autorizado, sept. 2026) — REEMPLAZA la
      // categoría por botones (Manos/Pies/Pestañas) por el catálogo REAL y
      // completo de servicios, leído de base_conocimiento (nunca
      // hardcodeado -- ver parseServiciosDesdeBaseConocimiento). Pestañas
      // queda fuera de este catálogo a propósito: nunca se ofrece como
      // autoservicio, se transfiere siempre de inmediato (ver
      // lib/flow-pestanas-hatch.ts, interceptado ANTES de llegar acá,
      // incluso en el primer mensaje).
      {
        id: "act-listar-servicios",
        type: "action",
        config: { actionType: "listar_servicios_especialista" },
      },
      {
        id: "cond-hay-servicios",
        type: "condition",
        config: { rules: [{ field: "cantidadServicios", operator: "greater_than", value: 0 }], match: "all" },
      },
      // Caso límite defensivo (no se espera en producción real -- Daniela
      // siempre tiene base_conocimiento configurado): si por alguna razón
      // el catálogo real viene vacío, nunca se inventa nada, se transfiere.
      {
        id: "msg-catalogo-no-disponible",
        type: "message",
        config: {
          text: "En este momento no tengo el listado de servicios a la mano 😔 Te paso con Dani para que te ayude directamente.",
          messageRole: "informational",
        },
      },
      // Camino rápido: si el primer mensaje ya nombró un servicio real
      // ("quiero un dipping"), se intenta resolverlo por NOMBRE exacto
      // contra el catálogo real antes de mostrar la lista -- si no calza
      // exacto (o es ambiguo, ej. "semipermanente" sin decir manos/pies),
      // cae a mostrar el catálogo y preguntar, nunca un error visible.
      {
        id: "act-resolver-seleccion-inicial-servicio",
        type: "action",
        config: { actionType: "resolver_seleccion_servicio" },
      },
      {
        id: "q-seleccionar-servicio",
        type: "question",
        config: {
          text: "💅 Catálogo de servicios\nSelecciona el de tu interés:\n\n{{serviciosDisponiblesTexto}}",
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
            "La clienta respondió, en seleccionServicioTexto, a cuál de los servicios reales mostrados prefiere (los servicios reales están en serviciosDisponiblesTexto, numerados). Interpreta su respuesta y devuelve SOLO uno de estos dos formatos, nunca ambos: " +
            "si se refiere a una POSICIÓN de la lista (ej. 'la primera', 'la segunda', 'la cuarta', 'el 4', '4️⃣', solo el número '4'), devuelve 'seleccionTipo'='index' y 'seleccionIndice' = el número de esa posición empezando en 1. " +
            "Si en cambio menciona el NOMBRE de un servicio (ej. 'Dipping', 'semipermanente en manos', 'acrílicas'), devuelve 'seleccionTipo'='nombre' y 'seleccionNombre' con el nombre tal como aparece en la lista mostrada. " +
            "Si su respuesta es ambigua y no puedes identificar con certeza a cuál se refiere (ej. 'semipermanente' sin decir si es en manos o en pies, cuando la lista tiene las dos por separado, o no calza con nada mostrado), NO inventes: omite seleccionIndice y seleccionNombre, y devuelve solo 'seleccionTipo'='ambiguo'. NUNCA inventes un servicio que no esté entre los mostrados.",
          mode: "extract",
          outputVariables: ["seleccionTipo", "seleccionIndice", "seleccionNombre"],
        },
      },
      {
        id: "act-resolver-seleccion-servicio",
        type: "action",
        config: { actionType: "resolver_seleccion_servicio" },
      },
      {
        id: "msg-seleccion-servicio-no-clara",
        type: "message",
        config: {
          // Mismo criterio que msg-seleccion-no-clara (horarios):
          // resolver_seleccion_servicio no otorga ninguna capability en su
          // rama de fallo, así que este texto evita palabras que exigirían
          // evidencia verificada.
          text: "No logré identificarlo con certeza 😔 Estas son las opciones reales que tengo:\n\n{{serviciosDisponiblesTexto}}\n\n¿Cuál prefieres?",
          messageRole: "informational",
        },
      },
      // Precio real (del catálogo, nunca inventado) + transición inmediata
      // a la pregunta de fecha (cond-fecha, sin cambios).
      {
        id: "msg-precio-servicio",
        type: "message",
        config: {
          text: "¡Perfecto! 💕 El servicio de {{servicio}} tiene un valor de {{precioTexto}}.",
          messageRole: "informational",
        },
      },
      // Pestañas nunca se agenda por autoservicio (Nicol confirma ella
      // misma, cita previa) -- si el servicio resuelto es "Pestañas",
      // transfiere de inmediato en vez de mostrar precio/pedir fecha. Mismo
      // texto/acción exacta que ya usa la transferencia determinista de
      // texto libre (lib/flow-pestanas-hatch.ts), para que sea idéntica sin
      // importar por cuál de los dos caminos se llegue a "Pestañas".
      {
        id: "cond-servicio-pestanas",
        type: "condition",
        config: { rules: [{ field: "servicio", operator: "equals", value: "Pestañas" }], match: "all" },
      },
      {
        id: "msg-pestanas-transferencia",
        type: "message",
        config: { text: MENSAJE_TRANSFERENCIA_PESTANAS, messageRole: "informational" },
      },
      {
        id: "act-handoff-pestanas",
        type: "action",
        config: { actionType: "transferir_soporte", pauseDurationHours: 24 },
      },
      { id: "end-pestanas-transferido", type: "end", config: {} },
      {
        id: "cond-fecha",
        type: "condition",
        config: { rules: [{ field: "fecha", operator: "exists" }], match: "all" },
      },
      {
        id: "q-fecha",
        type: "question",
        config: { text: "¿Qué día te gustaría tu cita? 📅 (por ejemplo: \"el sábado\", \"mañana\" o \"4 de septiembre\")", variableKey: "fecha", required: true, validation: { kind: "text" } },
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

      // Ya no hace falta act-validar-servicio: el servicio resuelto acá
      // SIEMPRE viene del catálogo real (act-resolver-seleccion-inicial-
      // servicio / act-resolver-seleccion-servicio), nunca de texto libre
      // sin validar -- la validación queda incluida por construcción.
      // msg-servicio-no-reconocido se conserva (reutilizado por
      // act-listar-horarios/act-relistar-horarios si el servicio real
      // resuelto no tiene categoría manos/pies reconocible, ej. un
      // servicio exclusivo de otra especialista).
      {
        id: "msg-servicio-no-reconocido",
        type: "message",
        config: {
          text: "Ese servicio no lo manejamos por acá 😔 ¿quieres intentar con otro (manos, pies o pestañas)?",
          messageRole: "informational",
        },
      },

      // --- REDISEÑO (autorizado) — validación determinista de fecha ------
      // Nunca deja pasar texto libre ("el sábado") hacia la lógica de
      // disponibilidad -- ver parse-fecha-colombia.ts. Éxito SOBREESCRIBE
      // variables.fecha con la fecha real normalizada (YYYY-MM-DD).
      {
        id: "act-validar-fecha",
        type: "action",
        config: { actionType: "validar_fecha_especialista" },
      },
      {
        id: "msg-fecha-invalida",
        type: "message",
        config: {
          // Nunca dice "cita"/"horario"/"disponible" -- ver
          // external-claim-security.ts::detectExternalClaimsInText: esas
          // palabras se tratan como afirmación externa que exige evidencia
          // verificada, y este mensaje se dispara justo cuando act-validar-fecha
          // FALLÓ (sin evidencia ninguna). Mismo criterio de redacción que
          // ya usan msg-servicio-no-reconocido/msg-sin-disponibilidad
          // originales en este mismo archivo.
          text: "No logré identificar bien esa fecha 😅 ¿Me la puedes decir de otra forma? (por ejemplo: \"el sábado\", \"mañana\" o \"4 de septiembre\")",
          messageRole: "informational",
        },
      },

      // --- REDISEÑO (autorizado) — lista REAL de horarios disponibles ----
      {
        id: "act-listar-horarios",
        type: "action",
        config: { actionType: "listar_horarios_disponibles_especialista" },
      },
      {
        id: "cond-hay-horarios",
        type: "condition",
        config: { rules: [{ field: "cantidadHorarios", operator: "greater_than", value: 0 }], match: "all" },
      },
      {
        id: "msg-sin-disponibilidad",
        type: "message",
        config: {
          text: "Justo ese día no tengo espacio disponible para ese servicio 😔 ¿Probamos con otra fecha?",
          messageRole: "informational",
        },
      },

      // Camino rápido (Parte 12): si la clienta ya dio una hora en el
      // primer mensaje, se intenta resolverla contra la lista REAL antes de
      // preguntar de nuevo -- si no calza exacto con ningún horario real,
      // esto simplemente falla y cae a la pregunta abierta normal (nunca un
      // error visible, nunca se inventa nada).
      {
        id: "act-resolver-seleccion-inicial",
        type: "action",
        config: { actionType: "resolver_seleccion_horario" },
      },

      // Pregunta abierta: muestra la lista REAL (texto ya formateado,
      // determinista, nunca redactado por IA) y deja que la clienta elija
      // en lenguaje natural.
      {
        id: "q-seleccionar-horario",
        type: "question",
        config: {
          text: "💚 Encontré estos horarios disponibles:\n\n{{horariosDisponiblesTexto}}\n\n¿Cuál te queda mejor?",
          variableKey: "seleccionHorarioTexto",
          required: true,
          validation: { kind: "text" },
        },
      },
      {
        id: "ai-interpretar-seleccion",
        type: "ai",
        config: {
          instruction:
            "La clienta respondió, en seleccionHorarioTexto, a cuál de los horarios reales mostrados prefiere (los horarios reales están en horariosDisponiblesTexto, numerados). Interpreta su respuesta y devuelve SOLO uno de estos dos formatos, nunca ambos: " +
            "si se refiere a una POSICIÓN de la lista (ej. 'la primera', 'la segunda', 'la última', 'la de en medio', 'el 2'), devuelve 'seleccionTipo'='index' y 'seleccionIndice' = el número de esa posición empezando en 1 (la última = el número total de horarios que se le mostraron). " +
            "Si en cambio menciona una HORA concreta (ej. '4 de la tarde', 'a las 4', '16:00', 'la de las 5'), devuelve 'seleccionTipo'='time' y 'seleccionHora' en formato HH:MM 24h. " +
            "Si su respuesta es ambigua y no puedes identificar con certeza a cuál se refiere (ej. 'esa' sin contexto claro, o no calza con nada mostrado), NO inventes: omite seleccionIndice y seleccionHora, y devuelve solo 'seleccionTipo'='ambiguo'. NUNCA inventes un horario que no esté entre los mostrados.",
          mode: "extract",
          outputVariables: ["seleccionTipo", "seleccionIndice", "seleccionHora"],
        },
      },
      {
        id: "act-resolver-seleccion-horario",
        type: "action",
        config: { actionType: "resolver_seleccion_horario" },
      },
      // Botón "Otro horario" (desde q-confirmar-cita): re-consulta la lista
      // real (puede haber cambiado) y va DIRECTO a la pregunta abierta --
      // deliberadamente NO reutiliza act-resolver-seleccion-inicial acá: esa
      // acción reutilizaría el hint 'hora' de la PRIMERA selección (que
      // act-resolver-seleccion-horario ya sobreescribió con la hora
      // confirmada), lo que auto-seleccionaría el MISMO horario de nuevo en
      // vez de dejar elegir uno distinto. Nodo separado, misma acción.
      {
        id: "act-relistar-horarios",
        type: "action",
        config: { actionType: "listar_horarios_disponibles_especialista" },
      },
      {
        id: "cond-hay-horarios-otro",
        type: "condition",
        config: { rules: [{ field: "cantidadHorarios", operator: "greater_than", value: 0 }], match: "all" },
      },
      {
        id: "msg-seleccion-no-clara",
        type: "message",
        config: {
          // Mismo criterio que msg-fecha-invalida: resolver_seleccion_horario
          // no otorga ninguna capability en su rama de fallo, así que este
          // texto evita las palabras que exigirían evidencia verificada.
          text: "No logré identificarlo con certeza 😔 Estas son las opciones reales que tengo para ese día:\n\n{{horariosDisponiblesTexto}}\n\n¿Cuál prefieres?",
          messageRole: "informational",
        },
      },

      // Propuesta + decisión en UN solo mensaje interactivo (datos reales,
      // incluida la hora YA RESUELTA determinísticamente). No hay nodo AI de
      // propuesta: Claude saludaba y preguntaba de más. act-agendar SIGUE
      // solo desde class:confirma.
      {
        id: "q-confirmar-cita",
        type: "buttons",
        config: {
          text:
            "Perfecto 💚 Tu cita sería:\n\n" +
            "💅 {{servicio}}\n" +
            "📅 {{fecha}}\n" +
            "🕓 {{hora}}\n" +
            "👩 {{especialista}}\n\n" +
            "¿Confirmas tu cita?",
          variableKey: "respuestaConfirmacionAgendarTexto",
          buttons: [
            { id: DANIELA_BUTTON_IDS.CONFIRMAR_CITA, label: "✅ Confirmar cita" },
            { id: DANIELA_BUTTON_IDS.OTRO_HORARIO, label: "🔄 Otro horario" },
          ],
        },
      },
      {
        id: "ai-clasificar-confirmacion",
        type: "ai",
        config: {
          instruction:
            "La clienta respondió, en respuestaConfirmacionAgendarTexto, a la pregunta de si confirma agendar la cita propuesta. Clasifica como 'confirma' SOLO si es un sí claro e inequívoco (ej. 'sí', 'confirmo', 'dale', 'correcto', 'de una', 'me sirve', 'perfecto') o si el valor es exactamente 'confirmar_cita'. Cualquier otra cosa -- un no, una duda, 'mejor no', 'otro_horario', un cambio de tema, o cualquier respuesta que no sea un sí claro -- clasifícala como 'no_confirma'. Ante la duda, SIEMPRE 'no_confirma': nunca asumas que sí quiere agendar.",
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

      // Petición explícita: si el horario se ocupó entre la consulta y la
      // confirmación, NUNCA decir que la cita quedó creada -- re-consultar
      // disponibilidad real y mostrar opciones nuevas (reutiliza el mismo
      // mecanismo ya probado de "Otro horario": act-relistar-horarios, ver
      // e-ocupado-relistar más abajo), en vez de terminar la conversación a
      // secas dejando a la clienta sin salida real.
      {
        id: "msg-ocupado",
        type: "message",
        config: {
          text: "Uy 😔 ese horario acaba de ser ocupado por alguien más. Dame un segundo, reviso qué opciones quedan.",
          messageRole: "informational",
        },
      },

      {
        id: "ai-confirmar",
        type: "ai",
        config: {
          instruction:
            "La acción de agendar YA CORRIÓ y tienes su resultado real en citaId, status ('confirmada' o 'pendiente'), especialista, servicio, fecha y hora. NUNCA saludes ni digas 'Hola' ni uses el nombre al inicio. Si status es 'confirmada', responde SOLO en este tono: '🎉 Tu cita para [servicio] quedó confirmada con [especialista] el [fecha] a las [hora]. ¡Te esperamos!' Si es 'pendiente', dile que quedó como solicitud y que en breve se la confirman por este mismo chat -- nunca digas 'confirmada' ni 'agendada' cuando status sea 'pendiente'. No preguntes nada más.",
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
          text: "🎉 Tu cita quedó confirmada. ¡Te esperamos!",
          messageRole: "informational",
        },
      },

      {
        id: "msg-recordatorio-asistencia",
        type: "message",
        config: {
          text: DANIELA_MSG_RECORDATORIO_ASISTENCIA,
          messageRole: "informational",
        },
      },
      {
        id: "msg-recordatorio-asistencia-respaldo",
        type: "message",
        config: {
          text: DANIELA_MSG_RECORDATORIO_ASISTENCIA,
          messageRole: "informational",
        },
      },

      { id: "end-mantiene-cita-existente", type: "end", config: {} },
      { id: "end-catalogo-no-disponible", type: "end", config: {} },
      { id: "end-confirmado", type: "end", config: {} },
      { id: "end-confirmado-respaldo", type: "end", config: {} },
      { id: "end-no-confirmada", type: "end", config: {} },
    ],
    edges: [
      // --- Parte 13 -- cita(s) previa(s) --------------------------------
      { id: "e-start", source: "start", target: "act-consultar-citas-previas" },
      { id: "e-previas-cond", source: "act-consultar-citas-previas", target: "cond-tiene-citas-previas" },
      { id: "e-previas-no-tiene", source: "cond-tiene-citas-previas", target: "ai-extraer", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-previas-tiene", source: "cond-tiene-citas-previas", target: "ai-informar-cita-existente", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-informar-a-preguntar", source: "ai-informar-cita-existente", target: "q-agendar-adicional", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-adicional-si-btn", source: "q-agendar-adicional", target: "ai-clasificar-adicional", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.AGENDAR_ADICIONAL) },
      { id: "e-adicional-no-btn", source: "q-agendar-adicional", target: "ai-clasificar-adicional", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.NO_AGENDAR_ADICIONAL) },
      { id: "e-adicional-texto", source: "q-agendar-adicional", target: "ai-clasificar-adicional", sourceHandle: FLOW_EDGE_HANDLE.text },
      { id: "e-adicional-quiere", source: "ai-clasificar-adicional", target: "ai-extraer", sourceHandle: FLOW_EDGE_HANDLE.aiClass("quiere_adicional") },
      { id: "e-adicional-no-quiere", source: "ai-clasificar-adicional", target: "msg-mantiene-cita-existente", sourceHandle: FLOW_EDGE_HANDLE.aiClass("no_quiere") },
      { id: "e-adicional-default", source: "ai-clasificar-adicional", target: "msg-mantiene-cita-existente", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },
      { id: "e-mantiene-end", source: "msg-mantiene-cita-existente", target: "end-mantiene-cita-existente" },

      // Fase 3 — slot-filling condicional. ai-extraer -> por cada dato: si
      // YA existe (extraído), se salta la pregunta; si no, se pregunta y
      // luego se sigue al siguiente dato.
      //
      // Cierre final Daniela (autorizado) — catálogo real SIEMPRE se
      // consulta primero (independiente de si el primer mensaje ya nombró
      // un servicio), porque hace falta la lista real + precios reales
      // antes de poder resolver cualquier selección. El hint 'servicio'
      // (si lo hay) lo consume directamente
      // act-resolver-seleccion-inicial-servicio, sin un gate cond-servicio.
      { id: "e-extraer-a-listar-servicios", source: "ai-extraer", target: "act-listar-servicios", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-listar-servicios-cond", source: "act-listar-servicios", target: "cond-hay-servicios", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-catalogo-vacio", source: "cond-hay-servicios", target: "msg-catalogo-no-disponible", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-catalogo-vacio-end", source: "msg-catalogo-no-disponible", target: "end-catalogo-no-disponible" },
      { id: "e-hay-servicios", source: "cond-hay-servicios", target: "act-resolver-seleccion-inicial-servicio", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },

      // Camino rápido: si 'servicio' (hint del primer mensaje) calza EXACTO
      // (por nombre) con un ítem real del catálogo, se salta la pregunta
      // abierta -- si no, cae a mostrar el catálogo y preguntar.
      { id: "e-inicial-servicio-ok", source: "act-resolver-seleccion-inicial-servicio", target: "cond-servicio-pestanas", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-inicial-servicio-fail", source: "act-resolver-seleccion-inicial-servicio", target: "q-seleccionar-servicio", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },

      { id: "e-seleccionar-servicio-a-interpretar", source: "q-seleccionar-servicio", target: "ai-interpretar-seleccion-servicio" },
      { id: "e-interpretar-servicio-a-resolver", source: "ai-interpretar-seleccion-servicio", target: "act-resolver-seleccion-servicio", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-resolver-servicio-ok", source: "act-resolver-seleccion-servicio", target: "cond-servicio-pestanas", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-resolver-servicio-fail", source: "act-resolver-seleccion-servicio", target: "msg-seleccion-servicio-no-clara", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-seleccion-servicio-no-clara-reintentar", source: "msg-seleccion-servicio-no-clara", target: "q-seleccionar-servicio" },

      { id: "e-servicio-no-pestanas", source: "cond-servicio-pestanas", target: "msg-precio-servicio", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-servicio-si-pestanas", source: "cond-servicio-pestanas", target: "msg-pestanas-transferencia", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-pestanas-msg-handoff", source: "msg-pestanas-transferencia", target: "act-handoff-pestanas" },
      { id: "e-pestanas-handoff-end", source: "act-handoff-pestanas", target: "end-pestanas-transferido", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

      { id: "e-precio-a-fecha", source: "msg-precio-servicio", target: "cond-fecha" },

      { id: "e-no-reconocido-reintentar", source: "msg-servicio-no-reconocido", target: "q-seleccionar-servicio" },

      { id: "e-fecha-falta", source: "cond-fecha", target: "q-fecha", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-fecha-tiene", source: "cond-fecha", target: "cond-nombre", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-fecha-a-nombre", source: "q-fecha", target: "cond-nombre" },

      { id: "e-nombre-falta", source: "cond-nombre", target: "q-nombre", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-nombre-tiene", source: "cond-nombre", target: "act-validar-fecha", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-nombre-a-validar-fecha", source: "q-nombre", target: "act-validar-fecha" },

      // --- REDISEÑO -- validación determinista de fecha -----------------
      { id: "e-validar-fecha-ok", source: "act-validar-fecha", target: "act-listar-horarios", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-validar-fecha-fail", source: "act-validar-fecha", target: "msg-fecha-invalida", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-fecha-invalida-reintentar", source: "msg-fecha-invalida", target: "q-fecha" },

      // --- REDISEÑO -- lista real de horarios ---------------------------
      { id: "e-listar-cond", source: "act-listar-horarios", target: "cond-hay-horarios", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-listar-fail", source: "act-listar-horarios", target: "msg-servicio-no-reconocido", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },

      { id: "e-sin-horarios", source: "cond-hay-horarios", target: "msg-sin-disponibilidad", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-sin-disponibilidad-reintentar", source: "msg-sin-disponibilidad", target: "q-fecha" },
      { id: "e-hay-horarios", source: "cond-hay-horarios", target: "act-resolver-seleccion-inicial", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },

      // Camino rápido: si 'hora' (del primer mensaje) calza EXACTO con la
      // lista real, se salta la pregunta abierta -- si no, cae a preguntar
      // normal, nunca un error visible.
      { id: "e-inicial-ok", source: "act-resolver-seleccion-inicial", target: "q-confirmar-cita", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-inicial-fail", source: "act-resolver-seleccion-inicial", target: "q-seleccionar-horario", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },

      { id: "e-seleccionar-a-interpretar", source: "q-seleccionar-horario", target: "ai-interpretar-seleccion" },
      { id: "e-interpretar-a-resolver", source: "ai-interpretar-seleccion", target: "act-resolver-seleccion-horario", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-resolver-ok", source: "act-resolver-seleccion-horario", target: "q-confirmar-cita", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-resolver-fail", source: "act-resolver-seleccion-horario", target: "msg-seleccion-no-clara", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-seleccion-no-clara-reintentar", source: "msg-seleccion-no-clara", target: "q-seleccionar-horario" },

      // Fix real (prueba real controlada post-publicación de v9, sept. 2026)
      // — un tap del botón "✅ Confirmar cita" es un valor ESTRUCTURADO y
      // controlado por nosotros mismos (id de botón estable, nunca texto
      // libre de la clienta), no algo que deba depender de una
      // clasificación probabilística de Claude. Encontrado reproducible dos
      // veces seguidas: respuestaConfirmacionAgendarTexto llegaba exacto
      // "confirmar_cita" (el caso que la propia instrucción de
      // ai-clasificar-confirmacion dice que debe ser 'confirma' sin duda) y
      // aun así Claude clasificaba 'no_confirma'. Atajo DIRECTO a
      // act-agendar, mismo patrón "acción directa sin nodo AI intermedio"
      // ya usado en el resto de este archivo -- NUNCA se salta la barrera
      // de confirmación explícita: esto solo aplica al tap real del botón,
      // el texto libre (e-confirmar-texto, abajo) sigue pasando por
      // ai-clasificar-confirmacion exactamente igual que antes.
      { id: "e-confirmar-cita-btn", source: "q-confirmar-cita", target: "act-agendar", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.CONFIRMAR_CITA) },
      { id: "e-otro-horario-btn", source: "q-confirmar-cita", target: "act-relistar-horarios", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.OTRO_HORARIO) },
      { id: "e-relistar-cond", source: "act-relistar-horarios", target: "cond-hay-horarios-otro", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-relistar-fail", source: "act-relistar-horarios", target: "msg-servicio-no-reconocido", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-relistar-sin-horarios", source: "cond-hay-horarios-otro", target: "msg-sin-disponibilidad", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e-relistar-hay-horarios", source: "cond-hay-horarios-otro", target: "q-seleccionar-horario", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e-confirmar-texto", source: "q-confirmar-cita", target: "ai-clasificar-confirmacion", sourceHandle: FLOW_EDGE_HANDLE.text },

      { id: "e-no-confirma", source: "ai-clasificar-confirmacion", target: "msg-cita-no-confirmada", sourceHandle: FLOW_EDGE_HANDLE.aiClass("no_confirma") },
      { id: "e-no-confirma-default", source: "ai-clasificar-confirmacion", target: "msg-cita-no-confirmada", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },
      { id: "e-no-confirmada-end", source: "msg-cita-no-confirmada", target: "end-no-confirmada" },

      { id: "e-confirma-agendar", source: "ai-clasificar-confirmacion", target: "act-agendar", sourceHandle: FLOW_EDGE_HANDLE.aiClass("confirma") },

      { id: "e-agendar-success", source: "act-agendar", target: "ai-confirmar", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-agendar-failure", source: "act-agendar", target: "msg-ocupado", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      // Petición explícita del rediseño: nunca dejar a la clienta en un
      // punto muerto tras perder el horario por una carrera real -- se
      // re-consulta disponibilidad REAL (mismo mecanismo que "Otro horario"
      // desde q-confirmar-cita) y se le ofrecen las opciones que sí quedan,
      // en vez de terminar la conversación sin salida.
      { id: "e-ocupado-relistar", source: "msg-ocupado", target: "act-relistar-horarios" },

      { id: "e-confirmar-end", source: "ai-confirmar", target: "msg-recordatorio-asistencia", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
      { id: "e-recordatorio-end", source: "msg-recordatorio-asistencia", target: "end-confirmado" },
      // Fase 3 (Bug raíz #2) — si ai-confirmar falla, cae al respaldo estático
      // (la cita YA está creada) y cierra el flujo. NUNCA vuelve a act-agendar
      // ni a act-listar-horarios.
      { id: "e-confirmar-respaldo", source: "ai-confirmar", target: "msg-confirmada-respaldo", sourceHandle: FLOW_EDGE_HANDLE.aiFailure },
      { id: "e-respaldo-recordatorio", source: "msg-confirmada-respaldo", target: "msg-recordatorio-asistencia-respaldo" },
      { id: "e-respaldo-recordatorio-end", source: "msg-recordatorio-asistencia-respaldo", target: "end-confirmado-respaldo" },
    ],
    variables: [
      // 'hoy' la siembra el orchestrator al crear la ejecución (fecha de hoy
      // en Colombia, YYYY-MM-DD); la usan ai-extraer y act-validar-fecha.
      // Declarada aquí solo como documentación (sin defaultValue).
      { key: "hoy", label: "Fecha de hoy (Colombia)", type: "string" },
      { key: "cantidadCitas", label: "Cantidad de citas activas previas", type: "number" },
      { key: "citasActivas", label: "Lista de citas activas reales previas", type: "string" },
      { key: "respuestaAdicionalTexto", label: "Respuesta de la clienta a si quiere una cita adicional", type: "string" },
      { key: "servicio", label: "Servicio (resuelto contra el catálogo real, nunca texto libre sin validar)", type: "string", required: true },
      { key: "serviciosDisponibles", label: "Catálogo real de servicios (nombre + precio), desde base_conocimiento", type: "string" },
      { key: "serviciosDisponiblesTexto", label: "Catálogo real, formateado para mostrar", type: "string" },
      { key: "cantidadServicios", label: "Cantidad de servicios reales en el catálogo", type: "number" },
      { key: "seleccionServicioTexto", label: "Respuesta de la clienta eligiendo un servicio", type: "string" },
      { key: "seleccionNombre", label: "Nombre de servicio interpretado por la IA (candidato, se valida contra el catálogo real)", type: "string" },
      { key: "precio", label: "Precio real del servicio seleccionado (COP)", type: "number" },
      { key: "precioTexto", label: "Precio real, formateado para mostrar (ej. \"$70.000\")", type: "string" },
      { key: "fecha", label: "Fecha (validada, YYYY-MM-DD real)", type: "string", required: true },
      { key: "nombreCliente", label: "Nombre de la clienta", type: "string", required: true },
      { key: "hora", label: "Hora preferida (hint del primer mensaje, sin validar hasta act-resolver-seleccion-horario)", type: "string" },
      { key: "horariosDisponibles", label: "Lista real de horarios disponibles (HH:MM)", type: "string" },
      { key: "horariosDisponiblesTexto", label: "Lista real de horarios, formateada para mostrar", type: "string" },
      { key: "cantidadHorarios", label: "Cantidad de horarios reales disponibles", type: "number" },
      { key: "seleccionHorarioTexto", label: "Respuesta de la clienta eligiendo un horario", type: "string" },
      { key: "seleccionTipo", label: "Tipo de selección interpretada por la IA (index/time/ambiguo)", type: "string" },
      { key: "seleccionIndice", label: "Índice interpretado (1-based)", type: "number" },
      { key: "seleccionHora", label: "Hora interpretada (HH:MM)", type: "string" },
      { key: "disponible", label: "¿Hay disponibilidad? (compat)", type: "boolean" },
      { key: "respuestaConfirmacionAgendarTexto", label: "Respuesta de la clienta a la confirmación de agendar", type: "string" },
      { key: "citaId", label: "ID de la cita real creada", type: "string", linkedCapability: "appointment.reserved" },
      { key: "status", label: "Estado real de la cita (confirmada/pendiente)", type: "string" },
      { key: "especialista", label: "Especialista asignada realmente", type: "string" },
    ],
  };
}
