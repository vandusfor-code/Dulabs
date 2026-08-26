// Número de ventas/onboarding de Dulabs (ya usado en FinalCta). Con el nuevo
// enfoque del sitio -- "nosotros te configuramos el bot, no tú" -- este es el
// canal principal de entrada en toda la página, no un botón secundario.
export const WHATSAPP_VENTAS_NUMERO = "573148127388";

export function whatsappVentasUrl(mensaje: string): string {
  return `https://wa.me/${WHATSAPP_VENTAS_NUMERO}?text=${encodeURIComponent(mensaje)}`;
}

export const MENSAJE_WHATSAPP_GENERICO_ES = "Hola, quiero información sobre WhatsApp con IA.";
export const MENSAJE_WHATSAPP_GENERICO_EN = "Hi, I'd like information about WhatsApp with AI.";

export const MENSAJE_WHATSAPP_ENTERPRISE_ES = "Hola, quiero hablar sobre un proyecto para mi empresa.";
export const MENSAJE_WHATSAPP_ENTERPRISE_EN = "Hi, I'd like to talk about a project for my company.";

export const MENSAJE_WHATSAPP_CONTACTO_ES = "Hola, quiero conocer las soluciones de DuLabs.";
export const MENSAJE_WHATSAPP_CONTACTO_EN = "Hi, I'd like to learn about DuLabs' solutions.";

export function mensajePlanWhatsapp(nombrePlan: string, lang: "es" | "en"): string {
  return lang === "en"
    ? `Hi, I'd like to get the ${nombrePlan} plan and have Dulabs set up my WhatsApp bot 🙌`
    : `Hola, quiero el plan ${nombrePlan} y que me configuren mi bot de WhatsApp 🙌`;
}
