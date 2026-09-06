/**
 * Banco de escenarios REAL de AMORE (autorizado) — datos de seed, no código
 * de motor. Solo se importa desde: (a) el script de siembra
 * (scripts/_seed-escenarios-amore.mts, que hace el INSERT/UPSERT real contra
 * dulabs_bot_escenarios), y (b) su propio test
 * (lib/bot-escenarios/seed-amore.test.ts, que valida CADA plantilla contra
 * Claim Security real antes de permitir que se publique/siembre).
 *
 * Reglas de oro respetadas (pedido explícito): nunca se inventa un servicio,
 * precio, duración, profesional, horario ni promoción -- toda cifra que
 * aparece acá viene de datos ya confirmados (catálogo real de AMORE) o de
 * hechos que el propio usuario dio como reales en su pedido (horario del
 * salón, número del portal). Donde NO existe un dato real confirmado
 * (ubicación, redes, medios de pago, promociones, paquetes), deliberadamente
 * NO se siembra ningún escenario -- una pregunta sobre eso cae al fallback
 * honesto (000_fallback), que nunca afirma nada que no sea cierto.
 */
import type { EscenarioRow } from "@/lib/bot-escenarios/tipos";

export const AMORE_PORTAL_URL = "https://www.dulabs.co/reservar/amore";

type FilaSeed = Omit<EscenarioRow, "id" | "tenantId">;

