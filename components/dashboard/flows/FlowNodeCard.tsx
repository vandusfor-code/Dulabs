"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CanvasNode } from "@/lib/flow-builder/canvas-adapter";

export const NODE_GROUP_BY_TYPE: Record<string, { group: string; tone: string }> = {
  message: { group: "Comunicación", tone: "bg-sky-400/15 text-sky-400" },
  question: { group: "Comunicación", tone: "bg-sky-400/15 text-sky-400" },
  buttons: { group: "Comunicación", tone: "bg-sky-400/15 text-sky-400" },
  condition: { group: "Lógica", tone: "bg-amber-400/15 text-amber-400" },
  save_data: { group: "Lógica", tone: "bg-amber-400/15 text-amber-400" },
  ai: { group: "IA", tone: "bg-lime/12 text-lime-text" },
  action: { group: "Acciones", tone: "bg-red-500/15 text-red-400" },
  start: { group: "Control", tone: "bg-ink text-mist" },
  human: { group: "Control", tone: "bg-ink text-mist" },
  end: { group: "Control", tone: "bg-ink text-mist" },
};

/**
 * Representación visual de solo lectura de un FlowNode real -- compartida
 * entre el spike (Etapa 0) y el Builder de solo lectura (Etapa 1). Sin
 * edición: solo tipo/label/id/resumen de config y los handles de salida
 * derivados por lib/flow-builder/canvas-adapter.ts.
 */
export function FlowNodeCard({ id, data, selected }: NodeProps<CanvasNode>) {
  const meta = NODE_GROUP_BY_TYPE[data.nodeType] ?? { group: "?", tone: "bg-ink text-mist" };
  const handles = data.sourceHandles;

  return (
    <div
      className={`w-64 rounded-xl border bg-card px-3 py-3 shadow-sm transition-colors ${
        selected ? "border-lime" : "border-edge"
      }`}
    >
      {data.hasTargetHandle && <Handle type="target" position={Position.Top} />}

      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.tone}`}
        >
          {data.nodeType}
        </span>
        <span className="truncate font-mono text-[10px] text-mist" title={id}>
          {id}
        </span>
      </div>

      <p className="text-xs font-medium text-fg">{data.label}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-mist">{data.summary}</p>

      {handles.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1 border-t border-edge pt-2">
          {handles.map((h) => (
            <span key={h.id} className="rounded bg-ink px-1.5 py-0.5 font-mono text-[9px] text-mist">
              {h.id}
            </span>
          ))}
        </div>
      )}

      {handles.map((h, i) => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={Position.Bottom}
          style={{ left: `${((i + 1) / (handles.length + 1)) * 100}%` }}
        />
      ))}
      {handles.length === 0 && data.nodeType !== "end" && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}
