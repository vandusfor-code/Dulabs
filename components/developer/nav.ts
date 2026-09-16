// DuLabs Developer V1 -- Fase 9. Configuración de navegación del Dashboard.
// Data pura (sin JSX) para poder testearla y reutilizarla.

export type NavItem = { label: string; href: string; icon: string };
export type NavSection = { title: string | null; items: NavItem[] };

export const DEV_NAV: NavSection[] = [
  { title: null, items: [{ label: "Overview", href: "/developer", icon: "grid" }] },
  {
    title: "Build",
    items: [
      { label: "Flows", href: "/developer/flows", icon: "flow" },
      { label: "API", href: "/developer/api", icon: "code" },
      { label: "WhatsApp Numbers", href: "/developer/whatsapp", icon: "phone" },
      { label: "Webhooks", href: "/developer/webhooks", icon: "webhook" },
    ],
  },
  {
    title: "Observe",
    items: [
      { label: "Jobs / Logs", href: "/developer/jobs", icon: "logs" },
      { label: "Usage", href: "/developer/usage", icon: "gauge" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { label: "API Keys", href: "/developer/api-keys", icon: "key" },
      { label: "Members", href: "/developer/members", icon: "users" },
      { label: "Settings", href: "/developer/settings", icon: "settings" },
    ],
  },
];

/** true si `href` es la ruta activa para `pathname` (exacta para Overview, prefijo para el resto). */
export function esRutaActiva(href: string, pathname: string): boolean {
  if (href === "/developer") return pathname === "/developer";
  return pathname === href || pathname.startsWith(`${href}/`);
}
