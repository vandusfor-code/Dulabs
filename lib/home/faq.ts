// Preguntas frecuentes de la home: FUENTE ÚNICA del texto visible (components/home/FaqSection) y del JSON-LD FAQPage (lib/home/seo.ts).
// Un test compara ambos, pregunta por pregunta, y otro contrasta cada afirmación con el producto real (Wizard, Runtime, planes, OpenAPI).
//
// Criterio editorial: son preguntas que un potencial cliente realmente escribiría en un buscador o se haría antes de contratar, con
// respuestas concretas y honestas (incluidos los límites: no cobra ni toma pedidos, sin fotos ni WhatsApp Commerce, calendario = Google
// Calendar). Lo que tiene cifras sale de las mismas fuentes que la página: los precios de lib/planes.ts y los tipos de negocio del Wizard.
// Sin clientes, métricas, certificaciones ni integraciones que no existan.
import { BUSINESS_TYPE_OPTIONS } from "@/lib/business-agent-form";
import { PLANES } from "@/lib/planes";

export type FaqEnlace = { texto: string; href: string };
export type FaqItem = { id: string; pregunta: string; respuesta: string[]; enlace?: FaqEnlace };
export type FaqGrupo = { id: string; titulo: string; items: FaqItem[] };

const cop = (n: number | null): string => `$${(n ?? 0).toLocaleString("es-CO")}`;
const TIPOS_DE_NEGOCIO = BUSINESS_TYPE_OPTIONS.filter((o) => o.value !== "Otro").map((o) => o.value);

