// Fuente única de lo que la home afirma que el agente HACE y de cómo se llaman los pasos del Wizard. Un test (home-contenido.test.tsx) verifica
// contra el código real que: (1) cada capacidad usada aquí existe y está disponible en CAPABILITY_BACKING, (2) cada etiqueta coincide con
// la del Wizard (components/dashboard/business-agent/Wizard.tsx). Si el producto cambia, la home no puede quedarse afirmando algo viejo.
import type { CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";

/** Etiquetas EXACTAS que muestra el Wizard para cada capacidad (CAPABILITY_LABELS). Alimentan el `featureList` del JSON-LD. */
export const ETIQUETA_CAPACIDAD: Record<CapabilityKey, string> = {
  faq: "Responder preguntas frecuentes",
  sales: "Cotizar precios",
  catalog: "Mostrar catálogo",
  leadCapture: "Captar datos del cliente",
  scheduling: "Agendar citas",
  orders: "Tomar pedidos",
  payments: "Cobrar",
  humanHandoff: "Transferir a un humano",
};

/** Pasos del asistente de configuración, en el orden real del Wizard (STEP_LABEL). */
export const PASOS_DEL_WIZARD = [
  "Tipo de negocio",
  "Personalidad",
  "Capacidades",
  "Agendamiento",
  "Servicios y productos",
  "Horarios",
  "Datos del cliente",
  "Conocimiento",
  "Reglas",
  "Transferencia",
  "Revisar y guardar",
] as const;
export type PasoWizard = (typeof PASOS_DEL_WIZARD)[number];

/**
 * Lo que el agente hace, en 7 tarjetas. `capacidades` enlaza cada tarjeta con la capacidad real del Runtime que la respalda (una tarjeta
 * general como "Responder clientes" no depende de una sola). Entre todas cubren las 6 capacidades disponibles hoy: la home no anuncia
 * pedidos ni pagos porque no existen.
 */
export const CAPACIDADES_HOME: { id: string; titulo: string; texto: string; capacidades: CapabilityKey[] }[] = [
  { id: "responder", titulo: "Responder clientes", texto: "Atiende las conversaciones por WhatsApp con el tono y las reglas que tú defines.", capacidades: [] },
  { id: "informacion", titulo: "Consultar información del negocio", texto: "Responde con tus preguntas frecuentes y documentos; si no encuentra la respuesta, no la inventa.", capacidades: ["faq"] },
  { id: "catalogo", titulo: "Mostrar catálogo", texto: "Informa tus servicios y productos con sus precios y calcula cotizaciones.", capacidades: ["catalog", "sales"] },
  { id: "agendar", titulo: "Agendar citas", texto: "Ofrece horarios libres, crea la cita y se la confirma al cliente.", capacidades: ["scheduling"] },
  { id: "calendar", titulo: "Consultar Google Calendar", texto: "Ve la disponibilidad real de tu calendario y crea allí cada cita.", capacidades: ["scheduling"] },
  { id: "leads", titulo: "Capturar leads", texto: "Pide y guarda los datos que definas para tu negocio, como nombre, teléfono y lo que necesita.", capacidades: ["leadCapture"] },
  { id: "asesor", titulo: "Transferir a una persona", texto: "Pasa la conversación a tu equipo cuando el cliente lo pide o cuando tú lo defines.", capacidades: ["humanHandoff"] },
];

/**
 * Crea tu agente: las 5 etapas del producto, en orden. `pasos` son pasos REALES del Wizard que se muestran como etiquetas (un test los
 * contrasta con STEP_LABEL). El texto de "Prueba" y "Administra" describe la vista previa simulada y el historial de versiones del panel.
 */
export const ETAPAS_CREA_TU_AGENTE: { n: string; titulo: string; texto: string; pasos: readonly PasoWizard[] }[] = [
  { n: "01", titulo: "Crea", texto: "Empiezas tu agente eligiendo el tipo de negocio y cómo se presenta.", pasos: ["Tipo de negocio", "Personalidad"] },
  {
    n: "02",
    titulo: "Configura",
    texto: "Cargas tus servicios, horarios, conocimiento y reglas con formularios del panel, sin escribir código.",
    pasos: ["Servicios y productos", "Horarios", "Conocimiento", "Reglas"],
  },
  { n: "03", titulo: "Prueba", texto: "Conversas con tu agente en una vista previa simulada: no envía WhatsApp real ni ejecuta acciones de negocio.", pasos: [] },
  {
    n: "04",
    titulo: "Publica",
    texto: "El sistema revisa que la configuración esté completa, guarda la versión y conecta el agente a tu número de WhatsApp.",
    pasos: ["Revisar y guardar"],
  },
  { n: "05", titulo: "Administra", texto: "Cambias lo que necesites cuando quieras y publicas una versión nueva; queda el historial de versiones.", pasos: [] },
];
