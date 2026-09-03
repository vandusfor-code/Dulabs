"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { FlowNode } from "@/lib/flow/types";
import { NODE_TYPE_LABEL } from "@/lib/flow-builder/node-factory";

/**
 * Professional Flow Editor UX (autorizado) — buscador integrado al editor
 * (no un buscador independiente): input + resultados en un popover bajo el
 * mismo botón del toolbar. `results` ya viene calculado por el caller vía
 * lib/flow-builder/search-nodes.ts (searchNodes) -- este componente es solo
 * presentación + el ciclo abrir/escribir/elegir/cerrar.
 */
export function FlowSearchBar({
  open,
  query,
  onQueryChange,
  results,
  onSelect,
  onClose,
}: {
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  results: FlowNode[];
  onSelect: (nodeId: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [highlighted, setHighlighted] = useState(0);
  // Reinicia el índice resaltado cuando cambian los resultados -- ajuste de
  // estado durante el render (patrón recomendado por React) en vez de un
  // efecto, para no disparar un commit extra solo por esto.
  const [prevResults, setPrevResults] = useState(results);
  if (results !== prevResults) {
    setPrevResults(results);
    setHighlighted(0);
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="absolute left-1/2 top-3 z-40 w-80 -translate-x-1/2 rounded-lg border border-edge bg-card shadow-xl">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <Search className="size-4 shrink-0 text-mist" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && results[highlighted]) {
              onSelect(results[highlighted]!.id);
            }
          }}
          placeholder="Buscar nodo por nombre, tipo o contenido…"
          className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
        />
        <button type="button" onClick={onClose} className="shrink-0 rounded-md p-0.5 text-mist hover:text-fg" aria-label="Cerrar búsqueda">
          <X className="size-3.5" />
        </button>
      </div>
      {query.trim() && (
        <div className="max-h-64 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-mist">Sin resultados.</p>
          ) : (
            results.map((node, i) => (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelect(node.id)}
                className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors ${
                  i === highlighted ? "bg-ink" : "hover:bg-ink"
                }`}
              >
                <span className="text-xs font-medium text-fg">{node.label ?? node.id}</span>
                <span className="text-[10px] text-mist">
                  {NODE_TYPE_LABEL[node.type]} · {node.id}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
