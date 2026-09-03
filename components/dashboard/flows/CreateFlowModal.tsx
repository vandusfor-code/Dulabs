"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface CreateFlowModalProps {
  open: boolean;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string, description: string) => void;
}

/**
 * Modal de creación de Flow (Flow Builder, autorizado) -- reemplaza
 * window.prompt(). Mismo patrón visual del buscador global
 * (CommandPalette.tsx): overlay + panel role="dialog", Escape cierra, Enter
 * envía, autofocus en el nombre. No llama a ninguna API por sí mismo --
 * creating/error/onSubmit vienen del padre, misma lógica de creación que ya
 * vivía en FlowsListPage.
 */
export function CreateFlowModal({ open, creating, error, onClose, onSubmit }: CreateFlowModalProps) {
  const { t } = useI18n();
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // El campo arranca limpio cada vez que se abre, sin que quede el nombre de
  // un intento anterior (fallido o no) al reabrir el modal. Ajuste de estado
  // durante el render (patrón recomendado por React para "resetear estado
  // cuando cambia una prop") en vez de un efecto -- evita el render en
  // cascada de llamar a setState dentro de un efecto.
  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      setNombre("");
      setDescripcion("");
    }
  }

  // Autofocus SÍ es un efecto legítimo (sincroniza con el DOM, no con
  // estado de React) -- la ref todavía no está montada en el mismo tick que
  // `open` pasa a true, así que se enfoca un frame más adelante.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;

  const nombreValido = nombre.trim().length > 0;

  function cerrar() {
    if (!creating) onClose();
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombreValido || creating) return;
    onSubmit(nombre.trim(), descripcion.trim());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cerrar();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={cerrar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-flow-modal-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-edge bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h2 id="create-flow-modal-title" className="text-sm font-semibold text-fg">
            {t("Crear nuevo Flow", "Create new Flow")}
          </h2>
          <button
            type="button"
            onClick={cerrar}
            disabled={creating}
            className="rounded-lg p-1 text-mist hover:bg-ink-2 hover:text-fg disabled:opacity-60"
            aria-label={t("Cerrar", "Close")}
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={enviar} className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="create-flow-name" className="text-xs font-medium text-mist">
              {t("Nombre del Flow", "Flow name")}
            </label>
            <input
              ref={inputRef}
              id="create-flow-name"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={creating}
              placeholder={t("Ej. Bienvenida y agendamiento", "e.g. Welcome and booking")}
              className="rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none placeholder:text-mist focus:border-lime/60 disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="create-flow-description" className="text-xs font-medium text-mist">
              {t("Descripción (opcional)", "Description (optional)")}
            </label>
            <textarea
              id="create-flow-description"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={creating}
              rows={2}
              placeholder={t("¿Para qué sirve este flujo?", "What is this flow for?")}
              className="resize-none rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none placeholder:text-mist focus:border-lime/60 disabled:opacity-60"
            />
          </div>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-400">{error}</p>}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cerrar}
              disabled={creating}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-mist hover:bg-ink-2 hover:text-fg disabled:opacity-60"
            >
              {t("Cancelar", "Cancel")}
            </button>
            <button
              type="submit"
              disabled={!nombreValido || creating}
              className="rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {creating ? t("Creando…", "Creating…") : t("Crear Flow", "Create Flow")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
