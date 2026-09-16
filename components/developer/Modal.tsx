"use client";

import { useEffect, type ReactNode } from "react";

// DuLabs Developer V1 -- Fase 9. Modal base sobrio: backdrop, Escape para
// cerrar, sin librerías. Client.

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md rounded-xl border border-edge bg-card p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
