"use client";

import { Menu, Bell, CalendarDays, ChevronDown } from "lucide-react";
import { formatearFechaLarga } from "@/components/spa-panel/format";
import { useAmoreUi } from "./AmoreUiContext";

// AMORE (Fase 5, panel administrativo móvil, autorizado) — cabecera fiel al
// mockup: hamburguesa + logo oficial centrado + notificaciones, luego el
// saludo con la fecha real y un selector "Hoy" todavía visual/preparado (sin
// selector de fechas real aún).
export function AmoreHeader({ nombreEspecialista, onAbrirMenu }: { nombreEspecialista: string; onAbrirMenu: () => void }) {
  const { avisarProximamente } = useAmoreUi();
  const fecha = formatearFechaLarga(new Date());

  return (
    <header className="px-5 pt-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Abrir menú"
          onClick={onAbrirMenu}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-fg active:bg-ink-2"
        >
          <Menu className="size-6" />
        </button>
        <img
          src="/amore/logo.png"
          alt="AMORE Salón de Belleza"
          width={2067}
          height={761}
          className="h-auto w-[min(230px,54vw)] object-contain"
        />
        <button
          type="button"
          aria-label="Notificaciones"
          onClick={avisarProximamente}
          className="relative flex size-10 shrink-0 items-center justify-center rounded-full text-fg active:bg-ink-2"
        >
          <Bell className="size-6" />
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-lime" />
        </button>
      </div>

      <div className="mt-6 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold text-fg">¡Hola, {nombreEspecialista}! 💕</p>
          <p className="mt-1 text-sm text-mist">{fecha}</p>
        </div>
        <button
          type="button"
          onClick={avisarProximamente}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-edge bg-card px-3.5 py-2 text-sm font-medium text-fg"
        >
          <CalendarDays className="size-4 text-lime-text" />
          Hoy
          <ChevronDown className="size-3.5 text-mist" />
        </button>
      </div>
    </header>
  );
}
