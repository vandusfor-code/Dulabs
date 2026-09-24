"use client";

// Bloque 21 — historial de pedidos CERRADOS (venta cerrada, cancelados, vencidos), de a una página
// por vez con cursor: nunca se cargan cientos de pedidos de golpe. Todo lo decide el backend; esta
// vista solo muestra.
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Undo2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { PedidoHistorial } from "@/lib/catalogo/pedidos/panel";
import type { CatalogClient } from "@/lib/catalogo-client";
import { actionBtn, cn, formatPrice } from "@/components/dashboard/catalogo/ui";

type Filtro = "todos" | "completed" | "cancelled" | "expired";

const FILTROS: Array<{ id: Filtro; es: string; en: string }> = [
  { id: "todos", es: "Todos", en: "All" },
  { id: "completed", es: "Ventas cerradas", en: "Sold" },
  { id: "cancelled", es: "Cancelados", en: "Cancelled" },
  { id: "expired", es: "Vencidos", en: "Expired" },
];

const ESTADO: Record<string, { es: string; en: string; tone: string }> = {
  completed: { es: "Venta cerrada", en: "Sold", tone: "bg-lime-soft text-lime-text" },
  cancelled: { es: "Cancelado", en: "Cancelled", tone: "bg-ink-2 text-mist" },
  expired: { es: "Vencido", en: "Expired", tone: "bg-amber-500/15 text-amber-500" },
};

function fecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });
}

export function HistorialPedidos({ client }: { client: CatalogClient }) {
  const { t } = useI18n();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [pagina, setPagina] = useState<{ filtro: Filtro; pedidos: PedidoHistorial[]; siguiente: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);

  // Primera página de cada filtro. La respuesta se guarda con su filtro: una respuesta vieja nunca pisa la nueva.
  useEffect(() => {
    let vivo = true;
    void client.listOrderHistory({ estado: filtro === "todos" ? undefined : filtro }).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setPagina({ filtro, pedidos: r.data.pedidos, siguiente: r.data.siguiente });
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client, filtro]);

  const actual = pagina?.filtro === filtro ? pagina : null;

  async function cargarMas() {
    if (!actual?.siguiente) return;
    setCargandoMas(true);
    const r = await client.listOrderHistory({ estado: filtro === "todos" ? undefined : filtro, cursor: actual.siguiente });
    setCargandoMas(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    // Sin duplicados aunque se toque dos veces: el número público es único por negocio.
    setPagina((p) => (p && p.filtro === filtro ? { filtro, pedidos: [...p.pedidos, ...r.data.pedidos.filter((n) => !p.pedidos.some((x) => x.pedido === n.pedido))], siguiente: r.data.siguiente } : p));
  }

  return (
    <div className="space-y-3">
      <nav aria-label={t("Filtrar historial", "Filter history")} className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={cn("rounded-full border px-3 py-1 text-sm", filtro === f.id ? "border-fg bg-fg font-medium text-ink" : "border-edge text-mist hover:text-fg")}
          >
            {t(f.es, f.en)}
          </button>
        ))}
      </nav>
      {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
      {!actual && !error && <div className="h-32 animate-pulse rounded-2xl bg-card" aria-hidden />}
      {actual?.pedidos.length === 0 && <div className="rounded-2xl border border-edge bg-card p-8 text-center text-sm text-mist">{t("No hay pedidos en el historial.", "No orders in history.")}</div>}
      {actual?.pedidos.map((p) => {
        const estado = ESTADO[p.estado] ?? { es: p.estado, en: p.estado, tone: "bg-ink-2 text-mist" };
        return (
          <article key={p.pedido} className="rounded-2xl border border-edge bg-card p-4 sm:p-5">
            <header className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-fg">{p.pedido}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", estado.tone)}>{t(estado.es, estado.en)}</span>
              {p.canal === "wholesale" && <span className="rounded-full bg-ink-2 px-2 py-0.5 text-[11px] text-mist">{t("Mayorista", "Wholesale")}</span>}
              {p.cliente && <span className="text-xs text-mist">+{p.cliente}</span>}
              <span className="ml-auto text-xs text-mist">{t(`Cerrado el ${fecha(p.cerrado)}`, `Closed ${fecha(p.cerrado)}`)}</span>
            </header>
            <ul className="mt-3 space-y-1 text-sm">
              {p.lineas.map((l) => (
                <li key={l.referencia} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-fg">
                    <span className="font-mono text-xs text-mist">{l.referencia}</span> · {l.nombre} × {l.cantidad}
                  </span>
                  <span className="shrink-0 tabular-nums text-mist">{l.subtotal === null ? t("a consultar", "on request") : formatPrice(l.subtotal)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-edge pt-3 text-sm">
              <span className="font-semibold tabular-nums text-fg">{formatPrice(p.total)}</span>
              <span className="inline-flex items-center gap-1 text-xs text-mist">
                {p.stock.estado === "vendido" ? <CheckCircle2 className="size-3.5" /> : p.stock.estado === "devuelto" ? <Undo2 className="size-3.5" /> : <Clock className="size-3.5" />}
                {p.stock.estado === "vendido"
                  ? t(`${p.stock.unidades} vendidas (descontadas)`, `${p.stock.unidades} sold (deducted)`)
                  : p.stock.estado === "devuelto"
                    ? t(`${p.stock.unidades} devueltas al inventario`, `${p.stock.unidades} returned to stock`)
                    : t("sin stock apartado", "no stock reserved")}
              </span>
              <span className="text-xs text-mist">{t(`Creado el ${fecha(p.creado)}`, `Created ${fecha(p.creado)}`)}</span>
            </div>
          </article>
        );
      })}
      {actual?.siguiente && (
        <div className="flex justify-center pt-2">
          <button type="button" onClick={() => void cargarMas()} disabled={cargandoMas} className={actionBtn}>
            {cargandoMas ? t("Cargando…", "Loading…") : t("Ver más", "Load more")}
          </button>
        </div>
      )}
    </div>
  );
}
