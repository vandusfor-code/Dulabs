// Fuente única de lo que la home afirma que el agente HACE y de cómo se llaman los pasos del Wizard. Un test (home-v3.test.tsx) verifica
// contra el código real que: (1) cada capacidad usada aquí existe y está disponible en CAPABILITY_BACKING, (2) cada etiqueta coincide con
// la del Wizard (components/dashboard/business-agent/Wizard.tsx). Si el producto cambia, la home no puede quedarse afirmando algo viejo.
import type { CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";

/** Etiquetas EXACTAS que muestra el Wizard para cada capacidad (CAPABILITY_LABELS). */
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

/** Lo que el cliente escribe -> lo que el agente ejecuta. Cada fila usa solo capacidades con respaldo real en el Runtime. */
export const ACCIONES_DEL_AGENTE: { pide: string; ejecuta: string; capacidad: CapabilityKey }[] = [
  { pide: "¿Cuánto cuesta el pedicure?", ejecuta: "Consulta el catálogo y responde con el precio guardado.", capacidad: "catalog" },
  { pide: "¿Tienen espacio el jueves en la tarde?", ejecuta: "Consulta la disponibilidad real en tu calendario y agenda el horario que el cliente elige.", capacidad: "scheduling" },
  { pide: "Necesito cambiar mi cita.", ejecuta: "Cancela o reprograma las citas de ese cliente en tu Google Calendar.", capacidad: "scheduling" },
  { pide: "¿Qué dice la política de cancelación?", ejecuta: "Busca la respuesta en tus preguntas frecuentes y documentos.", capacidad: "faq" },
  { pide: "¿Cuánto sería manicure y pedicure?", ejecuta: "Calcula la cotización con tus precios reales.", capacidad: "sales" },
  { pide: "Soy Ana, mi correo es ana@correo.com", ejecuta: "Pide y guarda los datos que definiste para tu negocio.", capacidad: "leadCapture" },
  { pide: "Quiero hablar con una persona.", ejecuta: "Transfiere la conversación a tu equipo y el agente deja de responder ese chat.", capacidad: "humanHandoff" },
];

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

/** Pasos que la home muestra como panel interactivo (el resto aparece en la lista, sin panel). */
export const PASOS_CON_PANEL = ["Capacidades", "Agendamiento", "Servicios y productos", "Horarios", "Datos del cliente", "Conocimiento", "Reglas", "Transferencia"] as const;