export const AMORE_ESCENARIOS_SEED: FilaSeed[] = [
  // --- GENERAL ------------------------------------------------------------
  {
    codigo: "001_saludo",
    nombre: "Saludo",
    modo: "deterministic",
    prioridad: 10,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "hola" },
      { tipo: "contains", valor: "buenas" },
      { tipo: "contains", valor: "buenos dias" },
      { tipo: "contains", valor: "buenas tardes" },
      { tipo: "contains", valor: "buenas noches" },
      { tipo: "contains", valor: "hey" },
    ],
    respuestas: [
      "¡Hola! 💗 Qué lindo tenerte por aquí. Cuéntame, ¿en qué puedo ayudarte?",
      "¡Hola! ✨ Bienvenida a AMORE. ¿En qué te puedo colaborar hoy?",
      "¡Hola, qué gusto! 💗 Cuéntame qué tienes en mente.",
    ],
    config: {},
  },
  {
    codigo: "003_info_general",
    nombre: "Quiero información",
    modo: "deterministic",
    prioridad: 15,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "quiero informacion" },
      { tipo: "contains", valor: "me pueden ayudar" },
      { tipo: "contains", valor: "necesito ayuda" },
      { tipo: "starts_with", valor: "informacion" },
    ],
    respuestas: [
      "Claro que sí 💗 Cuéntame, ¿qué servicio estás buscando o qué te gustaría hacerte?",
      "Con mucho gusto ✨ ¿Qué tienes en mente? Uñas, cabello, cejas, maquillaje...",
    ],
    config: {},
  },
  {
    codigo: "004_gracias",
    nombre: "Gracias",
    modo: "deterministic",
    prioridad: 20,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "gracias" },
    ],
    respuestas: ["Con mucho gusto 💗", "¡Para eso estamos! ✨", "Con todo el gusto, amiga 💗"],
    config: {},
  },
  {
    codigo: "005_despedida",
    nombre: "Despedida",
    modo: "deterministic",
    prioridad: 20,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "chao" },
      { tipo: "contains", valor: "adios" },
      { tipo: "contains", valor: "nos vemos" },
      { tipo: "contains", valor: "hasta luego" },
      { tipo: "contains", valor: "eso era todo" },
    ],
    respuestas: ["¡Que estés muy bien! 💗 Aquí estamos si necesitas algo más.", "¡Un gusto! ✨ Cualquier cosa, aquí estoy."],
    config: {},
  },
  {
    codigo: "008_negacion_generica",
    nombre: "No (genérico, sin contexto de reserva)",
    modo: "deterministic",
    prioridad: 25,
    activo: true,
    variantes: [{ tipo: "negacion_corta" }],
    respuestas: ["Claro, no hay problema 💗 Si quieres conocer otra opción, aquí estoy para ayudarte.", "Tranquila 💗 Cuéntame si quieres que te cuente de algo más."],
    config: {},
  },
  {
    codigo: "009_afirmacion_generica",
    nombre: "Sí (genérico, sin contexto de reserva)",
    modo: "deterministic",
    prioridad: 24,
    activo: true,
    variantes: [{ tipo: "afirmacion_corta" }],
    respuestas: ["¡Genial! 💗 Cuéntame un poquito más para poder ayudarte mejor.", "¡Perfecto! ✨ ¿Qué sería exactamente?"],
    config: {},
  },

  // --- SERVICIOS: categorías reales ----------------------------------------
  {
    // Prueba real de WhatsApp (autorizado) — "manos y pies" es una intención
    // COMBINADA (nunca "manos" solamente): prioridad mayor que
    // 021_categoria_manos/022_categoria_pies para que gane cuando se
    // mencionan ambas palabras juntas. contains_todas es genérico y
    // reutilizable (nunca una regla especial solo para este texto) --
    // cualquier escenario futuro puede usar el mismo mecanismo para
    // cualquier otra combinación de palabras.
    codigo: "029_categoria_manos_y_pies",
    nombre: "Categoría manos y pies combinado (sub-filtro real de Uñas)",
    modo: "catalog",
    prioridad: 420,
    activo: true,
    variantes: [{ tipo: "contains_todas", valores: ["manos", "pies"] }],
    respuestas: [
      "Claro que sí, amiga 💗 Estas son nuestras opciones reales de manos y pies:\n\n{{opcionesTexto}}\n\n¿Cuál te gustaría?",
      "Con gusto ✨ Estas son opciones combinadas de manos y pies:\n\n{{opcionesTexto}}\n\n¿Cuál te llama la atención?",
    ],
    config: {
      filtroCategoria: "Uñas",
      filtroNombreContieneTodas: ["Manos", "Pies"],
      respuestaSinServicio: "Claro que sí 💗 ¿Tienes algo puntual en mente para manos y pies, o te cuento las opciones que tenemos?",
    },
  },
  {
    codigo: "021_categoria_manos",
    nombre: "Categoría manos (sub-filtro real de Uñas)",
    modo: "catalog",
    prioridad: 410,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "arreglarme las manos" },
      { tipo: "contains", valor: "hacerme las manos" },
      { tipo: "starts_with", valor: "manos" },
    ],
    respuestas: [
      "Claro que sí, amiga 💗 Estas son nuestras opciones reales para manos:\n\n{{opcionesTexto}}\n\n¿Cuál te gustaría?",
      "Con gusto ✨ Tenemos estas opciones para manos:\n\n{{opcionesTexto}}\n\n¿Cuál te llama la atención?",
    ],
    config: { filtroCategoria: "Uñas", filtroNombreContiene: ["Manos"], respuestaSinServicio: "Claro que sí, amiga 💗 ¿Tienes algún servicio de manos en mente o quieres que te cuente las opciones que tenemos?" },
  },
  {
    codigo: "022_categoria_pies",
    nombre: "Categoría pies (sub-filtro real de Uñas)",
    modo: "catalog",
    prioridad: 410,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "arreglarme los pies" },
      { tipo: "contains", valor: "hacerme los pies" },
      { tipo: "starts_with", valor: "pies" },
    ],
    respuestas: [
      "Claro que sí, amiga 💗 Estas son nuestras opciones reales para pies:\n\n{{opcionesTexto}}\n\n¿Cuál te gustaría?",
    ],
    config: { filtroCategoria: "Uñas", filtroNombreContiene: ["Pies"], respuestaSinServicio: "Claro que sí, amiga 💗 ¿Tienes algún servicio para pies en mente o quieres que te cuente las opciones que tenemos?" },
  },
  {
    codigo: "020_categoria_unas",
    nombre: "Categoría uñas",
    modo: "catalog",
    prioridad: 400,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "arreglarme las unas" },
      { tipo: "contains", valor: "hacerme las unas" },
      { tipo: "contains", valor: "servicios de unas" },
      { tipo: "contains", valor: "que tienen de unas" },
      { tipo: "categoria_detectada", valor: "Uñas" },
    ],
    respuestas: [
      "Claro que sí, amiga 💗 Estas son algunas opciones reales de uñas:\n\n{{opcionesTexto}}\n\n¿Cuál te llama la atención, o tienes algún servicio puntual en mente?",
      "Con gusto ✨ Estas son opciones reales que tenemos de uñas:\n\n{{opcionesTexto}}\n\n¿Cuál te gustaría?",
    ],
    // Prueba real de WhatsApp (autorizado) — "acrilicas"/"acrilico" se
    // sacaron de acá: ANTES caían silenciosamente a esta categoría y el bot
    // ofrecía alternativas como si esa fuera la respuesta afirmativa (bug
    // real). Ahora existe el escenario dedicado 037_servicio_inexistente_unas
    // (prioridad mayor, ver abajo), que primero declara que el servicio
    // pedido NO existe y solo entonces ofrece las opciones reales.
    config: { filtroCategoria: "Uñas", sinonimos: ["unas", "manicure", "pedicure", "semipermanente"] },
  },
  {
    codigo: "037_servicio_inexistente_unas",
    nombre: "Servicio de uñas pedido que NO existe en el catálogo (ej. acrílicas)",
    modo: "catalog",
    prioridad: 450,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "acrilicas" },
      { tipo: "contains", valor: "acrilico" },
      { tipo: "contains", valor: "acrilica" },
    ],
    respuestas: [
      "Por ahora no tenemos el servicio de acrílicas dentro de nuestro catálogo 💗 Pero sí contamos con otras opciones de uñas:\n\n{{opcionesTexto}}\n\nSi me cuentas qué resultado buscas, te ayudo a encontrar la opción que más se ajuste.",
    ],
    config: { filtroCategoria: "Uñas" },
  },
  {
    codigo: "026_categoria_cabello",
    nombre: "Categoría cabello",
    modo: "catalog",
    prioridad: 400,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "arreglarme el cabello" },
      { tipo: "contains", valor: "hacerme el cabello" },
      { tipo: "categoria_detectada", valor: "Cabello" },
    ],
    respuestas: ["Claro que sí, amiga 💗 Estas son nuestras opciones reales de cabello:\n\n{{opcionesTexto}}\n\n¿Cuál te interesa?"],
    config: { filtroCategoria: "Cabello", sinonimos: ["cabello", "pelo"], respuestaSinServicio: "Claro que sí 💗 ¿Qué te gustaría hacerte en el cabello?" },
  },
  {
    codigo: "023_categoria_cejas",
    nombre: "Categoría cejas",
    modo: "catalog",
    prioridad: 400,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "arreglarme las cejas" },
      { tipo: "contains", valor: "hacerme las cejas" },
      { tipo: "categoria_detectada", valor: "Cejas" },
    ],
    respuestas: ["Claro que sí, amiga 💗 Estas son nuestras opciones reales de cejas:\n\n{{opcionesTexto}}\n\n¿Cuál prefieres?"],
    config: { filtroCategoria: "Cejas", sinonimos: ["cejas"], respuestaSinServicio: "Claro que sí 💗 ¿Qué te gustaría hacerte en las cejas?" },
  },
  {
    codigo: "024_categoria_maquillaje",
    nombre: "Categoría maquillaje",
    modo: "catalog",
    prioridad: 400,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "necesito maquillaje" },
      { tipo: "contains", valor: "quiero maquillaje" },
      { tipo: "categoria_detectada", valor: "Maquillaje" },
    ],
    respuestas: ["Con gusto 💗 Estas son nuestras opciones reales de maquillaje:\n\n{{opcionesTexto}}\n\n¿Cuál te gustaría?"],
    config: { filtroCategoria: "Maquillaje", sinonimos: ["maquillaje", "maquillarme", "maquillar"], respuestaSinServicio: "Claro que sí 💗 ¿Buscas algo más natural o para una ocasión especial?" },
  },
  {
    codigo: "025_categoria_pestanas",
    nombre: "Categoría pestañas",
    modo: "catalog",
    prioridad: 400,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "quiero pestanas" },
      { tipo: "categoria_detectada", valor: "Pestañas" },
    ],
    respuestas: ["Claro que sí 💗 Estas son nuestras opciones reales de pestañas:\n\n{{opcionesTexto}}\n\n¿Cuál te gustaría?"],
    config: { filtroCategoria: "Pestañas", sinonimos: ["pestanas", "pestañas"], respuestaSinServicio: "Claro que sí 💗 Cuéntame qué buscas en pestañas." },
  },
  {
    codigo: "027_categoria_depilacion",
    nombre: "Categoría depilación",
    modo: "catalog",
    prioridad: 400,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "quiero depilarme" },
      { tipo: "contains", valor: "depilar" },
      { tipo: "categoria_detectada", valor: "Depilación" },
    ],
    respuestas: ["Claro que sí 💗 Estas son nuestras opciones reales de depilación:\n\n{{opcionesTexto}}\n\n¿Cuál te interesa?"],
    config: { filtroCategoria: "Depilación", sinonimos: ["depilacion", "depilar", "depilarme"], respuestaSinServicio: "Claro que sí 💗 ¿Qué zona te gustaría depilarte?" },
  },

  // --- SERVICIOS: comparación entre dos servicios reales -------------------
  {
    // FASE B (integración base de conocimiento, autorizado) — pasa de
    // catalog a ai: la comparación ahora la redacta la IA usando el
    // conocimiento general REAL de ambos servicios (separado de los hechos
    // confirmados), en vez de un disclaimer fijo. El backend sigue
    // determinando qué servicios existen/precio/duración -- la IA solo
    // redacta.
    codigo: "051_comparacion",
    nombre: "Comparación entre 2 servicios reales",
    modo: "ai",
    prioridad: 530,
    activo: true,
    // Sin variantes de texto propias a propósito -- el ÚNICO disparador real
    // es dos_servicios_detectados (entidades.serviciosDetectados.length>=2),
    // que ya cubre "Dipping vs Press On", "diferencia entre X y Y", "X o Y",
    // "cuál me recomiendas entre X y Y", y la continuación contextual ("¿Y
    // el Press On?" tras hablar de Dipping, ver resolver.ts). Nunca depende
    // de la palabra exacta usada -- depende de que el catálogo real confirme
    // los 2 nombres.
    variantes: [{ tipo: "dos_servicios_detectados" }],
    respuestas: [],
    config: {
      instruccionIA:
        "Compara los 2 servicios de datosIA usando también su conocimientoGeneral (queEs/paraQueSirve) cuando exista -- recuerda que " +
        "conocimientoGeneral es explicación profesional general, nunca un protocolo confirmado de AMORE, y respeta siempre lo que 'limites' " +
        "prohíbe afirmar de cada uno. Si algún servicio no tiene conocimientoGeneral (fuente='no_confirmado'), dilo con honestidad y natural, " +
        "sin inventar. Responde cálida y breve (2-4 líneas), nunca listado técnico.",
    },
  },

  // --- SERVICIOS: profesional, servicio puntual, precio/duración ----------
  {
    codigo: "034_profesionales",
    nombre: "Quién hace X",
    modo: "catalog",
    prioridad: 520,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "quien hace" },
      { tipo: "contains", valor: "quien lo hace" },
      { tipo: "contains", valor: "quien realiza" },
      { tipo: "contains", valor: "que profesional" },
      { tipo: "contains", valor: "profesionales tienen" },
      { tipo: "contains", valor: "quien esta habilitada" },
    ],
    respuestas: [
      "¡Con gusto! 💗 De {{servicio}} se encargan: {{profesionalesTexto}}.",
    ],
    config: { necesitaProfesionales: true, respuestaSinServicio: "¿De qué servicio te gustaría saber quién lo hace? 💗" },
  },
  {
    codigo: "028_servicio_info",
    nombre: "Servicio específico / precio / duración",
    modo: "catalog",
    prioridad: 500,
    activo: true,
    variantes: [
      { tipo: "servicio_detectado" },
      { tipo: "contains", valor: "cuanto cuesta" },
      { tipo: "contains", valor: "cuanto vale" },
      { tipo: "contains", valor: "que precio" },
      { tipo: "contains", valor: "cuanto dura" },
      { tipo: "contains", valor: "cuanto demora" },
      { tipo: "contains", valor: "cuanto tiempo toma" },
    ],
    respuestas: [
      "¡Claro! 💗 El {{servicio}} tiene un valor de {{precioTexto}} y una duración aproximada de {{duracionTexto}}.{{descripcionExtra}}",
      "Te cuento ✨ El {{servicio}} cuesta {{precioTexto}} y dura aproximadamente {{duracionTexto}}.{{descripcionExtra}}",
    ],
    config: {
      respuestaSinServicio:
        "En este momento no tengo esa opción dentro de los servicios reales de AMORE 💗 Puedo mostrarte otras opciones reales.",
    },
  },
  {
    // FASE B (integración base de conocimiento, autorizado) — "qué es"/"para
    // qué sirve"/"cómo funciona" son preguntas EXPLICATIVAS, distintas de
    // precio/duración (028, determinista): necesitan redacción natural
    // usando el conocimiento general real del servicio, así que van a modo
    // ai. Prioridad 505: apenas por encima de 028 (500) para que, ante un
    // servicio real + frase explicativa, gane esta -- nunca captura
    // preguntas puramente de precio/duración (esas siguen en 028, sin IA).
    codigo: "029_explicacion_servicio",
    nombre: "Qué es / para qué sirve / cómo funciona un servicio",
    modo: "ai",
    prioridad: 505,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "que es el" },
      { tipo: "contains", valor: "que es la" },
      { tipo: "contains", valor: "que es un" },
      { tipo: "contains", valor: "en que consiste" },
      { tipo: "contains", valor: "para que sirve" },
      { tipo: "contains", valor: "como funciona" },
      { tipo: "contains", valor: "como es ese servicio" },
      { tipo: "contains", valor: "explicame" },
      { tipo: "contains", valor: "cuentame sobre" },
      { tipo: "contains", valor: "que me hacen" },
    ],
    respuestas: [],
    config: {
      instruccionIA:
        "Explica el servicio de datosIA usando su conocimientoGeneral (queEs/paraQueSirve) -- recuerda que es explicación profesional " +
        "general, nunca un protocolo confirmado de AMORE, y respeta siempre lo que 'limites' prohíbe afirmar. Si fuente='no_confirmado' " +
        "(sin ficha), dilo con honestidad y natural, sin inventar una explicación. Responde cálida, breve y natural (2-4 líneas), nunca " +
        "como ficha técnica ni listado.",
    },
  },

  // --- RECOMENDACIONES (único modo=ai) -------------------------------------
  {
    codigo: "040_recomendacion",
    nombre: "Recomendación / cliente indeciso / comparación",
    modo: "ai",
    prioridad: 100,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "que me recomiendas" },
      { tipo: "contains", valor: "recomiendas" },
      { tipo: "contains", valor: "recomiendame" },
      { tipo: "contains", valor: "no se que hacerme" },
      { tipo: "contains", valor: "ni idea" },
      { tipo: "contains", valor: "ayudame a escoger" },
      { tipo: "contains", valor: "quiero algo bonito" },
      { tipo: "contains", valor: "quiero consentirme" },
      { tipo: "contains", valor: "verme bonita" },
      { tipo: "contains", valor: "algo natural" },
      { tipo: "contains", valor: "algo duradero" },
      { tipo: "contains", valor: "para una boda" },
      { tipo: "contains", valor: "para un evento" },
      { tipo: "contains", valor: "para una fiesta" },
      { tipo: "contains", valor: "diferencia entre" },
      { tipo: "contains", valor: "cual es mejor" },
    ],
    respuestas: [],
    config: {
      instruccionIA:
        "Si el mensaje es VAGO (ej. 'no sé qué hacerme'), NO recomiendes aún: responde corto y cálido, y haz UNA pregunta breve para orientar " +
        "(resultado natural vs duradero, ocasión, presupuesto o tiempo disponible). Si el mensaje ya da una preferencia clara o responde tu " +
        "pregunta anterior, recomienda 2-3 opciones reales de datosIA con precio y duración -- puedes apoyarte en conocimientoGeneral " +
        "(queEs/paraQueSirve) cuando ayude a explicar por qué encaja, recordando que es explicación general, nunca un protocolo confirmado " +
        "de AMORE, y respetando siempre 'limites'. Si pide comparar servicios puntuales, compáralos usando solo datosIA/conocimientoGeneral, " +
        "y si falta información dilo con honestidad.",
    },
  },

  // --- RESERVA / PORTAL -----------------------------------------------------
  {
    codigo: "061_intencion_reservar",
    nombre: "Intención de agendar/reservar",
    modo: "portal",
    prioridad: 900,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "quiero agendar" },
      { tipo: "contains", valor: "quiero reservar" },
      { tipo: "contains", valor: "quiero una cita" },
      { tipo: "contains", valor: "necesito cita" },
      { tipo: "contains", valor: "quiero sacar cita" },
      { tipo: "contains", valor: "quiero separar" },
      { tipo: "contains", valor: "como agendo" },
      { tipo: "contains", valor: "donde agendo" },
      { tipo: "contains", valor: "quiero hacerlo" },
    ],
    respuestas: [
      `¡Claro que sí, amiga! 💗 Puedes agendar directamente aquí:\n\n${AMORE_PORTAL_URL}\n\nAllí eliges el servicio, la profesional, el día y el horario disponible. ✨`,
      `Con mucho gusto 💗 Para agendar, entra aquí:\n\n${AMORE_PORTAL_URL}\n\nPodrás elegir servicio, profesional, día y hora. ✨`,
    ],
    config: {},
  },
  {
    codigo: "066_proceso_portal",
    nombre: "Cómo funciona la reserva",
    modo: "faq",
    prioridad: 300,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "como funciona la reserva" },
      { tipo: "contains", valor: "como reservo" },
      { tipo: "contains", valor: "como funciona el portal" },
    ],
    respuestas: [
      `En el portal primero se elige el servicio, luego la profesional, el día y la hora, y se completan los datos de contacto -- ¡así de fácil! ✨\n\n${AMORE_PORTAL_URL}`,
    ],
    config: {},
  },
  {
    codigo: "067_seleccion_profesional",
    nombre: "¿Puedo elegir profesional?",
    modo: "faq",
    prioridad: 300,
    activo: true,
    variantes: [{ tipo: "contains", valor: "elegir profesional" }, { tipo: "contains", valor: "escoger profesional" }, { tipo: "contains", valor: "elegir la profesional" }],
    respuestas: ["¡Sí! 💗 En el portal puedes elegir la profesional que prefieras entre las disponibles para ese servicio."],
    config: {},
  },
  {
    codigo: "068_seleccion_horario",
    nombre: "¿Puedo elegir horario?",
    modo: "faq",
    prioridad: 300,
    activo: true,
    variantes: [{ tipo: "contains", valor: "elegir horario" }, { tipo: "contains", valor: "escoger horario" }, { tipo: "contains", valor: "elegir la hora" }],
    respuestas: ["¡Claro! 💗 En el portal se pueden ver los horarios reales y elegir el que mejor convenga."],
    config: {},
  },
  {
    codigo: "069_confirmacion",
    nombre: "¿Me llega confirmación?",
    modo: "faq",
    prioridad: 300,
    activo: true,
    variantes: [{ tipo: "contains", valor: "llega confirmacion" }, { tipo: "contains", valor: "me confirman" }, { tipo: "contains", valor: "recibo confirmacion" }],
    respuestas: ["¡Sí! 💗 Apenas se guarda la reserva en el portal, llega la confirmación por este mismo WhatsApp."],
    config: {},
  },
  {
    codigo: "072_disponibilidad_general",
    nombre: "Horarios/disponibilidad general (sin reservar)",
    modo: "faq",
    prioridad: 260,
    activo: true,
    variantes: [{ tipo: "contains", valor: "que horarios tienen" }, { tipo: "contains", valor: "hay disponibilidad" }, { tipo: "contains", valor: "tienen cupo" }],
    respuestas: [
      `Los horarios reales disponibles los ves directo en el portal 💗\n\n${AMORE_PORTAL_URL}\n\nAllí eliges servicio, profesional, día y hora. ✨`,
    ],
    config: {},
  },

  // --- SALÓN (solo lo que es real y confirmado) ----------------------------
  {
    codigo: "080_horario",
    nombre: "Horario de atención",
    modo: "faq",
    prioridad: 250,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "que horario" },
      // Prueba real (FASE B, autorizado) — "¿Cuál es el horario?" caía al
      // fallback genérico: "es el horario" no contenía "que horario" como
      // substring. Se amplían las variantes con formulaciones naturales
      // equivalentes, sin cambiar el catálogo/Flow Engine/QR/portal.
      { tipo: "contains", valor: "es el horario" },
      { tipo: "contains", valor: "horario de atencion" },
      { tipo: "contains", valor: "a que hora abren" },
      { tipo: "contains", valor: "a que hora cierran" },
      { tipo: "contains", valor: "hasta que hora" },
      // "domingo" (sin más calificador) cubre "atienden domingo", "atienden
      // los domingos", "trabajan domingo", etc. -- antes "atienden domingo"
      // exigía esas dos palabras exactamente contiguas, sin "los" en medio.
      { tipo: "contains", valor: "domingo" },
      { tipo: "contains", valor: "festivo" },
    ],
    respuestas: [
      "Nuestro horario es de lunes a viernes de 8:00 a. m. a 8:00 p. m., y sábados de 9:00 a. m. a 8:00 p. m. 💗 Domingos y festivos permanecemos cerrados.",
    ],
    config: {},
  },
  {
    // Prueba real de WhatsApp (autorizado) — antes caía al fallback de
    // catálogo ("cuéntame qué servicio buscas"), ignorando por completo la
    // pregunta real. Sin dato real de dirección confirmado (auditado en
    // dulabs_clientes_config) -- honesto, nunca inventa.
    codigo: "084_direccion",
    nombre: "Dirección / ubicación / cómo llegar",
    modo: "faq",
    prioridad: 270,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "direccion" },
      { tipo: "contains", valor: "ubicacion" },
      { tipo: "contains", valor: "donde estan" },
      { tipo: "contains", valor: "donde quedan" },
      { tipo: "contains", valor: "como llego" },
      { tipo: "contains", valor: "como llegar" },
      { tipo: "contains", valor: "parqueadero" },
    ],
    respuestas: [
      "Por ahora no tengo la dirección de AMORE en la información que manejo 💗 Puedo ayudarte con servicios, horarios, o dejarte en contacto con el equipo para ese dato.",
      "Esa parte todavía no la tengo a la mano 💗 Puedo ayudarte con servicios y horarios, o comunicarte con el equipo para confirmar la ubicación.",
    ],
    config: {},
  },
  {
    // Prueba real de WhatsApp (autorizado) — bandeja honesta para todo lo
    // que AMORE aún no tiene registrado (redes, contacto, pagos, promos,
    // políticas) -- nunca inventa, nunca cae al fallback de catálogo.
    codigo: "090_info_general_no_disponible",
    nombre: "Información general no confirmada (redes, pagos, promociones, políticas...)",
    modo: "faq",
    prioridad: 265,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "instagram" },
      { tipo: "contains", valor: "redes sociales" },
      { tipo: "contains", valor: "facebook" },
      { tipo: "contains", valor: "telefono" },
      { tipo: "contains", valor: "numero de contacto" },
      { tipo: "contains", valor: "medios de pago" },
      { tipo: "contains", valor: "como pago" },
      { tipo: "contains", valor: "aceptan tarjeta" },
      { tipo: "contains", valor: "promocion" },
      { tipo: "contains", valor: "descuento" },
      { tipo: "contains", valor: "paquete" },
      { tipo: "contains", valor: "politica" },
    ],
    respuestas: [
      "Por ahora no tengo ese dato en la información de AMORE 💗 Puedo ayudarte con nuestros servicios, horarios, o comunicarte con el equipo.",
      "Esa información todavía no la tengo a la mano 💗 Puedo contarte de nuestros servicios y horarios, o dejarte en contacto con el equipo.",
    ],
    config: {},
  },

  // --- TRANSFERENCIA --------------------------------------------------------
  {
    codigo: "110_hablar_con_persona",
    nombre: "Transferencia a humano",
    modo: "transfer",
    prioridad: 950,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "hablar con una persona" },
      { tipo: "contains", valor: "hablar con alguien" },
      { tipo: "contains", valor: "necesito hablar con" },
      { tipo: "contains", valor: "quiero hablar con" },
      { tipo: "contains", valor: "asesora real" },
      { tipo: "contains", valor: "atencion humana" },
      { tipo: "contains", valor: "necesito soporte" },
      { tipo: "contains", valor: "problema con mi reserva" },
      { tipo: "contains", valor: "problema con el portal" },
      { tipo: "contains", valor: "quiero cambiar mi cita" },
      { tipo: "contains", valor: "quiero cancelar mi cita" },
    ],
    respuestas: [
      "Claro que sí 💗 En un momento nuestro equipo se pone en contacto contigo para ayudarte directamente.",
      "Con gusto 💗 En un momento nuestro equipo se pone en contacto contigo.",
    ],
    config: {},
  },

  // --- FALLBACK (código reservado, obligatorio) ----------------------------
  {
    codigo: "000_fallback",
    nombre: "Fallback honesto",
    modo: "deterministic",
    prioridad: 0,
    activo: true,
    variantes: [],
    respuestas: [
      "Claro, amiga 💗 Quiero ayudarte. Cuéntame un poquito más: ¿qué servicio estás buscando o qué te gustaría hacerte?",
      "Por ahora no cuento con esa información de AMORE 💗 Si quieres, puedo ayudarte con nuestros servicios o comunicarte con una persona del equipo.",
    ],
    config: {},
  },
];
