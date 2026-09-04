"use client";

import { X, Home, CalendarDays, Users, Sparkles, Cake, Heart, Wallet, UserRound, MessageCircle, Settings } from "lucide-react";
import { useAmoreUi } from "./AmoreUiContext";

const ITEMS = [
  { label: "Inicio", icon: Home, activo: true },
  { label: "Citas", icon: CalendarDays, activo: false },
  { label: "Clientes", icon: Users, activo: false },
  { label: "Servicios", icon: Sparkles, activo: false },
  { label: "Cumpleaños", icon: Cake, activo: false },
  { label: "Fidelización", icon: Heart, activo: false },
  { label: "Contabilidad", icon: Wallet, activo: false },
  { label: "Equipo", icon: UserRound, activo: false },
  { label: "WhatsApp", icon: MessageCircle, activo: false },
  { label: "Configuración", icon: Settings, activo: false },
] as const;

// AMORE (Fase 5, panel administrativo móvil, autorizado) — estructura de
// navegación futura del panel. Solo "Inicio" está implementado en esta fase;
// el resto queda como placeholder visual (avisa que la función llega
// después) sin construir su lógica todavía.
export function AmoreMenuDrawer({ onClose }: { onClose: () => void }) {
  const { avisarProximamente } = useAmoreUi();

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Cerrar menú" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-[320px] flex-col bg-card shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5">
          <span className="text-base font-semibold text-fg">Menú</span>
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
          {ITEMS.map(({ label, icon: Icon, activo }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (activo) {
                  onClose();
                  return;
                }
                avisarProximamente();
              }}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium ${
                activo ? "bg-lime-soft text-lime-text" : "text-fg"
              }`}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
