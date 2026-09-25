"use client";

/**
 * Primitivas visuales del Catálogo. Reutilizan los tokens y clases del
 * dashboard (inputCls/primaryBtn del Business Agent, Pill del shell) y solo
 * agregan lo que el Catálogo necesita: precio COP, imagen perezosa, referencia
 * copiable y un toast local (el dashboard no tiene un sistema global).
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ImageOff, Minus, Package, Plus, X } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import { createCatalogClient, type CatalogClient } from "@/lib/catalogo-client";
import { Pill } from "@/components/dashboard/shell/ui";
import type { ProductStatus } from "@/lib/catalogo/domain";

export function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export { inputCls, primaryBtn, actionBtn } from "@/components/dashboard/business-agent/ui";

/** Campo con etiqueta ASOCIADA al control (htmlFor): mismo estilo que Field del Business Agent, accesible para lectores de pantalla. */
export function CField({ label, htmlFor, hint, required, children }: { label: string; htmlFor: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-mist">
        {label}
        {required && <span className="ml-0.5 text-red-400" aria-hidden>*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-mist/80">{hint}</p>}
    </div>
  );
}

export function formatPrice(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatCop(value);
}

// ---------------------------------------------------------------------------
// Acceso: sesión + módulo + permiso de escritura (solo presentación; el
// backend autoriza cada llamada).
// ---------------------------------------------------------------------------

export function useCatalogAccess(): { client: CatalogClient | null; canWrite: boolean; canManageOrders: boolean; enabled: boolean; ready: boolean } {
  const { session, rol, modulos, negocios } = useDashboard();
  const token = session?.access_token ?? null;
  const client = useMemo(() => (token ? createCatalogClient(token) : null), [token]);
  return {
    client,
    canWrite: rol === "admin",
    // Cerrar pedidos: admin y asesoras (el backend vuelve a validarlo: CATALOG_ORDER_ROLES).
    canManageOrders: rol === "admin" || rol === "agente",
    enabled: modulos.includes("catalogo"),
    // `negocios` y `modulos` llegan en la misma respuesta de /me.
    ready: negocios !== null,
  };
}

/** `modulo`: el módulo que exige la sección (Bloque 27: "pedidos" se habilita aparte del catálogo). */
export function CatalogGate({ children, modulo = "catalogo" }: { children: ReactNode; modulo?: "catalogo" | "pedidos" }) {
  const { t } = useI18n();
  const { ready } = useCatalogAccess();
  const { modulos } = useDashboard();
  const enabled = modulos.includes(modulo);
  if (!ready) {
    return (
      <div className="space-y-3 px-4 pt-6 md:px-8" aria-hidden>
        <div className="h-8 w-56 animate-pulse rounded-lg bg-ink-2" />
        <div className="h-32 animate-pulse rounded-2xl bg-card" />
        <div className="h-64 animate-pulse rounded-xl bg-card" />
      </div>
    );
  }
  if (!enabled) {
    return (
      <div className="px-4 pt-10 md:px-8">
        <div className="mx-auto max-w-md rounded-2xl border border-edge bg-card p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-ink-2 text-mist">
            <Package className="size-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-fg">{modulo === "pedidos" ? t("Pedidos no habilitado", "Orders not enabled") : t("Catálogo no habilitado", "Catalog not enabled")}</h2>
          <p className="mt-1.5 text-sm text-mist">
            {t("Este módulo todavía no está activo para tu cuenta. Escríbenos si quieres habilitarlo.", "This module is not active for your account yet. Contact us to enable it.")}
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Toast local del Catálogo
// ---------------------------------------------------------------------------

type ToastTone = "success" | "error";
type ToastItem = { id: number; tone: ToastTone; message: string };

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function CatalogToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((i) => i.id !== id)), []);
  const push = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-2), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "pointer-events-auto flex max-w-sm motion-safe:animate-[catalogo-toast-in_180ms_ease-out] items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg shadow-black/5 backdrop-blur",
              item.tone === "success" ? "border-edge bg-card text-fg" : "border-red-500/40 bg-red-500/10 text-red-400",
            )}
          >
            {item.tone === "success" ? <Check className="mt-0.5 size-4 shrink-0 text-lime-text" /> : <X className="mt-0.5 size-4 shrink-0" />}
            <span className="min-w-0 flex-1">{item.message}</span>
            <button type="button" onClick={() => dismiss(item.id)} className="text-mist transition-colors hover:text-fg" aria-label="Cerrar">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useCatalogToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// Precio COP (entero, con separador de miles mientras se escribe)
