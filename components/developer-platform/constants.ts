// DuLabs Developer V1 -- Fase 15. Constantes canónicas de la landing comercial
// (/developer-platform). Centralizadas para no duplicar destinos de CTA ni
// romper los flujos existentes, y para que los tests verifiquen contra un solo
// origen.

/** Landing comercial pública. */
export const LANDING_PATH = "/developer-platform";

/** CTA "Comenzar" / "Get API Key": registro completo de DuLabs Developer
 *  (nombre, empresa, WhatsApp, correo). Tras confirmar el correo e iniciar
 *  sesión, el dashboard auto-provisiona cuenta + workspace + membership OWNER. */
export const START_HREF = "/developer-platform/registro";

/** CTA de documentación: portal público de docs (Fase 14). */
export const DOCS_HREF = "/developers";

/** Inicio de sesión de developers. El login compartido acepta ?next para
 *  volver al dashboard privado tras autenticar (mismo destino que usa el flujo
 *  de registro al confirmar el correo). */
export const LOGIN_HREF = "/login?next=/developer";

/** Base URL pública del API (misma que el OpenAPI de Fase 14). Solo display.
 *  Fuente de verdad única en lib/developers/api-base.ts. */
export { DEVELOPER_API_BASE_URL as API_BASE_URL } from "@/lib/developers/api-base";

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
