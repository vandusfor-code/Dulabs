import {
  LayoutGrid,
  MessagesSquare,
  Bot,
  LayoutTemplate,
  Send,
  Phone,
  ChartNoAxesCombined,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    title: "Operar",
    items: [
      { label: "Resumen", href: "/dashboard", icon: LayoutGrid },
      { label: "Mensajes", href: "/dashboard/mensajes", icon: MessagesSquare },
      { label: "Agentes de IA", href: "/dashboard/agentes", icon: Bot },
    ],
  },
  {
    title: "Crear",
    items: [
      { label: "Plantillas", href: "/dashboard/plantillas", icon: LayoutTemplate },
      { label: "Campañas", href: "/dashboard/campanas", icon: Send },
    ],
  },
  {
    title: "Infraestructura",
    items: [
      { label: "Números", href: "/dashboard/conexion", icon: Phone },
      { label: "Analytics", href: "/dashboard/analytics", icon: ChartNoAxesCombined },
    ],
  },
];
