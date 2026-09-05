"use client";

import { Menu, Bell } from "lucide-react";
import { useAmoreUi } from "./AmoreUiContext";

// AMORE (Fase 5, diseño visual completo, autorizado) — barra superior GLOBAL
// (hamburguesa + logo oficial centrado + notificaciones), montada una sola
// vez por AmoreDashboardShell y compartida por TODAS las pantallas del panel
// -- así "Todas las pantallas deben utilizar un Header consistente" sin que
// cada pantalla tenga que repetirlo. El saludo/fecha/selector "Hoy" del
// mockup de Inicio (Fase anterior, ya desplegado) vive ahora en
// AmoreDashboardHome, NO aquí -- es contenido de esa pantalla, no del chrome
// global (las demás pantallas no lo llevan). El marcado del topbar en sí no
// cambió ni un pixel respecto a la versión anterior.
export function AmoreHeader({ onAbrirMenu }: { onAbrirMenu: () => void }) {
  const { avisarProximamente } = useAmoreUi();

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
    </header>
  );
}
