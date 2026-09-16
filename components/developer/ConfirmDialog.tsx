"use client";

import { Modal } from "@/components/developer/Modal";

// DuLabs Developer V1 -- Fase 9. Confirmación para acciones sensibles
// (revoke/rotate/delete). Nunca window.confirm.

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {description ? <p className="text-sm text-mist">{description}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} disabled={loading} className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-2 disabled:opacity-50">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${danger ? "bg-danger-text text-white hover:opacity-90" : "bg-dev-accent text-dev-accent-fg hover:bg-dev-accent-hover"}`}
        >
          {loading ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
