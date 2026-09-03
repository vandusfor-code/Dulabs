"use client";

import { Check, History, RotateCcw, X } from "lucide-react";
import { Pill } from "@/components/dashboard/shell/ui";
import type { FlowVersionRow } from "@/lib/flow/flow-store-types";
import { isPublishedVersion } from "@/lib/flow-builder/version-history";

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Etapa 5 (Flow Builder, autorizado) — panel de historial (GET /versions,
 * ya existente). "Publicada" se decide EXCLUSIVAMENTE comparando
 * version.id === publishedVersionId (ver version-history.ts y la
 * auditoría: published_at puede seguir lleno en versiones que ya no son la
 * publicada actual). Restaurar (Etapa 6 del alcance de esta pantalla, no
 * confundir con "Etapa 6" del roadmap del producto) solo carga la
 * definición en el canvas como cambio local -- ver loadDefinitionForEdit en
 * builder-state.ts y el manejador en page.tsx, que pide confirmación antes.
 */
export function FlowVersionHistory({
  open,
  onClose,
  versions,
  loading,
  error,
  publishedVersionId,
  canRestore,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  versions: FlowVersionRow[];
  loading: boolean;
  error: string | null;
  publishedVersionId: string | null;
  /** Solo admin puede Restaurar (mismo rol que Guardar/Publicar) -- ver, agente puede VER el panel pero no restaurar. */
  canRestore: boolean;
  onRestore: (version: FlowVersionRow) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col border-l border-edge bg-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <History className="size-4" /> Historial de versiones
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-mist hover:text-fg" aria-label="Cerrar historial">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-mist">Cargando versiones…</p>}
          {error && !loading && <p className="text-sm text-red-400">{error}</p>}
          {!loading && !error && versions.length === 0 && (
            <p className="text-sm text-mist">No hay versiones guardadas todavía.</p>
          )}
          {!loading && !error && versions.length > 0 && (
            <ul className="space-y-2">
              {versions.map((v) => {
                const publicada = isPublishedVersion(v, publishedVersionId);
                return (
                  <li key={v.id} className="rounded-lg border border-edge p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-semibold text-fg">v{v.version_number}</span>
                      <Pill tone={publicada ? "success" : "neutral"}>
                        {publicada ? (
                          <>
                            <Check className="size-3" /> Publicada
                          </>
                        ) : (
                          "Borrador"
                        )}
                      </Pill>
                    </div>
                    <p className="mt-1 text-xs text-mist">{formatFecha(v.created_at)}</p>
                    {canRestore && (
                      <button
                        type="button"
                        onClick={() => onRestore(v)}
                        className="mt-2 flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1 text-xs font-medium text-mist transition-colors hover:border-lime/40 hover:text-fg"
                      >
                        <RotateCcw className="size-3" /> Restaurar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
