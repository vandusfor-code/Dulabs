import type { PlanId } from "@/lib/planes";

// Copy de marketing de /precios — separada de lib/planes.ts a propósito:
// esto es texto para mostrar, nunca se usa para enforcement. Cada bullet
// describe algo que el producto REALMENTE hace hoy (nada de "adorno":
// ninguna función que no exista en el código, como API pública,
// integraciones, roles personalizados o auditoría, aparece aquí).
//
// "campanas" va aparte de "features" a propósito: en la tarjeta se muestra
// como un bloque propio con su aclaración de que el envío no está incluido
// (Meta cobra aparte) -- nunca como un checkmark más, para que no se lea
// como "campañas gratis incluidas".
export const PRICING_COPY: Record<
  PlanId,
  {
    tag: { es: string; en: string };
    features: { es: string; en: string }[];
    campanas: { porMes: { es: string; en: string }; destinatarios: { es: string; en: string } };
    boton: { es: string; en: string };
  }
> = {
  start: {
    tag: { es: "Para empezar a atender por WhatsApp con IA.", en: "To start handling WhatsApp with AI." },
    features: [
      { es: "1 número de WhatsApp", en: "1 WhatsApp number" },
      { es: "1 agente de IA", en: "1 AI agent" },
      { es: "1.000 respuestas de IA / mes", en: "1,000 AI replies / month" },
      { es: "Base de conocimiento", en: "Knowledge base" },
      { es: "Configuración personalizada del agente", en: "Custom agent configuration" },
      { es: "Plantillas con botones y variables", en: "Templates with buttons and variables" },
      { es: "Soporte por correo", en: "Email support" },
    ],
    campanas: {
      porMes: { es: "Hasta 8 campañas configurables al mes", en: "Up to 8 configurable campaigns per month" },
      destinatarios: { es: "Hasta 500 destinatarios por campaña", en: "Up to 500 recipients per campaign" },
    },
    boton: { es: "Comenzar con DuLabs →", en: "Start with DuLabs →" },
  },
  growth: {
    tag: { es: "Para negocios que manejan varias líneas de WhatsApp.", en: "For businesses running more than one WhatsApp line." },
    features: [
      { es: "Hasta 2 números de WhatsApp", en: "Up to 2 WhatsApp numbers" },
      { es: "Hasta 3 agentes de IA", en: "Up to 3 AI agents" },
      { es: "2.500 respuestas de IA / mes", en: "2,500 AI replies / month" },
      { es: "Hasta 5 usuarios", en: "Up to 5 users" },
      { es: "Base de conocimiento", en: "Knowledge base" },
      { es: "Configuración personalizada del agente", en: "Custom agent configuration" },
      { es: "Encuestas por WhatsApp", en: "WhatsApp surveys" },
      { es: "Soporte prioritario", en: "Priority support" },
    ],
    campanas: {
      porMes: { es: "Hasta 15 campañas configurables al mes", en: "Up to 15 configurable campaigns per month" },
      destinatarios: { es: "Hasta 5.000 destinatarios por campaña", en: "Up to 5,000 recipients per campaign" },
    },
    boton: { es: "Elegir Growth →", en: "Choose Growth →" },
  },
  scale: {
    tag: { es: "Para operaciones con mayor volumen y varios equipos.", en: "For higher-volume operations with multiple teams." },
    features: [
      { es: "Hasta 5 números de WhatsApp", en: "Up to 5 WhatsApp numbers" },
      { es: "Agentes de IA ilimitados", en: "Unlimited AI agents" },
      { es: "9.000 respuestas de IA / mes", en: "9,000 AI replies / month" },
      { es: "Hasta 20 usuarios", en: "Up to 20 users" },
      { es: "Base de conocimiento", en: "Knowledge base" },
      { es: "Configuración personalizada", en: "Custom configuration" },
      { es: "Insights de IA", en: "AI insights" },
      { es: "Soporte prioritario", en: "Priority support" },
      { es: "Onboarding personalizado", en: "Personalized onboarding" },
    ],
    campanas: {
      porMes: { es: "Campañas configurables sin límite", en: "Unlimited configurable campaigns" },
      destinatarios: { es: "Hasta 50.000 destinatarios por campaña", en: "Up to 50,000 recipients per campaign" },
    },
    boton: { es: "Hablar con DuLabs →", en: "Talk to DuLabs →" },
  },
  enterprise: {
    tag: { es: "Empresas con necesidades a la medida.", en: "Companies with custom needs." },
    features: [
      { es: "Todo lo de Scale", en: "Everything in Scale" },
      { es: "Números, usuarios y agentes ilimitados", en: "Unlimited numbers, users and agents" },
      { es: "Respuestas de IA y campañas a medida", en: "Custom AI replies and campaigns" },
      { es: "Soporte dedicado", en: "Dedicated support" },
    ],
    campanas: {
      porMes: { es: "Campañas a medida", en: "Custom campaigns" },
      destinatarios: { es: "Volumen de destinatarios a medida", en: "Custom recipient volume" },
    },
    boton: { es: "Hablar con ventas →", en: "Talk to sales →" },
  },
};
