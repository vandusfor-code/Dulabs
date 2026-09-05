"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Home, CalendarDays, Users, Sparkles, Cake, Heart, Wallet, UserRound, MessageCircle, Settings } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { cn } from "@/components/spa-panel/ui";
import {
  rutaInicio,
  rutaCitas,
  rutaClientes,
  rutaServicios,
  rutaCumpleanos,
  rutaFidelizacion,
  rutaContabilidad,
  rutaEquipo,
  rutaWhatsapp,
  rutaConfiguracion,
  esRutaActiva,
} from "./amore-routes";

// AMORE (Fase 5, diseño visual completo, autorizado) — estructura de
// navegación completa del panel. Todos los módulos ya navegan a una
// pantalla real (aunque su contenido interno siga siendo visual/mock) --
// nada aquí apunta a una ruta rota. El estado activo se calcula por la ruta
// actual, no queda fijo en "Inicio".
export function AmoreMenuDrawer({ onClose }: { onClose: () => void }) {
  const { token } = useAgenda();
  const pathname = usePathname();

  const items = [
    { label: "Inicio", icon: Home, href: rutaInicio(token), activo: pathname === rutaInicio(token) },
    { label: "Citas", icon: CalendarDays, href: rutaCitas(token), activo: esRutaActiva(pathname, rutaCitas(token)) },
    { label: "Clientes", icon: Users, href: rutaClientes(token), activo: esRutaActiva(pathname, rutaClientes(token)) },
    { label: "Servicios", icon: Sparkles, href: rutaServicios(token), activo: esRutaActiva(pathname, rutaServicios(token)) },
    { label: "Cumpleaños", icon: Cake, href: rutaCumpleanos(token), activo: esRutaActiva(pathname, rutaCumpleanos(token)) },
    { label: "Fidelización", icon: Heart, href: rutaFidelizacion(token), activo: esRutaActiva(pathname, rutaFidelizacion(token)) },
    { label: "Contabilidad", icon: Wallet, href: rutaContabilidad(token), activo: esRutaActiva(pathname, rutaContabilidad(token)) },
    { label: "Equipo", icon: UserRound, href: rutaEquipo(token), activo: esRutaActiva(pathname, rutaEquipo(token)) },
    { label: "WhatsApp", icon: MessageCircle, href: rutaWhatsapp(token), activo: esRutaActiva(pathname, rutaWhatsapp(token)) },
    { label: "Configuración", icon: Settings, href: rutaConfiguracion(token), activo: esRutaActiva(pathname, rutaConfiguracion(token)) },
  ] as const;

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Cerrar menú" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-[320px] flex-col bg-card shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5">
          <span className="text-base font-semibold text-fg">AMORE</span>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-mist active:bg-ink-2"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="mt-2 flex flex-col gap-1 overflow-y-auto px-3 pb-6">
          {items.map(({ label, icon: Icon, href, activo }) => (
            <Link
              key={label}
              href={href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium",
                activo ? "bg-lime-soft text-lime-text" : "text-fg"
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
