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
    config: { filtroCategoria: "Uñas", sinonimos: ["unas", "manicure", "pedicure", "acrilicas", "acrilico", "semipermanente"] },
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
      { tipo: "contains", valor: "que es el" },
      { tipo: "contains", valor: "en que consiste" },
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

  // --- RECOMENDACIONES (único modo=ai) -------------------------------------
  {
    codigo: "040_recomendacion",
    nombre: "Recomendación / cliente indeciso / comparación",
    modo: "ai",
    prioridad: 100,
    activo: true,
    variantes: [
      { tipo: "contains", valor: "que me recomiendas" },
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
        "pregunta anterior, recomienda 2-3 opciones reales de datosIA con precio y duración. Si pide comparar servicios puntuales, compáralos " +
        "usando solo datosIA (precio/duración/descripción), y si falta información dilo con honestidad.",
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
      { tipo: "contains", valor: "horario de atencion" },
      { tipo: "contains", valor: "a que hora abren" },
      { tipo: "contains", valor: "hasta que hora" },
      { tipo: "contains", valor: "atienden domingo" },
    ],
    respuestas: [
      "Nuestro horario es de lunes a viernes de 8:00 a. m. a 8:00 p. m., y sábados de 9:00 a. m. a 8:00 p. m. 💗 Domingos y festivos permanecemos cerrados.",
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
