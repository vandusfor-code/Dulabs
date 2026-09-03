"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { FlowValidationError } from "@/lib/flow/errors";
import type { OrphanHandleWarning } from "@/lib/flow-builder/connection-rules";

/**
 * Professional Flow Editor UX (autorizado) — reemplaza a FlowGlobalErrors
 * (mismo componente, responsabilidad ampliada, mismo único call site en
 * page.tsx): además del banner de errores globales que ya existía
 * (MISSING_START_NODE, NO_PATH_TO_END...), agrega dos listas navegables:
 *
 * - ERRORS: FlowValidationError[] con nodeId/edgeId -- vienen del validador
 *   REAL del servidor (POST /validate), sin reinterpretar ningún `code`.
 *   Bloquean publicar.
 * - WARNINGS: handles sin conectar (allOrphanHandles, ya existía en
 *   FlowInfoPanel para el nodo seleccionado, acá para todo el flow) --
 *   estructurales, del propio Builder, NUNCA bloquean publicar. No se
 *   introduce ningún campo de severidad en el validador del Flow Engine
 *   para lograr esta separación.
 *
 * Clic en cualquier fila -> selecciona y centra el nodo/edge correspondiente
 * (onSelectNode/onSelectEdge, implementados en page.tsx sobre lo que ya
 * existía: selectNode/selectEdge + FlowCanvas ref).
 */
export function FlowValidationPanel({
  globalErrors,
  nodeAndEdgeErrors,
  warnings,
  nodeLabel,
  onSelectNode,
  onSelectEdge,
}: {
  globalErrors: FlowValidationError[];
  nodeAndEdgeErrors: FlowValidationError[];
  warnings: OrphanHandleWarning[];
  nodeLabel: (nodeId: string) => string;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}) {
  const [warningsOpen, setWarningsOpen] = useState(false);
  const hasErrors = globalErrors.length > 0 || nodeAndEdgeErrors.length > 0;
  const hasWarnings = warnings.length > 0;
  if (!hasErrors && !hasWarnings) return null;

  return (
    <div className="border-b border-edge">
      {hasErrors && (
        <div className="bg-red-500/10 px-5 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-danger-text">
            <TriangleAlert className="size-3.5" />
            Errores ({globalErrors.length + nodeAndEdgeErrors.length})
          </p>
          <ul className="space-y-0.5">
            {globalErrors.map((e, i) => (
              <li key={`g-${i}`} className="text-xs leading-relaxed text-danger-text">
                {e.message}
              </li>
            ))}
            {nodeAndEdgeErrors.map((e, i) => (
              <li key={`ne-${i}`}>
                <button
                  type="button"
                  onClick={() => (e.nodeId ? onSelectNode(e.nodeId) : e.edgeId ? onSelectEdge(e.edgeId) : undefined)}
                  className="text-left text-xs leading-relaxed text-danger-text underline-offset-2 hover:underline"
                >
                  {e.message} {e.nodeId ? `— ${nodeLabel(e.nodeId)}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasWarnings && (
        <div className="bg-amber-400/10 px-5 py-2">
          <button
            type="button"
            onClick={() => setWarningsOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-400"
          >
            {warningsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Advertencias ({warnings.length})
          </button>
          {warningsOpen && (
            <ul className="mt-1.5 space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onSelectNode(w.nodeId)}
                    className="text-left text-xs leading-relaxed text-amber-400 underline-offset-2 hover:underline"
                  >
                    {nodeLabel(w.nodeId)}: la rama &quot;{w.handleLabel}&quot; no tiene conexión de salida
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
