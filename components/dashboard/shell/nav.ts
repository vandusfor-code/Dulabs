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
  labelEn: string;
  href: string;
  icon: LucideIcon;
};

export type NavSection = {
  title: string;
  titleEn: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    title: "Operar",
    titleEn: "Operate",
    items: [
      { label: "Resumen", labelEn: "Overview", href: "/dashboard", icon: LayoutGrid },
      { label: "Mensajes", labelEn: "Messages", href: "/dashboard/mensajes", icon: MessagesSquare },
      { label: "Agentes de IA", labelEn: "AI agents", href: "/dashboard/agentes", icon: Bot },
    ],
  },
  {
    title: "Crear",
    titleEn: "Create",
    items: [
      { label: "Plantillas", labelEn: "Templates", href: "/dashboard/plantillas", icon: LayoutTemplate },
      { label: "Campañas", labelEn: "Campaigns", href: "/dashboard/campanas", icon: Send },
    ],
  },
  {
    title: "Infraestructura",
    titleEn: "Infrastructure",
    items: [
      { label: "Números", labelEn: "Numbers", href: "/dashboard/conexion", icon: Phone },
      { label: "Analytics", labelEn: "Analytics", href: "/dashboard/analytics", icon: ChartNoAxesCombined },
    ],
  },
];
