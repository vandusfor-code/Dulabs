// Destinos y textos de CTA de la home principal (v3), centralizados para no duplicarlos entre navbar, hero y secciones, y para que
// los tests verifiquen contra un solo origen. NO define precios ni planes: eso vive solo en lib/planes.ts.
import { MENSAJE_WHATSAPP_CONTACTO_ES, whatsappVentasUrl } from "@/lib/site-contact";

/** Ruta temporal de la versión nueva (noindex). Al promoverla, esta página pasa a ser "/". */
export const HOME_V3_PATH = "/home-v3";

/**
 * "Crear mi agente de IA": el camino real de autoservicio ya existente = registro -> pago del plan -> conectar WhatsApp -> panel
 * (Business Agent). Es el mismo destino del botón "Comenzar con DuLabs" del plan Essential (PlanButton); el checkout no tiene
 * selector de plan, así que los otros planes se eligen desde la sección de precios.
 */
export const CREAR_AGENTE_HREF = "/login?plan=essential";

/** Ruta comercial para empresas (página existente). */
export const ENTERPRISE_HREF = "/soluciones-empresariales";

/** "Hablar con DuLabs": WhatsApp de ventas (mismo canal y helper que el resto del sitio). */
export const HABLAR_CON_DULABS_HREF = whatsappVentasUrl(MENSAJE_WHATSAPP_CONTACTO_ES);

export const LOGIN_HREF = "/login";

/**
 * Navegación principal: páginas reales del sitio (enlazado interno hacia el clúster SEO, con texto descriptivo).
 * Las secciones de la propia home se recorren con scroll, no necesitan entrada de menú.
 */
export const HOME_NAV_LINKS: { label: string; href: string }[] = [
  { label: "WhatsApp con IA", href: "/whatsapp-ia" },
  { label: "Automatización", href: "/automatizacion-empresas" },
  { label: "Empresas", href: ENTERPRISE_HREF },
  { label: "Precios", href: "/precios" },
  { label: "Developers", href: "/developer-platform" },
];
