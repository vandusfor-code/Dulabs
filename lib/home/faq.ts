// Preguntas frecuentes de la home: FUENTE ÚNICA del texto visible (components/home/FaqSection) y del JSON-LD FAQPage (lib/home/seo.ts).
// Un test compara ambos, pregunta por pregunta, y otros contrastan cada afirmación con el producto real (Wizard, Runtime, planes).
//
// La home solo lleva las 8 preguntas que decide una compra; la FAQ completa vive en /preguntas-frecuentes.
//
// Modelo de producto que explican (decisión definitiva):
//   01 · CREA TU AGENTE  -> agente estándar: el cliente lo crea, configura, prueba, publica y administra SOLO desde el Wizard del panel.
//   02 · A LA MEDIDA     -> soluciones empresariales: DuLabs lo desarrolla contigo (automatización, integraciones, desarrollos propios).
// La implementación manual de DuLabs NO se presenta como requisito para crear el agente. Lo que tiene cifras sale de lib/planes.ts.
import { PLANES } from "@/lib/planes";

export type FaqEnlace = { texto: string; href: string };
export type FaqItem = { id: string; pregunta: string; respuesta: string[]; enlaces?: FaqEnlace[] };

const cop = (n: number | null): string => `$${(n ?? 0).toLocaleString("es-CO")}`;

export const FAQ_HOME: FaqItem[] = [
  {
    id: "que-es-agente-ia",
    pregunta: "¿Qué es un agente de IA para WhatsApp?",
    respuesta: [
      "Es un asistente que atiende las conversaciones de tus clientes por WhatsApp con la información de tu negocio: servicios, precios, horarios, preguntas frecuentes y documentos. Además de responder, ejecuta acciones: consulta tu catálogo, cotiza, agenda citas, capta datos del cliente y pasa la conversación a una persona cuando hace falta.",
      "La IA interpreta lo que escribe el cliente; las reglas de tu negocio (disponibilidad, precios, transferencia) las aplica el sistema con la configuración que tú defines, no el modelo. No cobra ni toma pedidos: esa parte sigue en manos de tu equipo.",
    ],
    enlaces: [{ texto: "Qué es un agente de IA para empresas", href: "/recursos/que-es-un-agente-de-ia-para-empresas" }],
  },
  {
    id: "como-crear-agente",
    pregunta: "¿Cómo creo mi agente de IA?",
    respuesta: [
      "Te registras, eliges un plan y conectas tu número de WhatsApp con Meta. Después usas el asistente paso a paso del panel: tipo de negocio, personalidad, capacidades, agendamiento, servicios y productos, horarios, datos del cliente, conocimiento, reglas y transferencia.",
      "Lo pruebas en una vista previa simulada, que no envía mensajes reales. Cuando la configuración está completa, lo publicas en tu número de WhatsApp y lo administras desde el mismo panel: cada cambio se guarda como una versión nueva.",
    ],
    enlaces: [{ texto: "Ver el proceso paso a paso", href: "#como-funciona" }],
  },
  {
    id: "saber-programar",
    pregunta: "¿Necesito saber programar para configurar mi agente?",
    respuesta: [
      "No. La configuración se hace desde formularios del panel: cargas tus servicios, horarios, preguntas frecuentes y documentos, eliges qué puede hacer el agente y cuándo debe pasar la conversación a una persona. Tú defines el tono y las reglas; no hay que escribir código.",
    ],
  },
  {
    id: "conectar-whatsapp",
    pregunta: "¿Puedo conectar mi WhatsApp Business al agente?",
    respuesta: [
      "Sí. El agente funciona sobre la API oficial de WhatsApp Business Platform de Meta: conectas tu número desde DuLabs con el registro de Meta y publicas el agente sobre ese número.",
      "Si tu número ya está en la app WhatsApp Business, DuLabs permite conectarlo en modo coexistencia: el agente atiende por la API mientras tú sigues usando la app en el celular. Ese modo depende de los requisitos y la disponibilidad de Meta.",
    ],
  },
  {
    id: "agendar-citas",
    pregunta: "¿El agente puede agendar citas por WhatsApp?",
    respuesta: [
      "Sí. Identifica el servicio que pide el cliente, consulta la disponibilidad, le ofrece horarios libres, crea la cita en tu Google Calendar cuando el cliente elige y se la confirma. Para que funcione activas la capacidad «Agendar citas», configuras tus servicios con su duración y tus horarios de atención, y conectas tu Google Calendar.",
    ],
    enlaces: [{ texto: "Ver qué más puede hacer tu agente", href: "#capacidades" }],
  },
  {
    id: "google-calendar",
    pregunta: "¿Se puede conectar el agente con Google Calendar?",
    respuesta: [
      "Sí. Desde el panel conectas tu Google Calendar y eliges qué calendario usar: el agente consulta sus eventos para saber qué horarios están ocupados y crea allí las citas nuevas. Hoy la integración de calendario es con Google Calendar.",
      "La disponibilidad no la inventa la IA: la calcula el sistema con tu horario de atención, la duración del servicio y los eventos que ya tienes. Con Google Calendar conectado, el agente también puede cancelar y reprogramar citas si activas esa opción.",
    ],
    enlaces: [{ texto: "Ver integraciones", href: "/integraciones" }],
  },
  {
    id: "crear-vs-a-la-medida",
    pregunta: "¿Qué diferencia hay entre crear mi propio agente y pedir una solución a la medida?",
    respuesta: [
      "Crear tu agente (agente estándar): lo configuras tú mismo desde el panel, sin programar, con las capacidades del producto: responder con tu conocimiento, mostrar tu catálogo, cotizar, agendar con Google Calendar, captar datos y transferir a una persona. Lo pruebas, lo publicas y lo administras tú.",
      "A la medida (soluciones empresariales): DuLabs lo desarrolla contigo cuando necesitas algo que el agente estándar no cubre: automatizaciones, integraciones con tus sistemas, agentes personalizados o software propio. Se cotiza según el alcance y el tiempo depende del proyecto.",
    ],
    enlaces: [{ texto: "Ver soluciones a la medida", href: "#empresas" }],
  },
  {
    id: "cuanto-cuesta",
    pregunta: "¿Cuánto cuesta un agente de IA con DuLabs y qué no incluye el precio?",
    respuesta: [
      `Para crear tu agente hay tres planes mensuales: ${PLANES.essential.nombre} (${cop(PLANES.essential.precioCop)} COP al mes), ${PLANES.business.nombre} (${cop(PLANES.business.precioCop)} COP al mes) y ${PLANES.pro.nombre} (${cop(PLANES.pro.precioCop)} COP al mes). Enterprise se cotiza para empresas con necesidades a la medida.`,
      "Además de la mensualidad, cada plan muestra un pago único de implementación que va en el primer cobro; el desglose aparece antes de pagar. Los límites de cada plan están en la sección de planes.",
      "Los costos de mensajería de WhatsApp no están incluidos: Meta los cobra directamente al negocio según sus tarifas vigentes.",
    ],
    enlaces: [{ texto: "Ver los planes", href: "/precios" }],
  },
];

export const todasLasFaq = (): FaqItem[] => FAQ_HOME;

/** Texto de la respuesta tal como va en el JSON-LD: los párrafos visibles separados por una línea en blanco. */
export const textoRespuesta = (item: FaqItem): string => item.respuesta.join("\n\n");
