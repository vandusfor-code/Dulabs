import {
  LayoutGrid,
  MessagesSquare,
  Waypoints,
  LayoutTemplate,
  Send,
  ClipboardList,
  Phone,
  ChartNoAxesCombined,
  Users,
  Zap,
  ShoppingCart,
  ShieldCheck,
  Workflow,
  Blocks,
  Package,
  Contact,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import type { Rol } from "@/lib/team";
import type { ModuloId } from "@/lib/tenant-modulos";

export type NavItem = {
  label: string;
  labelEn: string;
  href: string;
  icon: LucideIcon;
  rolesPermitidos?: Rol[]; // undefined = visible a todos los roles
  /** Solo visible si el tenant tiene este módulo habilitado (dulabs_tenant_modulos). undefined = siempre. */
  modulo?: ModuloId;
};

/** Visibilidad de un ítem del nav (Sidebar y CommandPalette usan la MISMA regla). Solo presentación: cada endpoint autoriza por su cuenta. */
export function navItemVisible(item: NavItem, rol: Rol | null, modulos: readonly ModuloId[]): boolean {
  if (item.rolesPermitidos && !(rol && item.rolesPermitidos.includes(rol))) return false;
  if (item.modulo && !modulos.includes(item.modulo)) return false;
  return true;
}

export type NavSection = {
  title: string;
  titleEn: string;
  items: NavItem[];
  /** Solo visible para admins del tenant DuLabs (ver lib/admin-tenant.ts) -- distinto de rolesPermitidos, que es por rol dentro de CUALQUIER tenant. */
  soloAdminDulabs?: boolean;
};

export const navSections: NavSection[] = [
  {
    title: "Operar",
    titleEn: "Operate",
    items: [
      { label: "Resumen", labelEn: "Overview", href: "/dashboard", icon: LayoutGrid },
      { label: "Mensajes", labelEn: "Messages", href: "/dashboard/mensajes", icon: MessagesSquare },
      {
        label: "Respuestas rápidas",
        labelEn: "Quick replies",
        href: "/dashboard/respuestas-rapidas",
        icon: Zap,
        rolesPermitidos: ["admin", "agente"],
      },
      { label: "Agentes de IA", labelEn: "AI agents", href: "/dashboard/agentes", icon: Waypoints },
      // Clientes de Publi Bordados (autorizado) -- módulo propio de ese negocio,
      // visible solo para tenants con "publibordados_clientes" habilitado
      // (dulabs_tenant_modulos). La API autoriza por su cuenta.
      {
        label: "Solicitudes",
        labelEn: "Requests",
        href: "/dashboard/publibordados/solicitudes",
        icon: Inbox,
        modulo: "publibordados_clientes",
      },
      {
        label: "Clientes",
        labelEn: "Customers",
        href: "/dashboard/publibordados/clientes",
        icon: Contact,
        modulo: "publibordados_clientes",
      },
    ],
  },
  {
    title: "Crear",
    titleEn: "Create",
    items: [
      {
        label: "Business Agent",
        labelEn: "Business Agent",
        href: "/dashboard/business-agent",
        icon: Blocks,
        rolesPermitidos: ["admin", "agente"],
      },
      // Catálogo (autorizado) -- fuente de verdad de productos. Visible para
      // todos los roles del tenant (lectura incluida); solo admin edita
      // (lo exige el backend, lib/catalogo/auth.ts).
      { label: "Catálogo", labelEn: "Catalog", href: "/dashboard/catalogo", icon: Package, modulo: "catalogo" },
      { label: "Plantillas", labelEn: "Templates", href: "/dashboard/plantillas", icon: LayoutTemplate },
      { label: "Campañas", labelEn: "Campaigns", href: "/dashboard/campanas", icon: Send },
      { label: "Encuestas", labelEn: "Surveys", href: "/dashboard/surveys", icon: ClipboardList },
      {
        label: "Flows",
        labelEn: "Flows",
        href: "/dashboard/flows",
        icon: Workflow,
        rolesPermitidos: ["admin", "agente"],
      },
      {
        label: "Marketplace",
        labelEn: "Marketplace",
        href: "/dashboard/marketplace",
        icon: ShoppingCart,
        rolesPermitidos: ["admin"],
      },
    ],
  },
  {
    title: "Infraestructura",
    titleEn: "Infrastructure",
    items: [
      { label: "Números", labelEn: "Numbers", href: "/dashboard/conexion", icon: Phone },
      { label: "Analytics", labelEn: "Analytics", href: "/dashboard/analytics", icon: ChartNoAxesCombined },
      { label: "Equipo", labelEn: "Team", href: "/dashboard/equipo", icon: Users, rolesPermitidos: ["admin"] },
    ],
  },
  {
    title: "Operaciones DuLabs",
    titleEn: "DuLabs Operations",
    soloAdminDulabs: true,
    items: [
      // F15.2 (Operations Center, cierre) -- apuntaba al admin legacy
      // (/dashboard/admin/*, eliminado esta fase); /admin es el único
      // Centro de Operaciones desde F15.
      { label: "Panel Admin", labelEn: "Admin panel", href: "/admin", icon: ShieldCheck },
      { label: "Clientes", labelEn: "Clients", href: "/admin/clientes", icon: Users },
    ],
  },
];
