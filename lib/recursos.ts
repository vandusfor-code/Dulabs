export type BloqueContenido = { tipo: "p" | "h2"; texto: string } | { tipo: "ul"; items: string[] };

export type Articulo = {
  slug: string;
  titulo: string;
  resumen: string;
  fechaPublicacion: string; // ISO 8601, para el JSON-LD Article
  /** Página de servicio relacionada para el CTA de cierre del artículo. */
  servicioRelacionado: { label: string; href: string };
  bloques: BloqueContenido[];
};

export const ARTICULOS: Articulo[] = [
  {
    slug: "que-es-un-agente-de-ia-para-empresas",
    titulo: "Qué es un agente de IA para empresas",
    resumen:
      "Un agente de IA no es lo mismo que un chatbot de menú fijo. Explicamos qué es, en qué se diferencia y qué puede hacer realmente dentro de una empresa.",
    fechaPublicacion: "2026-08-26",
    servicioRelacionado: { label: "Soluciones de inteligencia artificial para empresas", href: "/inteligencia-artificial-empresas" },
    bloques: [
      {
        tipo: "p",
        texto:
          "Cuando se habla de \"agente de IA\" se suele mezclar con cosas muy distintas: un chatbot de menú fijo, un asistente de voz o directamente un empleado virtual que hace de todo. En la práctica, un agente de IA para empresas es un sistema que recibe una instrucción o una conversación, tiene acceso a información específica de tu negocio, y decide qué hacer con eso: responder, consultar datos, ejecutar una acción o pedir más información antes de continuar.",
      },
      { tipo: "h2", texto: "La diferencia con un chatbot tradicional" },
      {
        tipo: "p",
        texto:
          "Un chatbot de menú fijo funciona con opciones predefinidas: \"escribe 1 para ventas, 2 para soporte\". Si la persona escribe algo que no está en el menú, el chatbot se queda sin respuesta. Un agente de IA en cambio entiende lenguaje natural, mantiene el contexto de la conversación y puede usar herramientas (consultar disponibilidad, crear una cita, buscar en una base de conocimiento) para resolver lo que la persona realmente está pidiendo, no solo lo que estaba previsto en un árbol de decisiones.",
      },
      { tipo: "h2", texto: "Qué puede hacer un agente de IA dentro de una empresa" },
      {
        tipo: "ul",
        items: [
          "Atender conversaciones con clientes usando información real del negocio (precios, horarios, servicios).",
          "Ejecutar acciones concretas: agendar una cita, registrar un pedido, escalar a una persona cuando corresponde.",
          "Consultar una base de conocimiento en vez de responder con información genérica o inventada.",
          "Trabajar dentro de un canal existente, como WhatsApp, sin que el cliente tenga que aprender una app nueva.",
        ],
      },
      { tipo: "h2", texto: "Qué no hace (y por qué eso importa)" },
      {
        tipo: "p",
        texto:
          "Un agente de IA bien construido no reemplaza a tu equipo: automatiza lo repetitivo y asiste en lo operativo, pero las decisiones que requieren criterio humano, negociación o una relación de confianza siguen necesitando a una persona. Cualquier proveedor que prometa que la IA \"reemplaza completamente\" a un equipo está vendiendo una idea, no una solución real. Lo útil es diseñar el agente para que haga bien una parte concreta del trabajo y escale a un humano cuando la conversación lo necesita.",
      },
      {
        tipo: "p",
        texto:
          "En DuLabs diseñamos agentes de IA entrenados con la información real de cada negocio, integrados en el canal donde ya conversa el cliente (normalmente WhatsApp), con la posibilidad de ejecutar acciones reales como agendar citas o registrar leads, no solo responder preguntas.",
      },
    ],
  },
  {
    slug: "whatsapp-business-api-que-es-y-como-funciona",
    titulo: "WhatsApp Business API: qué es y cómo funciona",
    resumen:
      "No es lo mismo la app de WhatsApp Business que la API oficial. Explicamos la diferencia, cómo funciona la Cloud API de Meta y por qué las empresas la usan.",
    fechaPublicacion: "2026-08-26",
    servicioRelacionado: { label: "WhatsApp con IA para empresas", href: "/whatsapp-ia" },
    bloques: [
      {
        tipo: "p",
        texto:
          "Existen tres formas distintas de usar WhatsApp para un negocio, y se confunden con frecuencia: el WhatsApp normal (personal), la app WhatsApp Business (gratuita, para pequeños negocios que atienden desde un celular) y la WhatsApp Business Platform, conocida como la API oficial o Cloud API. Esta última es la que usan las empresas que necesitan automatización, múltiples agentes atendiendo a la vez, o un asistente con inteligencia artificial respondiendo en el mismo número.",
      },
      { tipo: "h2", texto: "Cómo funciona la API oficial" },
      {
        tipo: "p",
        texto:
          "La WhatsApp Business Platform no es una app que se instala en un celular: es una conexión directa entre tu sistema (o el de tu proveedor tecnológico) y los servidores de Meta. Los mensajes entran y salen a través de esa conexión, lo que permite que un sistema externo — como un CRM o un asistente de IA — lea y responda conversaciones de forma automática, en paralelo o en lugar de una persona.",
      },
      { tipo: "h2", texto: "Verificación y plantillas" },
      {
        tipo: "p",
        texto:
          "Para usar la API oficial, el número de WhatsApp debe conectarse formalmente a través de Meta, con el negocio verificado. Además, cualquier mensaje que la empresa quiera iniciar (por ejemplo, un recordatorio o una campaña) fuera de una conversación activa debe hacerse con una plantilla previamente aprobada por Meta — esto evita el spam y protege a los usuarios, y es justamente lo que diferencia a la API oficial de los métodos no oficiales que arriesgan el número a un baneo.",
      },
      { tipo: "h2", texto: "Por qué las empresas la eligen" },
      {
        tipo: "ul",
        items: [
          "Permite automatización real: IA, CRM, bots de agendamiento, sin depender de un celular físico.",
          "Varios agentes pueden atender el mismo número al mismo tiempo desde un panel centralizado.",
          "Es la vía oficial y soportada por Meta, sin el riesgo de baneo de los métodos no oficiales.",
          "Habilita campañas con plantillas aprobadas para avisos, recordatorios y promociones.",
        ],
      },
      {
        tipo: "p",
        texto:
          "El costo de usar la API no lo cobra el proveedor tecnológico: Meta cobra directamente por las conversaciones, según su propio modelo de precios, independiente de lo que cobre la plataforma o el desarrollador que la implementa. Vale la pena tenerlo claro antes de comparar precios entre proveedores.",
      },
    ],
  },
  {
    slug: "como-implementar-whatsapp-con-ia-para-una-empresa",
    titulo: "Cómo implementar WhatsApp con IA para una empresa",
    resumen:
      "Los pasos reales para poner a funcionar un asistente de WhatsApp con IA: conexión oficial, base de conocimiento, personalidad del agente y pruebas antes de activar.",
    fechaPublicacion: "2026-08-26",
    servicioRelacionado: { label: "WhatsApp con IA para empresas", href: "/whatsapp-ia" },
    bloques: [
      {
        tipo: "p",
        texto:
          "Implementar un asistente de WhatsApp con IA no es simplemente \"conectar un bot\". Hay una secuencia de pasos que determina si el asistente termina respondiendo bien o generando más problemas de los que resuelve. Así es como funciona en la práctica.",
      },
      { tipo: "h2", texto: "1. Conexión oficial del número" },
      {
        tipo: "p",
        texto:
          "El primer paso es conectar el número de WhatsApp Business a la API oficial de Meta (WhatsApp Business Platform). Esto requiere verificar el negocio y configurar el número dentro de la infraestructura de Meta — es un proceso técnico que normalmente no hace el dueño del negocio directamente, sino su proveedor tecnológico.",
      },
      { tipo: "h2", texto: "2. Base de conocimiento del negocio" },
      {
        tipo: "p",
        texto:
          "El asistente necesita saber sobre qué está hablando: precios, horarios, servicios, políticas, preguntas frecuentes. Esta información se organiza como base de conocimiento para que la IA responda con datos reales del negocio, en vez de inventar o responder de forma genérica.",
      },
      { tipo: "h2", texto: "3. Personalidad y tono del agente" },
      {
        tipo: "p",
        texto:
          "No todos los negocios quieren que su asistente suene igual. Un spa probablemente quiere un tono cercano y cálido; una empresa B2B quizás prefiere algo más directo y formal. Definir la personalidad del agente es parte del proceso de configuración, no un detalle menor.",
      },
      { tipo: "h2", texto: "4. Automatizaciones específicas" },
      {
        tipo: "p",
        texto:
          "Dependiendo del negocio, el asistente puede necesitar hacer más que responder preguntas: agendar citas, verificar disponibilidad, registrar un pedido o escalar la conversación a una persona. Cada una de estas acciones se configura y se prueba antes de activarse.",
      },
      { tipo: "h2", texto: "5. Pruebas antes de activar" },
      {
        tipo: "p",
        texto:
          "Antes de que el asistente empiece a responder a clientes reales, se prueba con conversaciones simuladas para verificar que entiende bien el negocio, no inventa información y sabe cuándo escalar a una persona.",
      },
      {
        tipo: "p",
        texto:
          "En DuLabs este proceso completo lo hacemos nosotros: nos cuentas cómo funciona tu negocio y nosotros conectamos el número, escribimos las instrucciones de la IA y probamos que responda bien antes de activarla. No es algo que el dueño del negocio tenga que configurar solo.",
      },
    ],
  },
  {
    slug: "cuando-una-empresa-necesita-un-crm-personalizado",
    titulo: "Cuándo una empresa necesita un CRM personalizado",
    resumen:
      "Un CRM genérico funciona hasta que deja de funcionar. Estas son las señales de que tu empresa necesita un CRM hecho a la medida de tu proceso de venta.",
    fechaPublicacion: "2026-08-26",
    servicioRelacionado: { label: "CRM personalizado para empresas", href: "/crm-personalizado" },
    bloques: [
      {
        tipo: "p",
        texto:
          "La mayoría de empresas empieza gestionando sus ventas en una hoja de cálculo o directamente en la memoria del equipo. Funciona bien al principio. El problema aparece cuando el volumen de leads, conversaciones o canales crece más rápido que el proceso manual que los sostiene.",
      },
      { tipo: "h2", texto: "Señales de que ya lo necesitas" },
      {
        tipo: "ul",
        items: [
          "Los leads se pierden entre WhatsApp, correo y notas sueltas, sin un solo lugar donde ver el estado real.",
          "No hay claridad de quién está atendiendo cada conversación o a quién le corresponde el siguiente paso.",
          "El seguimiento depende de que alguien se acuerde de escribir de nuevo, no de un sistema.",
          "Un CRM genérico del mercado te obliga a adaptar tu proceso de venta a su estructura, en vez de al revés.",
          "No hay forma simple de ver cuántos leads entraron, cuántos se cerraron y en qué etapa se están cayendo.",
        ],
      },
      { tipo: "h2", texto: "Por qué un CRM genérico no siempre alcanza" },
      {
        tipo: "p",
        texto:
          "Los CRM del mercado están diseñados para el caso promedio. Eso funciona bien si tu proceso de venta se parece al de cualquier otra empresa. Pero si tu negocio vende por WhatsApp, gestiona citas, tiene un flujo de aprobación particular o combina varios canales de entrada, terminas pagando por funciones que no usas y configurando soluciones alternativas para lo que sí necesitas.",
      },
      { tipo: "h2", texto: "Qué resuelve un CRM a medida" },
      {
        tipo: "p",
        texto:
          "Un CRM personalizado se construye alrededor de cómo tu equipo realmente vende: qué canales usa, cómo se asignan los leads, qué información necesita ver cada persona y qué automatizaciones tienen sentido para tu proceso específico — no el proceso promedio para el que fue diseñado un software genérico.",
      },
      {
        tipo: "p",
        texto:
          "DuMo, el CRM que desarrollamos internamente en DuLabs, nació exactamente de esa necesidad: centralizar conversaciones de WhatsApp, asignarlas al vendedor correcto y dar seguimiento al embudo de ventas sin depender de hojas de cálculo. Es el mismo tipo de sistema que podemos construir a la medida de tu empresa.",
      },
    ],
  },
];

export function articuloPorSlug(slug: string): Articulo | undefined {
  return ARTICULOS.find((a) => a.slug === slug);
}
