"use client";

import { X } from "lucide-react";
import { Sidebar } from "./Sidebar";

export function MobileMenuDrawer({ token, negocio, onClose }: { token: string; negocio: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 lg:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative flex h-full w-72 max-w-[80%] flex-col bg-ink-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Cerrar menú"
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full text-mist transition-colors hover:bg-card"
        >
          <X className="size-4" />
        </button>
        <Sidebar token={token} negocio={negocio} />
      </div>
    </div>
  );
}
