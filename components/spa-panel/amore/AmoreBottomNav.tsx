"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CalendarDays, Users, Sparkles, MoreHorizontal, Plus, CalendarPlus, Store } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { rutaInicio, rutaCitas, rutaClientes, rutaServicios, esRutaActiva } from "./amore-routes";

// AMORE (Fase "sistema completo", autorizado) — navegación inferior fija
// con el botón central "+" elevado. "+" abre el mismo NewAppointmentModal
// real montado en AmoreDashboardShell (abrirNueva ya existe en
// useAgenda(), reutilizado tal cual de Daniela) -- funciona desde
// cualquier pantalla, no solo desde Citas. Ahora el "+" ofrece dos acciones: agendar una cita nueva o registrar un
// servicio PRESENCIAL (clienta que llegó sin cita, ver ServicioPresencialModal).
export function AmoreBottomNav({ onAbrirMenu }: { onAbrirMenu: () => void }) {
  const { token, abrirNueva, abrirServicioPresencial } = useAgenda();
  const pathname = usePathname();
  const [acciones, setAcciones] = useState(false);

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
        onClick={() => setAcciones((a) => !a)}
        aria-label="Agregar"
        aria-expanded={acciones}
        className="absolute left-1/2 -top-6 flex size-14 -translate-x-1/2 items-center justify-center rounded-full bg-lime text-white shadow-[0_6px_16px_rgba(184,92,120,0.4)]"
      >
        <Plus className={`size-6 transition-transform ${acciones ? "rotate-45" : ""}`} />
      </button>

      {acciones && (
        <>
          <button type="button" aria-label="Cerrar" onClick={() => setAcciones(false)} className="fixed inset-0 -z-10 bg-black/30" />
          <div className="absolute inset-x-4 bottom-[calc(100%+2.5rem)] flex flex-col gap-1 rounded-2xl border border-edge bg-card p-2 shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setAcciones(false);
                abrirNueva();
              }}
              className="flex items-center gap-3 rounded-xl p-3 text-left hover:bg-ink-2"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-lime-soft text-lime-text">
                <CalendarPlus className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-medium text-fg">Nueva cita</span>
                <span className="block text-xs text-mist">Agendar en un horario libre</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAcciones(false);
                abrirServicioPresencial();
              }}
              className="flex items-center gap-3 rounded-xl p-3 text-left hover:bg-ink-2"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-lime-soft text-lime-text">
                <Store className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-medium text-fg">Servicio presencial</span>
                <span className="block text-xs text-mist">Clienta que vino sin cita</span>
              </span>
            </button>
          </div>
        </>
      )}
    </nav>
  );
}
