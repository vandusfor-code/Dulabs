"use client";

import { mensajeDeError, requestIdDeError } from "@/lib/dev-dashboard/dev-errors";

// DuLabs Developer V1 -- Fase 9. Estado de error entendible + request_id para
// soporte/correlación + reintento. Nunca alert() ni detalles de infra.

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const mensaje = mensajeDeError(error);
  const requestId = requestIdDeError(error);
  return (
    <div className="rounded-lg border border-danger-text/30 bg-danger/15 p-5 text-sm">
      <p className="font-medium text-fg">{mensaje}</p>
      {requestId ? <p className="mt-1 font-mono text-xs text-mist">request_id: {requestId}</p> : null}
      {onRetry ? (
        <button onClick={onRetry} className="mt-3 rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-2">
          Reintentar
        </button>
      ) : null}
    </div>
  );
}
