"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Home,
  CalendarDays,
  Users,
  Sparkles,
  UserRound,
  Wallet,
  Cake,
  Heart,
  Bell,
  MessageCircle,
  Settings,
  ChevronDown,
  LogOut,
  User,
} from "lucide-react";
import { useAdminWeb } from "./AdminWebContext";
import {
  RUTA_INICIO,
  RUTA_CITAS,
  RUTA_CLIENTES,
  RUTA_SERVICIOS,
  RUTA_EQUIPO,
  RUTA_CONTABILIDAD,
  RUTA_CUMPLEANOS,
  RUTA_FIDELIZACION,
  RUTA_COMUNICACIONES,
  RUTA_WHATSAPP,
  RUTA_CONFIGURACION,
  RUTA_PERFIL,
  esRutaActiva,
} from "./admin-web-routes";

// Panel web AMORE (autorizado) — nav completa para administrador. NOTA
// (reportada en el reporte final): el mockup pedía "Desempeño" y "Pagos y
// Comisiones" como entradas separadas de "Reportes" -- pero las tres
// muestran exactamente el MISMO reporte real (lib/contabilidad/reporte.ts),
// solo con distinto foco. Se unifican en un solo "Contabilidad" con
// pestañas internas en vez de fragmentar el sidebar en 3 módulos que
// apuntarían al mismo backend -- eso sí sería inventar módulos falsos.
type ItemNav = { label: string; icon: typeof Home; href: string; exact: boolean };

const ITEMS_ADMIN: ItemNav[] = [
  { label: "Inicio", icon: Home, href: RUTA_INICIO, exact: true },
  { label: "Citas", icon: CalendarDays, href: RUTA_CITAS, exact: false },
  { label: "Clientes", icon: Users, href: RUTA_CLIENTES, exact: false },
  { label: "Servicios", icon: Sparkles, href: RUTA_SERVICIOS, exact: false },
  { label: "Trabajadoras", icon: UserRound, href: RUTA_EQUIPO, exact: false },
  { label: "Contabilidad", icon: Wallet, href: RUTA_CONTABILIDAD, exact: false },
  { label: "Cumpleaños", icon: Cake, href: RUTA_CUMPLEANOS, exact: false },
  { label: "Fidelización", icon: Heart, href: RUTA_FIDELIZACION, exact: false },
  { label: "Recordatorios", icon: Bell, href: RUTA_COMUNICACIONES, exact: false },
  { label: "WhatsApp", icon: MessageCircle, href: RUTA_WHATSAPP, exact: false },
  { label: "Configuración", icon: Settings, href: RUTA_CONFIGURACION, exact: false },
];

// Login AMORE (autorizado) — una colaboradora SOLO ve estos 3 destinos, sin
// importar qué escriba en la URL: la protección real ya vive server-side
// (cada API sigue exigiendo requiereAdministrador/requireSpecialistScope),
// esto es puramente de navegación.
const ITEMS_COLABORADORA: ItemNav[] = [
  { label: "Mi día", icon: Home, href: RUTA_INICIO, exact: true },
  { label: "Mis citas", icon: CalendarDays, href: RUTA_CITAS, exact: false },
  { label: "Mi perfil", icon: User, href: RUTA_PERFIL, exact: false },
];

export function DesktopSidebar() {
  const { datos } = useAdminWeb();
  const pathname = usePathname();
  const router = useRouter();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const sesion = datos.sesion;
  const items = sesion?.rol === "colaboradora" ? ITEMS_COLABORADORA : ITEMS_ADMIN;

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-edge bg-card">
      <div className="flex flex-col items-center gap-1 px-6 pb-5 pt-7">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo de marca, no aplica optimización */}
        <img src="/amore/logo.png" alt="AMORE Salón de Belleza" width={2067} height={761} className="h-auto w-[150px] object-contain" />
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        <div className="flex flex-col gap-0.5">
          {items.map(({ label, icon: Icon, href, exact }) => {
            const activo = exact === true ? pathname === href : esRutaActiva(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  activo ? "bg-lime-soft text-lime-text" : "text-fg hover:bg-ink-2"
                }`}
              >
                <Icon className="size-[18px] shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-edge px-3 py-3">
        <button
          type="button"
          onClick={() => setMenuAbierto((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-ink-2"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime-soft text-sm font-semibold text-lime-text">
            {(sesion?.nombre ?? datos.especialista.nombre).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{sesion?.nombre ?? datos.especialista.nombre}</p>
            <p className="truncate text-xs text-mist">{sesion?.rol === "administrador" ? "Administradora" : "Colaboradora"}</p>
          </div>
          <ChevronDown className="size-4 shrink-0 text-mist" />
        </button>

        {menuAbierto && (
          <div className="mt-1.5 flex flex-col gap-0.5 rounded-xl border border-edge bg-card p-1.5 shadow-sm">
            <Link
              href={RUTA_PERFIL}
              onClick={() => setMenuAbierto(false)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg hover:bg-ink-2"
            >
              <User className="size-4" /> Mi perfil
            </Link>
            {sesion?.rol !== "colaboradora" && (
              <Link
                href={RUTA_CONFIGURACION}
                onClick={() => setMenuAbierto(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg hover:bg-ink-2"
              >
                <Settings className="size-4" /> Configuración
              </Link>
            )}
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/agenda-auth/logout", { method: "POST" });
                router.push("/amore/login");
              }}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-danger-text hover:bg-danger"
            >
              <LogOut className="size-4" /> Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
