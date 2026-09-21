// Rubros de la home. Los nombres salen de BUSINESS_TYPE_OPTIONS (lib/business-agent-form.ts): son EXACTAMENTE los tipos de negocio que el Wizard
// ofrece al crear un agente. "Joyerías" no es una opción del producto: cae bajo "Tienda / Retail". Cada fila combina solo capacidades con
// respaldo real; Restaurante y Tienda NO toman pedidos (el agente cotiza y pasa la conversación al equipo). Un test lo contrasta con el código.
import type { CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";

export type Rubro = { tipos: string[]; resuelve: string; capacidades: CapabilityKey[] };

export const RUBROS: Rubro[] = [
  {
    tipos: ["Barbería / Peluquería", "Salón de belleza / Uñas", "Spa / Estética"],
    resuelve: "Servicios con duración y precio, disponibilidad real y citas que se crean solas en tu calendario.",
    capacidades: ["scheduling", "catalog"],
  },
  {
    tipos: ["Consultorio / Clínica"],
    resuelve: "Citas, preguntas frecuentes y los datos del cliente que definas; pasa el caso a una persona cuando hace falta.",
    capacidades: ["scheduling", "faq", "humanHandoff"],
  },
  {
    tipos: ["Fotografía / Estudio", "Gimnasio / Fitness", "Educación / Cursos"],
    resuelve: "Horarios, tarifas y reservas de sesiones o clases, con la información de tus programas cargada desde tus documentos.",
    capacidades: ["scheduling", "faq"],
  },
  {
    tipos: ["Restaurante", "Tienda / Retail"],
    resuelve: "Menú o catálogo con precios, cotizaciones y preguntas frecuentes. Para concretar el pedido, pasa la conversación a tu equipo.",
    capacidades: ["catalog", "sales", "humanHandoff"],
  },
  {
    tipos: ["Servicios profesionales"],
    resuelve: "Capta los datos del cliente, responde con la información de tu firma o consultorio y agenda reuniones.",
    capacidades: ["leadCapture", "faq", "scheduling"],
  },
];
