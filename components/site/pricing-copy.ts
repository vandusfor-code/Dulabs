import type { PlanId } from "@/lib/planes";

// Copy de marketing de /precios — separada de lib/planes.ts a propósito:
// esto es texto para mostrar, nunca se usa para enforcement. Cada bullet
// describe algo que el producto REALMENTE hace hoy (nada de "adorno":
// ninguna función que no exista en el código, como API pública,
// integraciones, roles personalizados o auditoría, aparece aquí).
export const PRICING_COPY: Record<PlanId, { tag: { es: string; en: string }; features: { es: string; en: string }[] }> = {
  start: {
    tag: { es: "Para empezar a atender por WhatsApp con IA.", en: "To start handling WhatsApp with AI." },
    features: [
      { es: "1 número de WhatsApp", en: "1 WhatsApp number" },
      { es: "1 agente de IA (Claude)", en: "1 AI agent (Claude)" },
      { es: "1.000 mensajes de IA al mes", en: "1,000 AI messages per month" },
      { es: "Base de conocimiento (PDF, Excel, CSV)", en: "Knowledge base (PDF, Excel, CSV)" },
      { es: "Plantillas con botones y variables", en: "Templates with buttons and variables" },
      { es: "Hasta 8 campañas al mes (500 contactos c/u)", en: "Up to 8 campaigns per month (500 contacts each)" },
      { es: "Soporte por correo", en: "Email support" },
    ],
  },
  growth: {
    tag: { es: "Negocios en crecimiento con más de un canal.", en: "Growing businesses with more than one channel." },
    features: [
      { es: "Todo lo de Start", en: "Everything in Start" },
      { es: "Hasta 2 números de WhatsApp", en: "Up to 2 WhatsApp numbers" },
      { es: "Hasta 3 agentes de IA", en: "Up to 3 AI agents" },
      { es: "2.500 mensajes de IA al mes", en: "2,500 AI messages per month" },
      { es: "Hasta 5 usuarios", en: "Up to 5 users" },
      { es: "Encuestas por WhatsApp con resultados y embudo", en: "WhatsApp surveys with results and funnel" },
      { es: "Hasta 15 campañas al mes (5.000 contactos c/u)", en: "Up to 15 campaigns per month (5,000 contacts each)" },
      { es: "Soporte por correo prioritario", en: "Priority email support" },
    ],
  },
  scale: {
    tag: { es: "Operaciones con varios equipos y números.", en: "Operations with multiple teams and numbers." },
    features: [
      { es: "Todo lo de Growth", en: "Everything in Growth" },
      { es: "Hasta 5 números de WhatsApp", en: "Up to 5 WhatsApp numbers" },
      { es: "Agentes de IA ilimitados", en: "Unlimited AI agents" },
      { es: "9.000 mensajes de IA al mes", en: "9,000 AI messages per month" },
      { es: "Hasta 20 usuarios", en: "Up to 20 users" },
      { es: "Insights de IA en encuestas (análisis de sentimiento)", en: "AI survey insights (sentiment analysis)" },
      { es: "Campañas sin límite (50.000 contactos c/u)", en: "Unlimited campaigns (50,000 contacts each)" },
      { es: "Soporte prioritario + onboarding", en: "Priority support + onboarding" },
    ],
  },
  enterprise: {
    tag: { es: "Empresas con necesidades a la medida.", en: "Companies with custom needs." },
    features: [
      { es: "Todo lo de Scale", en: "Everything in Scale" },
      { es: "Números, usuarios y agentes ilimitados", en: "Unlimited numbers, users and agents" },
      { es: "Mensajes de IA y campañas a medida", en: "Custom AI messages and campaigns" },
      { es: "Soporte dedicado", en: "Dedicated support" },
    ],
  },
};
