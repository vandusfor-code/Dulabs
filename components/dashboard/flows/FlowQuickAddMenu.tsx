"use client";

import { useEffect, useRef } from "react";
import type { FlowNodeType } from "@/lib/flow/types";
import { NODE_PALETTE_GROUPS } from "./FlowNodePalette";
import { NODE_GROUP_BY_TYPE } from "./FlowNodeCard";

export interface FlowQuickAddState {
  x: number;
  y: number;
}

/**
 * Professional Flow Editor UX (autorizado) — agregar nodo rápido: mismo
 * catálogo de tipos que FlowNodePalette (NODE_PALETTE_GROUPS, reutilizado
 * tal cual, nunca una segunda lista), en un popover posicionado. Se abre
 * con doble click en el canvas vacío o "Agregar nodo" del menú contextual.
 * Solo emite `onPick(type)` -- crear el nodo real (createDefaultNode +
 * addNode) sigue siendo responsabilidad de page.tsx, igual que el drag
 * desde la paleta.
 */
export function FlowQuickAddMenu({
  state,
  onPick,
  onClose,
}: {
  state: FlowQuickAddState | null;
  onPick: (type: FlowNodeType) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
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
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      className="fixed z-50 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-edge bg-card p-2 shadow-xl"
      style={{ left: state.x, top: state.y }}
    >
      {NODE_PALETTE_GROUPS.map((group) => (
        <div key={group.title} className="mb-2 last:mb-0">
          <p className="mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-mist">{group.title}</p>
          {group.items.map((item) => {
            const meta = NODE_GROUP_BY_TYPE[item.type];
            return (
              <button
                key={item.type}
                type="button"
                onClick={() => {
                  onPick(item.type);
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-fg transition-colors hover:bg-ink"
              >
                <span
                  className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${meta?.tone ?? ""}`}
                >
                  {item.label[0]}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
