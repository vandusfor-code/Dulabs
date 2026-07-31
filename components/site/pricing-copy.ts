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
      { es: "1 usuario", en: "1 user" },
      { es: "Bandeja de entrada web", en: "Web inbox" },
      { es: "Hasta 500 contactos por envío", en: "Up to 500 contacts per send" },
      { es: "Soporte por correo", en: "Email support" },
    ],
  },
  growth: {
    tag: { es: "Negocios en crecimiento con más de un canal.", en: "Growing businesses with more than one channel." },
    features: [
      { es: "Todo lo de Start", en: "Everything in Start" },
      { es: "Hasta 2 números de WhatsApp", en: "Up to 2 WhatsApp numbers" },
      { es: "Hasta 3 agentes de IA", en: "Up to 3 AI agents" },
      { es: "Hasta 5 usuarios", en: "Up to 5 users" },
      { es: "Plantillas con botones y variables", en: "Templates with buttons and variables" },
      { es: "Bot de encuestas por WhatsApp", en: "WhatsApp survey bot" },
      { es: "Hasta 5.000 contactos por envío", en: "Up to 5,000 contacts per send" },
      { es: "Hasta 3 campañas simultáneas", en: "Up to 3 simultaneous campaigns" },
    ],
  },
  scale: {
    tag: { es: "Operaciones con varios equipos y números.", en: "Operations with multiple teams and numbers." },
    features: [
      { es: "Todo lo de Growth", en: "Everything in Growth" },
      { es: "Hasta 5 números de WhatsApp", en: "Up to 5 WhatsApp numbers" },
      { es: "Agentes de IA ilimitados", en: "Unlimited AI agents" },
      { es: "Hasta 20 usuarios", en: "Up to 20 users" },
      { es: "Hasta 50.000 contactos por envío", en: "Up to 50,000 contacts per send" },
      { es: "Hasta 10 campañas simultáneas", en: "Up to 10 simultaneous campaigns" },
      { es: "Soporte prioritario", en: "Priority support" },
    ],
  },
  enterprise: {
    tag: { es: "Empresas con necesidades a la medida.", en: "Companies with custom needs." },
    features: [
      { es: "Todo lo de Scale", en: "Everything in Scale" },
      { es: "Números, usuarios y agentes ilimitados", en: "Unlimited numbers, users and agents" },
      { es: "Contactos y campañas simultáneas ilimitadas", en: "Unlimited contacts and simultaneous campaigns" },
      { es: "Soporte dedicado", en: "Dedicated support" },
    ],
  },
};
