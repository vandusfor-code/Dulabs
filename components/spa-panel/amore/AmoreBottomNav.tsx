"use client";

import { Home, CalendarDays, Users, Sparkles, MoreHorizontal, Plus } from "lucide-react";
import { useAmoreUi } from "./AmoreUiContext";

// AMORE (Fase 5, panel administrativo móvil, autorizado) — navegación
// inferior fija con el botón central "+" elevado, fiel al mockup. Ningún
// módulo (Citas/Clientes/Servicios) está construido todavía en esta fase:
// solo "Inicio" es real, el resto avisa que la función llega después en vez
// de apuntar a una ruta rota o a un módulo a medio construir. "Más" reutiliza
// el mismo drawer que abre la hamburguesa del header.
export function AmoreBottomNav({ onAbrirMenu }: { onAbrirMenu: () => void }) {
  const { avisarProximamente } = useAmoreUi();

  const item = (icono: React.ReactNode, label: string, activo: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium ${
        activo ? "text-lime-text" : "text-mist"
      }`}
    >
      {icono}
      {label}
    </button>
  );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[430px] border-t border-edge bg-card pb-[env(safe-area-inset-bottom)]">
      <div className="relative flex items-center px-2">
        {item(<Home className="size-5" />, "Inicio", true, () => {})}
        {item(<CalendarDays className="size-5" />, "Citas", false, avisarProximamente)}
        {item(<Users className="size-5" />, "Clientes", false, avisarProximamente)}

        <div className="flex flex-1 flex-col items-center">
          <button
            type="button"
            onClick={avisarProximamente}
            aria-label="Nueva cita"
            className="-mt-6 flex size-14 items-center justify-center rounded-full bg-lime text-white shadow-[0_6px_16px_rgba(184,92,120,0.4)]"
          >
            <Plus className="size-6" />
          </button>
        </div>

        {item(<Sparkles className="size-5" />, "Servicios", false, avisarProximamente)}
        {item(<MoreHorizontal className="size-5" />, "Más", false, onAbrirMenu)}
      </div>
    </nav>
  );
}
