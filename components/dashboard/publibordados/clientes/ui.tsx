"use client";

/**
 * Publi Bordados · módulo Clientes — piezas compartidas de las pantallas Solicitudes y Clientes.
 * Solo presentación: toda autorización y filtrado vive en la API.
 */
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Pill } from "@/components/dashboard/shell/ui";
import { actionBtn } from "@/components/dashboard/business-agent/ui";
import { useDashboard } from "@/lib/dashboard-session";
import { useI18n } from "@/lib/i18n";
import { ETIQUETA_ESTADO, type EstadoSolicitud } from "@/lib/publibordados/clientes/modelo";

export const MODULO = "publibordados_clientes";

export function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export const TONO_ESTADO: Record<EstadoSolicitud, "info" | "warning" | "success"> = {
  nuevo: "info",
  en_atencion: "warning",
  atendido: "success",
};

export function EstadoPill({ estado }: { estado: EstadoSolicitud }) {
  return <Pill tone={TONO_ESTADO[estado]}>{ETIQUETA_ESTADO[estado]}</Pill>;
}

/** Sesión + módulo + permiso (solo presentación; la API vuelve a validarlo todo). */
export function useAccesoPb() {
  const { session, rol, modulos, negocios } = useDashboard();
  return {
    token: session?.access_token ?? null,
    habilitado: modulos.includes(MODULO),
    listo: negocios !== null,
    puedeEditar: rol === "admin" || rol === "agente",
  };
}

/** GET a la API con el token de la sesión. La respuesta vieja nunca pisa a la actual. */
export function useConsulta<T>(url: string | null, token: string | null, recarga = 0) {
  const clave = `${url}#${recarga}`;
  const [estado, setEstado] = useState<{ clave: string; data: T | null; error: string | null } | null>(null);
  const { t } = useI18n();
  useEffect(() => {
    if (!url || !token) return;
    let vivo = true;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("No se pudo cargar la información.", "Couldn't load the data."));
        if (vivo) setEstado({ clave, data: data as T, error: null });
      })
      .catch((err) => {
        if (vivo) setEstado((prev) => ({ clave, data: prev?.data ?? null, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      vivo = false;
    };
  }, [url, token, clave, t]);
  return { data: estado?.data ?? null, error: estado?.error ?? null, cargando: estado?.clave !== clave };
}

export function Pestanas({ activa }: { activa: "solicitudes" | "clientes" }) {
  const { t } = useI18n();
  const item = (id: "solicitudes" | "clientes", href: string, label: string) => (
    <Link
      href={href}
      aria-current={activa === id ? "page" : undefined}
      className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", activa === id ? "bg-card font-medium text-fg" : "text-mist hover:text-fg")}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex rounded-lg border border-edge p-0.5" aria-label={t("Secciones", "Sections")}>
      {item("solicitudes", "/dashboard/publibordados/solicitudes", t("Solicitudes", "Requests"))}
      {item("clientes", "/dashboard/publibordados/clientes", t("Clientes", "Customers"))}
    </nav>
  );
}

export function Paginacion({ pagina, paginas, cargando, onCambiar }: { pagina: number; paginas: number; cargando: boolean; onCambiar: (p: number) => void }) {
  const { t } = useI18n();
  if (paginas <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-mist">
      <span>
        {t("Página", "Page")} {pagina} / {paginas}
      </span>
      <div className="flex gap-2">
        <button className={actionBtn} disabled={pagina <= 1 || cargando} onClick={() => onCambiar(pagina - 1)}>
          <ChevronLeft className="size-4" />
          {t("Anterior", "Previous")}
        </button>
        <button className={actionBtn} disabled={pagina >= paginas || cargando} onClick={() => onCambiar(pagina + 1)}>
          {t("Siguiente", "Next")}
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Panel lateral (ficha). Esc o clic afuera cierran. */
export function Panel({ titulo, subtitulo, encabezado, onCerrar, children }: { titulo: string; subtitulo: string; encabezado?: ReactNode; onCerrar: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onCerrar} role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-edge bg-ink p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-widest text-mist">{subtitulo}</p>
            <h2 className="mt-1 truncate text-xl font-semibold text-fg">{titulo}</h2>
            {encabezado && <div className="mt-2">{encabezado}</div>}
          </div>
          <button onClick={onCerrar} className="rounded-lg border border-edge p-2 text-fg hover:bg-card" aria-label={t("Cerrar", "Close")}>
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-5 space-y-4">{children}</div>
      </aside>
    </div>
  );
}

export function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-edge bg-card p-4">
      <h3 className="font-mono text-[11px] uppercase tracking-widest text-mist">{titulo}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-edge py-2 last:border-b-0">
      <dt className="text-xs text-mist">{label}</dt>
      <dd className="text-right text-sm text-fg">{children}</dd>
    </div>
  );
}

export function Aviso({ tipo, children }: { tipo: "error" | "vacio" | "cargando"; children: ReactNode }) {
  return <p className={cn("p-5 text-sm", tipo === "error" ? "text-red-400" : "text-mist")}>{children}</p>;
}