export const GRUPOS_FAQ: FaqGrupo[] = [
  {
    id: "agentes-whatsapp",
    titulo: "Agentes de IA para WhatsApp",
    items: [
      {
        id: "que-es-agente-ia",
        pregunta: "¿Qué es un agente de IA para WhatsApp?",
        respuesta: [
          "Es un asistente que atiende las conversaciones de tus clientes por WhatsApp usando la información de tu negocio: servicios, precios, horarios, preguntas frecuentes y documentos. Además de responder, ejecuta acciones: consulta tu catálogo, calcula cotizaciones, agenda, cancela o reprograma citas, capta datos del cliente y pasa la conversación a una persona cuando hace falta.",
          "La IA interpreta lo que escribe el cliente; las reglas de tu negocio (disponibilidad, precios, cotizaciones, transferencia) las aplica el sistema con la configuración que tú defines, no el modelo.",
        ],
        enlace: { texto: "Qué es un agente de IA para empresas", href: "/recursos/que-es-un-agente-de-ia-para-empresas" },
      },
      {
        id: "automatizar-atencion",
        pregunta: "¿Un agente de IA puede automatizar la atención al cliente de mi negocio?",
        respuesta: [
          "Puede encargarse de las conversaciones repetitivas: responder preguntas frecuentes con tus documentos, informar precios y servicios de tu catálogo, cotizar, agendar citas y pedir los datos que necesites. Responde cuando el cliente escribe.",
          "Si el cliente pide hablar con una persona, se da un caso que tú definiste o el agente no encuentra la respuesta en tu información, puede pasar la conversación a tu equipo en lugar de improvisar. No cobra ni toma pedidos: esa parte sigue en manos de tu equipo.",
        ],
        enlace: { texto: "WhatsApp con IA para empresas", href: "/whatsapp-ia" },
      },
      {
        id: "como-crear-agente",
        pregunta: "¿Cómo creo un agente de IA para mi negocio?",
        respuesta: [
          "Te registras, eliges un plan y conectas tu número de WhatsApp con Meta. Después configuras el agente con el asistente paso a paso: tipo de negocio, personalidad, capacidades, agendamiento, servicios y productos, horarios, datos del cliente, conocimiento, reglas y transferencia.",
          "Antes de publicar puedes probarlo en una vista previa simulada, que no envía mensajes reales. El sistema revisa que la configuración esté completa, guarda cada versión publicada y conecta el agente a tu número.",
        ],
        enlace: { texto: "Ver los tres pasos", href: "#como-funciona" },
      },
      {
        id: "saber-programar",
        pregunta: "¿Necesito saber programar para configurar mi agente?",
        respuesta: [
          "No. La configuración se hace desde formularios del panel: cargas tus servicios, horarios, preguntas frecuentes y documentos, eliges qué puede hacer el agente y cuándo debe pasar la conversación a una persona. No hay que escribir código.",
        ],
      },
      {
        id: "configurar-yo-mismo",
        pregunta: "¿Puedo configurar el agente yo mismo?",
        respuesta: [
          "Sí. El asistente de configuración está en el panel de DuLabs y lo usas tú o tu equipo. Puedes cambiar la configuración cuando quieras: cada vez que publicas se guarda una versión nueva y queda un historial de versiones.",
          "Si necesitas algo que el producto estándar no cubre, por ejemplo integraciones con tus sistemas, se hace como un proyecto a la medida con el equipo de DuLabs.",
        ],
      },
      {
        id: "conectar-whatsapp",
        pregunta: "¿Puedo conectar mi número de WhatsApp al agente?",
        respuesta: [
          "Sí. El agente funciona sobre la API oficial de WhatsApp Business Platform de Meta: conectas tu número desde DuLabs con el registro de Meta y publicas el agente sobre ese número.",
          "Los costos de mensajería de WhatsApp no están incluidos en el plan de DuLabs: Meta los cobra directamente al negocio según sus tarifas vigentes.",
        ],
      },
      {
        id: "mantener-numero",
        pregunta: "¿Puedo mantener mi número de WhatsApp Business y seguir usándolo en el celular?",
        respuesta: [
          "Si tu número ya está en la app WhatsApp Business, DuLabs permite conectarlo en modo coexistencia: el agente atiende por la API mientras tú sigues usando la app en el celular. Ese modo depende de los requisitos y la disponibilidad de Meta, así que conviene confirmarlos con tu número al momento de conectarlo.",
        ],
      },
    ],
  },
  {
    id: "agendamiento",
    titulo: "Agendamiento con Google Calendar",
    items: [
      {
        id: "agendar-citas",
        pregunta: "¿El agente de IA puede agendar citas por WhatsApp?",
        respuesta: [
          "Sí. Identifica el servicio que pide el cliente, consulta la disponibilidad, le ofrece horarios libres, crea la cita en tu Google Calendar cuando el cliente elige y se la confirma. Para que funcione activas la capacidad «Agendar citas», configuras tus servicios con su duración y tus horarios de atención, y conectas tu Google Calendar.",
        ],
        enlace: { texto: "Ver cómo funciona el agendamiento", href: "#agendamiento" },
      },
      {
        id: "google-calendar",
        pregunta: "¿Se puede conectar el agente con Google Calendar?",
        respuesta: [
          "Sí. Desde el panel conectas tu Google Calendar y eliges qué calendario usar: el agente consulta sus eventos para saber qué horarios están ocupados y crea allí las citas nuevas. Hoy la integración de calendario es con Google Calendar.",
          "También existe un modo interno con especialistas configurados en DuLabs, pero cancelar y reprogramar por WhatsApp funciona con Google Calendar.",
        ],
      },
      {
        id: "disponibilidad-real",
        pregunta: "¿Cómo sabe el agente qué horarios están disponibles?",
        respuesta: [
          "No los inventa: los calcula el sistema. Combina tu horario de atención, las excepciones que cargues (festivos o cierres), la duración del servicio, el aviso mínimo que definas y los eventos que ya tienes en Google Calendar, y solo ofrece horarios libres.",
          "La IA interpreta lo que pide el cliente, pero no decide la disponibilidad.",
        ],
      },
      {
        id: "cancelar-reprogramar",
        pregunta: "¿El agente puede cancelar o reprogramar citas?",
        respuesta: [
          "Sí, con Google Calendar conectado y si activas la opción «Permitir cancelar y cambiar citas por WhatsApp». El cliente cancela o mueve sus propias citas (se identifica por su número de WhatsApp) y el sistema lo hace en tu calendario, respetando tu horario y la duración.",
          "Puedes definir con cuántas horas de anticipación se permite; con menos tiempo, el agente pasa el caso a una persona si tienes activada la transferencia.",
        ],
      },
    ],
  },
  {
    id: "conocimiento-asesores",
    titulo: "Catálogo, conocimiento y asesores",
    items: [
      {
        id: "cargar-informacion",
        pregunta: "¿Puedo cargar la información de mi empresa para que el agente responda con ella?",
        respuesta: [
          "Sí. Puedes cargar preguntas frecuentes y documentos en PDF, Excel (.xlsx), CSV o TXT. Para cada pregunta, el sistema busca los fragmentos relevantes y el agente responde con esa información, en lugar de recibir el documento completo cada vez.",
          "Si no encuentra la respuesta en tu información, no la inventa: responde con el mensaje que tú definas y puede pasar la conversación a una persona. La búsqueda encuentra palabras parecidas, no sinónimos, por eso conviene escribir una misma pregunta de varias formas.",
        ],
        enlace: { texto: "Ver cómo se usa el conocimiento", href: "#conocimiento" },
      },
      {
        id: "catalogo-productos-servicios",
        pregunta: "¿El agente puede trabajar con mis servicios y productos y mostrar el catálogo con precios?",
        respuesta: [
          "Sí. Guardas tus servicios (con categoría, duración, precio opcional y descripción) y tus productos (con categoría, precio, descripción y stock informativo). El agente responde desde ese catálogo y calcula cotizaciones con tus precios y cantidades: las calcula el sistema, no el modelo.",
          "Muestra la información como texto dentro de la conversación: hoy no incluye fotos ni WhatsApp Commerce. Tampoco cobra ni toma pedidos: para concretar la compra, pasa la conversación a tu equipo.",
        ],
        enlace: { texto: "Ver el catálogo en acción", href: "#catalogo" },
      },
      {
        id: "transferir-asesor",
        pregunta: "¿El agente puede transferir la conversación a un asesor?",
        respuesta: [
          "Sí, si activas la capacidad «Transferir a un humano». Tú defines cuándo: cuando el cliente lo pide, ante una queja, si pide un descuento, con una palabra clave o con una intención detectada. La decisión la toma el sistema con tus reglas, no el modelo por su cuenta.",
          "Al transferir, el agente deja de responder en ese chat durante las horas que configures y tu equipo continúa la conversación, por ejemplo desde la bandeja de mensajes del panel. También puedes definir cosas que el agente nunca debe hacer: se evalúan antes del modelo y pueden bloquear, responder con un texto fijo o transferir.",
        ],
      },
    ],
  },
  {
    id: "planes-a-la-medida",
    titulo: "Planes, empresas y soluciones a la medida",
    items: [
      {
        id: "cuanto-cuesta",
        pregunta: "¿Cuánto cuesta un agente de IA con DuLabs y qué no incluye el precio?",
        respuesta: [
          `Para crear tu agente hay tres planes mensuales: ${PLANES.essential.nombre} (${cop(PLANES.essential.precioCop)} COP al mes), ${PLANES.business.nombre} (${cop(PLANES.business.precioCop)} COP al mes) y ${PLANES.pro.nombre} (${cop(PLANES.pro.precioCop)} COP al mes). Enterprise se cotiza para empresas con necesidades a la medida.`,
          "El primer cobro incluye además una cuota de implementación de pago único, descrita en los planes como la configuración y puesta en marcha de tu asistente. Los límites de cada plan están en la sección de planes.",
          "Los costos de mensajería de WhatsApp no están incluidos: Meta los cobra directamente al negocio según sus tarifas vigentes.",
        ],
        enlace: { texto: "Ver los planes", href: "/precios" },
      },
      {
        id: "tipos-de-empresas",
        pregunta: "¿Qué tipo de empresas pueden usar DuLabs?",
        respuesta: [
          `DuLabs ofrece agentes de IA para empresas que atienden a sus clientes por WhatsApp. Estos son los tipos de negocio que ofrece el asistente de configuración: ${TIPOS_DE_NEGOCIO.join(", ")}. También puedes indicar otro tipo.`,
          "Si tu empresa necesita más que un agente configurable, DuLabs desarrolla soluciones de inteligencia artificial y automatización a la medida.",
        ],
      },
      {
        id: "soluciones-a-medida",
        pregunta: "¿DuLabs desarrolla soluciones personalizadas y automatización empresarial?",
        respuesta: [
          "Sí. Además del agente que puedes crear tú mismo, DuLabs diseña e implementa proyectos a la medida: agentes de IA personalizados, automatización de procesos y flujos operativos, integraciones con tus sistemas y software como CRM, sistemas internos, plataformas web y dashboards.",
          "El trabajo va de entender tu negocio y tus procesos a diseñar, desarrollar e implementar la solución. La cotización depende del alcance y el tiempo depende del proyecto. Un ejemplo publicado es DuMo, el CRM propio que DuLabs desarrolló para gestionar leads y conversaciones de WhatsApp.",
        ],
        enlace: { texto: "Ver soluciones empresariales", href: "/soluciones-empresariales" },
      },
      {
        id: "integrar-sistemas",
        pregunta: "¿Puedo conectar DuLabs con otros sistemas de mi empresa?",
        respuesta: [
          "El agente que configuras tú mismo se conecta con WhatsApp y con Google Calendar. Conectarlo con otros sistemas, como un CRM, APIs o sistemas internos, se hace en un proyecto a la medida con el equipo de DuLabs.",
          "Si tu equipo desarrolla, DuLabs Developer ofrece además una API sobre WhatsApp Cloud API oficial de Meta, con webhooks firmados, API keys y documentación pública.",
        ],
        enlace: { texto: "Ver integraciones", href: "/integraciones" },
      },
      {
        id: "autoservicio-vs-implementacion",
        pregunta: "¿Qué diferencia hay entre crear el agente yo mismo y contratar una implementación personalizada?",
        respuesta: [
          "Crear el agente tú mismo (autoservicio): eliges un plan y usas el asistente del panel para configurar y publicar un agente con las capacidades del producto: responder con tu conocimiento, mostrar tu catálogo, cotizar, agendar con Google Calendar, captar datos y transferir a una persona.",
          "Una implementación personalizada (a la medida) es un proyecto con el equipo de DuLabs para lo que el producto estándar no cubre: automatizaciones, integraciones con tus sistemas, agentes personalizados o software propio. Se cotiza según el alcance y el tiempo depende del proyecto.",
          "Los planes incluyen además una cuota de implementación de pago único, descrita como la configuración y puesta en marcha de tu asistente; su valor está en la sección de planes. Si no sabes cuál necesitas, escríbenos y lo revisamos contigo.",
        ],
        enlace: { texto: "Hablar con un especialista", href: "#empezar" },
      },
    ],
  },
];

export const todasLasFaq = (): FaqItem[] => GRUPOS_FAQ.flatMap((g) => g.items);

/** Texto de la respuesta tal como va en el JSON-LD: los párrafos visibles separados por una línea en blanco. */
export const textoRespuesta = (item: FaqItem): string => item.respuesta.join("\n\n");
