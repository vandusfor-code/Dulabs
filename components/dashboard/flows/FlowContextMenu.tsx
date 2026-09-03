"use client";

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";

export interface FlowContextMenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface FlowContextMenuState {
  x: number;
  y: number;
  items: FlowContextMenuItem[];
}

/**
 * Professional Flow Editor UX (autorizado) — menú contextual genérico,
 * posicionado en coordenadas de pantalla. No sabe nada de nodos/selección/
 * canvas: el caller (page.tsx) decide QUÉ items mostrar según se haya
 * abierto sobre un nodo, una selección o el canvas vacío. Un solo
 * componente para los tres casos, en vez de tres menús distintos.
 */
export function FlowContextMenu({ menu, onClose }: { menu: FlowContextMenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-edge bg-card py-1 shadow-xl"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.items.map((item, i) => (
        <button
          key={i}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            item.danger ? "text-red-400 hover:bg-red-500/10" : "text-fg hover:bg-ink"
          }`}
        >
          {item.icon && <item.icon className="size-3.5 shrink-0" />}
          {item.label}
        </button>
      ))}
    </div>
  );
}
