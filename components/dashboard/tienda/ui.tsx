"use client";

/**
 * Administración de tienda — primitivas visuales. Reutilizan los tokens y clases del dashboard (inputCls, primaryBtn, actionBtn, Pill) y solo agregan lo que el
 * editor necesita: tarjetas de sección, campos con etiqueta asociada, selector segmentado, interruptor, avisos y un diálogo accesible.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle, Check, Info, Loader2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Pill } from "@/components/dashboard/shell/ui";
import { actionBtn, inputCls, primaryBtn } from "@/components/dashboard/business-agent/ui";
import { TEXTO_CHIP_EN, type Chip } from "@/components/dashboard/tienda/formato";

export { actionBtn, inputCls, primaryBtn };

export function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export const dangerBtn =
  "flex items-center gap-2 rounded-lg border border-red-500/40 px-3.5 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50";

export function ChipUi({ chip }: { chip: Chip }) {
  const { t } = useI18n();
  return (
    <Pill tone={chip.tono} className="shrink-0 whitespace-nowrap">
      {t(chip.texto, TEXTO_CHIP_EN[chip.texto] ?? chip.texto)}
    </Pill>
  );
}

export function Tarjeta({ titulo, descripcion, children, accion, id }: { titulo?: string; descripcion?: string; children: ReactNode; accion?: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-xl border border-edge bg-card p-5">
      {(titulo || accion) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {titulo && <h3 className="text-sm font-semibold text-fg">{titulo}</h3>}
            {descripcion && <p className="mt-1 text-xs leading-relaxed text-mist">{descripcion}</p>}
          </div>
          {accion}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface CampoBase {
  etiqueta: string;
  ayuda?: string;
  requerido?: boolean;
  error?: string | null;
  disabled?: boolean;
}

/** Contenedor con la etiqueta ASOCIADA al control (htmlFor): accesible para lectores de pantalla. */
export function Campo({ id, etiqueta, ayuda, requerido, error, children }: Pick<CampoBase, "etiqueta" | "ayuda" | "requerido" | "error"> & { id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-mist">
        {etiqueta}
        {requerido && (
          <span className="ml-0.5 text-red-400" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {ayuda && !error && <p className="mt-1 text-[11px] text-mist/80">{ayuda}</p>}
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function CampoTexto({ valor, onCambio, placeholder, tipo = "text", maxLength, inputMode, ...base }: CampoBase & { valor: string; onCambio: (v: string) => void; placeholder?: string; tipo?: string; maxLength?: number; inputMode?: "numeric" | "decimal" | "text" }) {
  const id = useId();
  return (
    <Campo id={id} {...base}>
      <input id={id} type={tipo} value={valor} onChange={(e) => onCambio(e.target.value)} placeholder={placeholder} maxLength={maxLength} inputMode={inputMode} disabled={base.disabled} aria-invalid={base.error ? true : undefined} className={cn(inputCls, base.error && "border-red-500/60")} />
    </Campo>
  );
}

export function CampoArea({ valor, onCambio, placeholder, filas = 4, maxLength, ...base }: CampoBase & { valor: string; onCambio: (v: string) => void; placeholder?: string; filas?: number; maxLength?: number }) {
  const id = useId();
  return (
    <Campo id={id} {...base}>
      <textarea id={id} value={valor} onChange={(e) => onCambio(e.target.value)} placeholder={placeholder} rows={filas} maxLength={maxLength} disabled={base.disabled} aria-invalid={base.error ? true : undefined} className={cn(inputCls, "resize-y leading-relaxed", base.error && "border-red-500/60")} />
      {maxLength !== undefined && (
        <p className="mt-1 text-right text-[10.5px] text-mist/70" aria-hidden>
          {valor.length}/{maxLength}
        </p>
      )}
    </Campo>
  );
}

export function CampoSelect<V extends string>({ valor, onCambio, opciones, ...base }: CampoBase & { valor: V | ""; onCambio: (v: V) => void; opciones: ReadonlyArray<{ valor: V; etiqueta: string }> }) {
  const id = useId();
  return (
    <Campo id={id} {...base}>
      <select id={id} value={valor} onChange={(e) => onCambio(e.target.value as V)} disabled={base.disabled} className={inputCls}>
        {valor === "" && <option value="">—</option>}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
    </Campo>
  );
}

/** Opciones excluyentes en una fila (modalidad, tipo de beneficio…): más claro que un desplegable cuando son pocas. */
export function Segmentado<V extends string>({ etiqueta, ayuda, valor, onCambio, opciones, disabled }: { etiqueta: string; ayuda?: string; valor: V | ""; onCambio: (v: V) => void; opciones: ReadonlyArray<{ valor: V; etiqueta: string }>; disabled?: boolean }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={`${id}-et`}>
      <p id={`${id}-et`} className="mb-1.5 text-xs font-medium text-mist">
        {etiqueta}
      </p>
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-edge bg-ink p-1">
        {opciones.map((o) => {
          const activo = o.valor === valor;
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={activo}
              disabled={disabled}
              onClick={() => onCambio(o.valor)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed", activo ? "bg-lime text-lime-fg" : "text-mist hover:text-fg disabled:opacity-60")}
            >
              {o.etiqueta}
            </button>
          );
        })}
      </div>
      {ayuda && <p className="mt-1 text-[11px] text-mist/80">{ayuda}</p>}
    </div>
  );
}

export function Interruptor({ etiqueta, ayuda, valor, onCambio, disabled }: { etiqueta: string; ayuda?: string; valor: boolean; onCambio: (v: boolean) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {etiqueta}
        </label>
        {ayuda && <p className="mt-0.5 text-[11px] text-mist/80">{ayuda}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={valor} disabled={disabled} onClick={() => onCambio(!valor)} className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full border border-edge transition-colors disabled:cursor-not-allowed disabled:opacity-60", valor ? "bg-lime" : "bg-ink")}>
        <span className={cn("absolute top-0.5 size-4.5 rounded-full transition-all", valor ? "left-[1.375rem] bg-lime-fg" : "left-0.5 bg-mist")} />
        <span className="sr-only">{valor ? t("Sí", "Yes") : t("No", "No")}</span>
      </button>
    </div>
  );
}

export function Aviso({ tono = "info", titulo, children }: { tono?: "info" | "warning" | "danger" | "success"; titulo?: string; children?: ReactNode }) {
  const estilos = {
    info: "border-edge bg-ink text-mist",
    warning: "border-amber-400/40 bg-amber-400/10 text-amber-400",
    danger: "border-red-500/40 bg-red-500/10 text-red-400",
    success: "border-lime/30 bg-lime/10 text-lime-text",
  } as const;
  const Icono = tono === "danger" || tono === "warning" ? AlertTriangle : tono === "success" ? Check : Info;
  return (
    <div role={tono === "danger" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm", estilos[tono])}>
      <Icono className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {titulo && <p className="font-medium">{titulo}</p>}
        {children && <div className={cn("text-[13px] leading-relaxed", titulo && "mt-0.5 opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

export function Cargando({ texto }: { texto?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-mist">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {texto ?? t("Cargando…", "Loading…")}
    </div>
  );
}

export function BotonCargando({ cargando, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { cargando?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || cargando}>
      {cargando && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const FOCALIZABLES = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal accesible: role=dialog, el foco entra al primer campo (o al botón principal; nunca a la «X»), Tab no se sale del diálogo, Escape cierra, el
 * fondo no se puede usar y al cerrar el foco vuelve a donde estaba. El foco se coloca UNA vez al abrir: escribir en un campo del diálogo no lo mueve.
 */
export function Dialogo({ abierto, titulo, descripcion, children, onCerrar, acciones }: { abierto: boolean; titulo: string; descripcion?: string; children?: ReactNode; onCerrar: () => void; acciones: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onCerrar);
  const idTitulo = useId();
  const { t } = useI18n();
  // Siempre la última versión de `onCerrar`, sin volver a colocar el foco cada vez que el padre se repinta.
  useEffect(() => {
    cerrar.current = onCerrar;
  });
  useEffect(() => {
    if (!abierto) return;
    const dialogo = ref.current;
    const previo = document.activeElement as HTMLElement | null;
    const inicial = dialogo?.querySelector<HTMLElement>('textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled])') ?? dialogo?.querySelector<HTMLElement>("[data-acciones] button:not([disabled])") ?? dialogo; // el primero de las acciones es siempre «Cancelar»: Enter nunca confirma algo destructivo sin querer
    inicial?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cerrar.current();
        return;
      }
      if (e.key !== "Tab" || !dialogo) return;
      const lista = [...dialogo.querySelectorAll<HTMLElement>(FOCALIZABLES)];
      if (lista.length === 0) return;
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      if (!dialogo.contains(document.activeElement)) {
        e.preventDefault();
        primero.focus();
      } else if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      previo?.focus?.();
    };
  }, [abierto]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-edge bg-card p-6 shadow-xl outline-none">
        <div className="flex items-start justify-between gap-3">
          <h2 id={idTitulo} className="text-base font-semibold text-fg">
            {titulo}
          </h2>
          <button type="button" onClick={onCerrar} className="text-mist transition-colors hover:text-fg" aria-label={t("Cerrar", "Close")}>
            <X className="size-4" />
          </button>
        </div>
        {descripcion && <p className="mt-2 text-sm leading-relaxed text-mist">{descripcion}</p>}
        {children && <div className="mt-4 space-y-3">{children}</div>}
        <div data-acciones className="mt-6 flex flex-wrap justify-end gap-2">
          {acciones}
        </div>
      </div>
    </div>
  );
}
