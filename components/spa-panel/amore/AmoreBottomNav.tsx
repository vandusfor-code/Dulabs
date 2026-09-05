"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CalendarDays, Users, Sparkles, MoreHorizontal, Plus } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { rutaInicio, rutaCitas, rutaClientes, rutaServicios, esRutaActiva } from "./amore-routes";

// AMORE (Fase "sistema completo", autorizado) — navegación inferior fija
// con el botón central "+" elevado. "+" abre el mismo NewAppointmentModal
// real montado en AmoreDashboardShell (abrirNueva ya existe en
// useAgenda(), reutilizado tal cual de Daniela) -- funciona desde
// cualquier pantalla, no solo desde Citas.
export function AmoreBottomNav({ onAbrirMenu }: { onAbrirMenu: () => void }) {
  const { token, abrirNueva } = useAgenda();
  const pathname = usePathname();

  const item = (icono: React.ReactNode, label: string, href: string, activo: boolean) => (
    <Link
      href={href}
      className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium ${
        activo ? "text-lime-text" : "text-mist"
      }`}
    >
      {icono}
      {label}
    </Link>
  );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[430px] border-t border-edge bg-card pb-[env(safe-area-inset-bottom)]">
      <div className="relative flex items-center px-2">
        {item(<Home className="size-5" />, "Inicio", rutaInicio(token), pathname === rutaInicio(token))}
        {item(<CalendarDays className="size-5" />, "Citas", rutaCitas(token), esRutaActiva(pathname, rutaCitas(token)))}
        {item(<Users className="size-5" />, "Clientes", rutaClientes(token), esRutaActiva(pathname, rutaClientes(token)))}
        {item(<Sparkles className="size-5" />, "Servicios", rutaServicios(token), esRutaActiva(pathname, rutaServicios(token)))}

        <button
          type="button"
          onClick={onAbrirMenu}
          className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium text-mist"
        >
          <MoreHorizontal className="size-5" />
          Más
        </button>
      </div>

      <button
        type="button"
        onClick={() => abrirNueva()}
        aria-label="Nueva cita"
        className="absolute left-1/2 -top-6 flex size-14 -translate-x-1/2 items-center justify-center rounded-full bg-lime text-white shadow-[0_6px_16px_rgba(184,92,120,0.4)]"
      >
        <Plus className="size-6" />
      </button>
    </nav>
  );
}
