"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { EstadoCita } from "./types";

export function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  className,
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<string, string> = {
    primary: "bg-lime text-lime-fg hover:bg-lime-hover",
    secondary: "border border-edge bg-card text-fg hover:bg-ink-2",
    ghost: "text-mist hover:bg-ink-2 hover:text-fg",
    danger: "bg-danger text-danger-text hover:brightness-95",
  };
  const sizes: Record<string, string> = {
    md: "px-4 py-2.5 text-sm",
    sm: "px-3 py-1.5 text-xs",
  };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

const ESTADO_TONO: Record<EstadoCita, { bg: string; text: string; label: string }> = {
  confirmada: { bg: "bg-success", text: "text-success-text", label: "Confirmada" },
  pendiente: { bg: "bg-warning", text: "text-warning-text", label: "Pendiente" },
  propuesta: { bg: "bg-warning", text: "text-warning-text", label: "Por confirmar" },
  cancelada: { bg: "bg-ink-2", text: "text-mist", label: "Cancelada" },
  rechazada: { bg: "bg-ink-2", text: "text-mist", label: "Rechazada" },
  completada: { bg: "bg-success", text: "text-success-text", label: "Completada" },
  no_show: { bg: "bg-danger", text: "text-danger-text", label: "No asistió" },
};

export function StatusBadge({ estado, className }: { estado: EstadoCita; className?: string }) {
  const tono = ESTADO_TONO[estado];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
        tono.bg,
        tono.text,
        className
      )}
    >
      {tono.label}
    </span>
  );
}

export function Modal({ onClose, children, maxWidth = "max-w-md" }: { onClose: () => void; children: ReactNode; maxWidth?: string }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={cn("w-full rounded-2xl border border-edge bg-card p-5 shadow-2xl", maxWidth)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-mist">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-mist">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-[10px] border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg outline-none transition-colors focus:border-lime/50";

export function Dropdown({
  trigger,
  children,
  align = "right",
}: {
  trigger: (opts: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "absolute top-full z-40 mt-1.5 w-48 rounded-xl border border-edge bg-card p-1.5 shadow-2xl",
              align === "right" ? "right-0" : "left-0"
            )}
          >
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

export function DropdownItem({
  icon: Icon,
  children,
  onClick,
  danger = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        danger ? "text-danger-text hover:bg-danger" : "text-fg hover:bg-ink-2"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {children}
    </button>
  );
}
