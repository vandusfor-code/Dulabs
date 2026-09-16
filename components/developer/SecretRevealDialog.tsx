"use client";

import { useState } from "react";
import { Modal } from "@/components/developer/Modal";

// DuLabs Developer V1 -- Fase 9. Muestra un secreto (API key / webhook secret)
// UNA SOLA VEZ. El valor vive solo en memoria de UI mientras el modal está
// abierto; al cerrar, el caller lo descarta. NUNCA se guarda en localStorage
// ni se registra en logs. Botón copy sin persistir.

export function SecretRevealDialog({
  open,
  title,
  secret,
  description,
  onClose,
}: {
  open: boolean;
  title: string;
  secret: string;
  description?: string;
  onClose: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Si el clipboard falla, el usuario todavía puede seleccionar el texto.
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-mist">{description ?? "Copy this value now. You won't be able to see it again."}</p>
      <div className="mt-3 flex items-center gap-2 rounded-md border border-edge bg-ink px-3 py-2">
        <code className="flex-1 break-all font-mono text-xs text-fg" data-testid="secret-value">
          {secret}
        </code>
        <button onClick={copiar} className="shrink-0 rounded-md border border-edge bg-card px-2.5 py-1 text-xs font-medium text-fg hover:bg-ink-2">
          {copiado ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="mt-3 rounded-md border border-warning-text/30 bg-warning/15 px-3 py-2 text-xs text-warning-text">
        Store it in a secure place. For security, it can&apos;t be shown again — you&apos;ll have to rotate it if lost.
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">
          Done
        </button>
      </div>
    </Modal>
  );
}
