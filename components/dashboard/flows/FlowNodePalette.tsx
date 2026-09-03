"use client";

import { NODE_GROUP_BY_TYPE } from "./FlowNodeCard";
import type { FlowNodeType } from "@/lib/flow/types";

/** Exportado (Professional Editor UX, autorizado) para que FlowQuickAddMenu use la MISMA agrupación -- nunca una lista paralela. */
export const NODE_PALETTE_GROUPS: { title: string; items: { type: FlowNodeType; label: string }[] }[] = [
  {
    title: "Comunicación",
    items: [
      { type: "message", label: "Mensaje" },
      { type: "question", label: "Pregunta" },
      { type: "buttons", label: "Botones" },
    ],
  },
  {
    title: "Lógica",
    items: [
      { type: "condition", label: "Condición" },
      { type: "save_data", label: "Guardar datos" },
    ],
  },
  { title: "IA", items: [{ type: "ai", label: "IA" }] },
  { title: "Acciones", items: [{ type: "action", label: "Acción" }] },
  {
    title: "Control",
    items: [
      { type: "start", label: "Inicio" },
      { type: "human", label: "Humano" },
      { type: "end", label: "Final" },
    ],
  },
];

/** Mime type del drag-and-drop nodo->canvas -- compartido con FlowCanvas.tsx (único punto que lo lee). */
export const FLOW_NODE_DRAG_MIME = "application/x-dulabs-flow-node-type";

/**
 * Etapa 3 (Flow Builder, autorizado) — panel izquierdo, ahora arrastrable:
 * cada ítem inicia un drag nativo HTML5 con el tipo de nodo en el
 * dataTransfer; FlowCanvas.tsx lo recibe en onDrop y crea el nodo en la
 * posición exacta donde se soltó (screenToFlowPosition). Este componente no
 * sabe nada de FlowDefinition -- solo emite el tipo elegido.
 */
export function FlowNodePalette() {
  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-edge bg-card p-4">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-mist">Nodos</p>
      <div className="flex flex-col gap-5">
        {NODE_PALETTE_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mist">{group.title}</p>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => {
                const meta = NODE_GROUP_BY_TYPE[item.type];
                return (
                  <div
                    key={item.type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(FLOW_NODE_DRAG_MIME, item.type);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="flex cursor-grab items-center gap-2 rounded-lg border border-edge/60 bg-ink px-2.5 py-1.5 text-xs text-fg active:cursor-grabbing"
                  >
                    <span
                      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${meta?.tone ?? ""}`}
                    >
                      {item.label[0]}
                    </span>
                    {item.label}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-[11px] leading-relaxed text-mist">Arrastra un nodo al canvas para agregarlo al flow.</p>
    </aside>
  );
}
