import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/components/spa-panel/ui";
import { inicialesDe } from "@/components/spa-panel/format";

// AMORE (Fase 5, diseño visual completo, autorizado) — kit de componentes
// reutilizables del panel móvil de AMORE. Ninguna pantalla debe repetir
// estas clases a mano: todo lo que aquí se define reusa los mismos tokens
// (bg-card, border-edge, bg-lime, text-lime-text...) que ya trae `.amore-scope`
// (ver app/globals.css), así que cambia de piel automáticamente según el
// tenant sin que este archivo lo sepa. `cn` e `inicialesDe` se reusan tal
// cual del kit genérico del panel (components/spa-panel/ui.tsx / format.ts).

export function AmoreCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-[22px] border border-edge bg-card p-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]", className)}>
      {children}
    </div>
  );
}

export function AmoreScreenTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-xs text-mist">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function AmoreSectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {action}
    </div>
  );
}

type Tono = "success" | "warning" | "danger" | "neutral" | "lime";

const TONOS: Record<Tono, string> = {
  success: "bg-success text-success-text",
  warning: "bg-warning text-warning-text",
  danger: "bg-danger text-danger-text",
  neutral: "bg-ink-2 text-mist",
  lime: "bg-lime-soft text-lime-text",
};

export function AmoreBadge({ tono, children, className }: { tono: Tono; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-medium", TONOS[tono], className)}>
      {children}
    </span>
  );
}

// Mismo radio/padding/gap del botón "Ver calendario completo" de Inicio (ya
// desplegado) -- ese es el único botón de referencia real que trae el
// mockup, así que el resto del design system se alinea a él.
export function AmorePrimaryButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-2xl bg-lime px-4 py-3 text-sm font-medium text-lime-fg transition-colors hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

export function AmoreSecondaryButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-2xl bg-lime-soft px-4 py-3 text-sm font-medium text-lime-text transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

export function AmoreSearchInput({
  value,
  onChange,
  placeholder,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2.5 rounded-2xl border border-edge bg-card px-4 py-2.5">
      {icon}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
      />
    </label>
  );
}

export function AmoreSegmentedTabs<T extends string>({
  opciones,
  activo,
  onChange,
}: {
  opciones: { valor: T; etiqueta: string }[];
  activo: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-2xl border border-edge bg-card p-1">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onChange(o.valor)}
          className={cn(
            "flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
            activo === o.valor ? "bg-lime text-lime-fg" : "text-mist"
          )}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

export function AmoreEmptyState({ icono, mensaje }: { icono: ReactNode; mensaje: string }) {
  return (
    <div className="flex flex-col items-center rounded-[22px] border border-edge bg-card p-10 text-center">
      {icono}
      <p className="mt-2 text-sm text-mist">{mensaje}</p>
    </div>
  );
}

export function AmoreAvatar({ nombre, size = "md" }: { nombre: string; size?: "sm" | "md" | "lg" }) {
  const tamanos = { sm: "size-9 text-[11px]", md: "size-10 text-xs", lg: "size-12 text-sm" };
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-full bg-lime-soft font-semibold text-lime-text", tamanos[size])}>
      {inicialesDe(nombre)}
    </div>
  );
}

export function AmoreChevronRow({
  icono,
  titulo,
  descripcion,
  onClick,
}: {
  icono: ReactNode;
  titulo: string;
  descripcion?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-card p-3.5 text-left shadow-[0_2px_10px_rgba(0,0,0,0.03)]"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-lime-soft text-lime-text">{icono}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{titulo}</p>
        {descripcion && <p className="truncate text-xs text-mist">{descripcion}</p>}
      </div>
      <ChevronRight className="size-4 shrink-0 text-mist" />
    </button>
  );
}

export function AmoreDivider() {
  return <div className="h-px w-full bg-edge" />;
}

export function AmoreSwitch({
  activo,
  onChange,
  disabled,
}: {
  activo: boolean;
  onChange: (v: boolean) => void;
  /** Evita doble envío mientras la persistencia real está en curso -- opcional, no cambia el aspecto visual. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      disabled={disabled}
      onClick={() => onChange(!activo)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
        activo ? "bg-lime" : "bg-ink-2"
      )}
    >
      <span
        className={cn(
          "absolute top-1 size-5 rounded-full bg-white shadow transition-transform",
          activo ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
