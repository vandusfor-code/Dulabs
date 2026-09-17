// DuLabs Developer V1 -- Fase 15. Constantes canónicas de la landing comercial
// (/developer-platform). Centralizadas para no duplicar destinos de CTA ni
// romper los flujos existentes, y para que los tests verifiquen contra un solo
// origen.

/** Landing comercial pública. */
export const LANDING_PATH = "/developer-platform";

/** CTA "Comenzar" / "Get API Key": entra al login y regresa al dashboard
 *  privado (flujo de onboarding ya existente). NO enlaza directo a /developer
 *  (privado) para no exponer una ruta que redirige a login igual. */
export const START_HREF = "/login?next=/developer";

/** CTA de documentación: portal público de docs (Fase 14). */
export const DOCS_HREF = "/developers";

/** Base URL pública del API (misma que el OpenAPI de Fase 14). Solo display. */
export const API_BASE_URL = "https://api.dulabs.dev/api/v1";

/** Anclas de secciones para el nav de la landing. */
export const SECTION_IDS = {
  plataforma: "plataforma",
  api: "api",
  webhooks: "webhooks",
  pricing: "pricing",
  docs: "docs",
} as const;

/** Correo de ventas para Enterprise. Fallback seguro si la env no existe
 *  (nunca rompe la página; NEXT_PUBLIC_* se inlinea en build). */
export function correoVentas(): string {
  return process.env.NEXT_PUBLIC_DEVELOPER_SALES_EMAIL || "contacto@dulabs.co";
}

/** mailto de Enterprise con asunto prellenado. */
export function mailtoVentas(asunto: string): string {
  return `mailto:${correoVentas()}?subject=${encodeURIComponent(asunto)}`;
}