// ---------------------------------------------------------------------------

export function PriceInput({
  value,
  onChange,
  id,
  placeholder,
  disabled,
  invalid,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const display = value === null ? "" : value.toLocaleString("es-CO");
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-mist">$</span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={display}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
          onChange(digits === "" ? null : Number(digits));
        }}
        className={cn(
          "w-full rounded-lg border bg-ink py-2.5 pl-7 pr-3 text-sm tabular-nums text-fg outline-none transition-colors focus:border-lime/50 disabled:opacity-60",
          invalid ? "border-red-500/60" : "border-edge",
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Imagen perezosa con fundido (nunca carga miles de fotos de golpe)
// ---------------------------------------------------------------------------

export function ProductImage({ src, alt, className, fit = "cover" }: { src: string | null | undefined; alt: string; className?: string; fit?: "cover" | "contain" }) {
  // Se recuerda QUÉ src cargó/falló (no un booleano): al cambiar la imagen el
  // estado se reinicia solo, sin efectos y sin carreras con onLoad de caché.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loaded = Boolean(src) && loadedSrc === src;
  const failed = Boolean(src) && failedSrc === src;

  if (!src || failed) {
    return (
      <div className={cn("flex items-center justify-center bg-ink-2 text-mist/60", className)}>
        <ImageOff className="size-6" />
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden bg-ink-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- URLs públicas de Supabase Storage ya optimizadas (WebP) en la subida */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        // Una imagen en caché (o renderizada antes de hidratar) puede terminar
        // de cargar ANTES de que React conecte onLoad: se detecta al montar.
        ref={(el) => {
          if (el && el.complete && el.naturalWidth > 0 && loadedSrc !== src) setLoadedSrc(src);
        }}
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailedSrc(src)}
        className={cn(
          "size-full transition-opacity duration-300",
          fit === "cover" ? "object-cover" : "object-contain",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
      {!loaded && <div className="absolute inset-0 animate-pulse bg-ink-2" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado y referencia
// ---------------------------------------------------------------------------

export function StatusBadge({ status }: { status: ProductStatus }) {
  const { t } = useI18n();
  return status === "ACTIVE" ? (
    <Pill tone="success">
      <span className="size-1.5 rounded-full bg-current" />
      {t("Activo", "Active")}
    </Pill>
  ) : (
    <Pill tone="neutral">
      <span className="size-1.5 rounded-full bg-current" />
      {t("Inactivo", "Inactive")}
    </Pill>
  );
}

export function ReferenceTag({ reference, copyable = false, size = "sm" }: { reference: string; copyable?: boolean; size?: "sm" | "lg" }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = <span className={cn("font-mono tracking-tight", size === "lg" ? "text-base font-semibold text-fg" : "text-[11.5px] text-mist")}>{reference}</span>;
  if (!copyable) return text;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(reference);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Portapapeles no disponible (contexto no seguro): no es crítico.
        }
      }}
      className="group inline-flex items-center gap-1.5 rounded-md border border-edge bg-ink px-2 py-1 transition-colors hover:border-lime/40"
      title={t("Copiar referencia", "Copy reference")}
    >
      {text}
      {copied ? <Check className="size-3.5 text-lime-text" /> : <Copy className="size-3.5 text-mist group-hover:text-fg" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stock (entero >= 0: solo dígitos, nunca negativo) con pasos − / +
// ---------------------------------------------------------------------------

export function StockInput({
  value,
  onChange,
  id,
  disabled,
  invalid,
  max,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  max: number;
}) {
  const paso = "flex size-10 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:bg-ink-2 hover:text-fg active:scale-95 disabled:opacity-40";
  return (
    <div className={cn("flex items-center gap-1 rounded-lg border bg-ink p-1 transition-colors focus-within:border-lime/50", invalid ? "border-red-500/60" : "border-edge", disabled && "opacity-60")}>
      <button type="button" className={paso} disabled={disabled || value === null || value <= 0} onClick={() => onChange(Math.max(0, (value ?? 0) - 1))} aria-label="Una unidad menos">
        <Minus className="size-4" />
      </button>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        placeholder="—"
        value={value === null ? "" : String(value)}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 7);
          onChange(digits === "" ? null : Math.min(max, Number(digits)));
        }}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-center text-sm font-medium tabular-nums text-fg outline-none"
      />
      <button type="button" className={paso} disabled={disabled || (value ?? 0) >= max} onClick={() => onChange(Math.min(max, (value ?? 0) + 1))} aria-label="Una unidad más">
        <Plus className="size-4" />
      </button>
    </div>
  );
}
