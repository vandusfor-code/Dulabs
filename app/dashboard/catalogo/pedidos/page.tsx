"use client";

// Bloque 19 — pedidos del catálogo con su stock apartado. La asesora cierra la venta
// (el stock queda descontado) o cancela (el stock vuelve). Todo lo decide el backend;
// esta vista solo muestra y pide la acción. Bloque 21: pestaña de historial (cerrados, por cursor).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Clock, PackageCheck, RefreshCw, XCircle } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { PedidoPanel } from "@/lib/catalogo/pedidos/panel";
import { actionBtn, cn, formatPrice, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { HistorialPedidos } from "@/components/dashboard/catalogo/HistorialPedidos";

const ESTADO: Record<string, { es: string; en: string; tone: string }> = {
  pending_confirmation: { es: "Esperando confirmación", en: "Awaiting confirmation", tone: "bg-ink-2 text-mist" },
  confirmed: { es: "Confirmado", en: "Confirmed", tone: "bg-lime-soft text-lime-text" },
  handoff: { es: "Con asesora", en: "With advisor", tone: "bg-amber-500/15 text-amber-500" },
};

function venceEn(iso: string, t: (es: string, en: string) => string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t("vencido", "expired");
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return t(`vence en ${Math.floor(h / 24)} d ${h % 24} h`, `expires in ${Math.floor(h / 24)}d ${h % 24}h`);
  return t(`vence en ${h} h ${Math.floor((ms % 3_600_000) / 60_000)} min`, `expires in ${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`);
}

export default function PedidosPage() {
  const { t } = useI18n();
  const toast = useCatalogToast();
  const { client, canManageOrders } = useCatalogAccess();
  const [pedidos, setPedidos] = useState<PedidoPanel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [vista, setVista] = useState<"abiertos" | "historial">("abiertos");

  // Cada cambio de `version` vuelve a pedir la lista (después de cerrar un pedido o al tocar "Actualizar").
  const [version, setVersion] = useState(0);
  const cargar = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listOrders().then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setPedidos(r.data.pedidos);
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [client, version]);

  async function cerrar(p: PedidoPanel, accion: "completar" | "cancelar") {
    if (!client) return;
    const pregunta =
      accion === "completar"
        ? t(`¿Marcar ${p.pedido} como venta cerrada? El stock queda descontado.`, `Mark ${p.pedido} as sold? Stock stays deducted.`)
        : t(`¿Cancelar ${p.pedido}? El stock apartado vuelve al inventario.`, `Cancel ${p.pedido}? Reserved stock returns to inventory.`);
    if (!window.confirm(pregunta)) return;
    setEnCurso(`${p.pedido}:${accion}`);
    const r = await client.closeOrder(p.pedido, accion);
    setEnCurso(null);
    if (!r.ok) {
      toast(r.error.message, "error");
      cargar();
      return;
    }
    toast(accion === "completar" ? t(`${p.pedido}: venta cerrada.`, `${p.pedido}: sold.`) : t(`${p.pedido}: cancelado, el stock volvió.`, `${p.pedido}: cancelled, stock returned.`));
    cargar();
  }

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={t("Catálogo", "Catalog")}
        title={t("Pedidos", "Orders")}
        description={t(
          "Pedidos abiertos del catálogo. Al confirmar, el stock queda apartado; ciérralo como venta o cancélalo para devolverlo. Si nadie lo cierra, vuelve solo a las 72 horas (salvo los que tiene una asesora).",
          "Open catalog orders. On confirmation, stock is reserved; close it as a sale or cancel it to return it. If nobody closes it, it returns automatically after 72 hours (except those held by an advisor).",
        )}
      >
        <Link href="/dashboard/catalogo" className={actionBtn}>
          <ChevronLeft className="size-4" />
          {t("Productos", "Products")}
        </Link>
        <button type="button" onClick={cargar} className={actionBtn}>
          <RefreshCw className="size-4" />
          {t("Actualizar", "Refresh")}
        </button>
      </PageHeader>

      <div className="flex gap-2 px-4 pt-6 md:px-8" role="tablist">
        {(
          [
            ["abiertos", t("Abiertos", "Open")],
            ["historial", t("Historial", "History")],
          ] as const
        ).map(([id, etiqueta]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={vista === id}
            onClick={() => setVista(id)}
            className={cn("rounded-xl px-3.5 py-1.5 text-sm font-medium", vista === id ? "bg-fg text-ink" : "text-mist hover:text-fg")}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {vista === "historial" && client && (
        <div className="px-4 pt-4 md:px-8">
          <HistorialPedidos client={client} />
        </div>
      )}

      <div className={cn("space-y-3 px-4 pt-4 md:px-8", vista !== "abiertos" && "hidden")}>
        {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
        {pedidos === null && !error && <div className="h-32 animate-pulse rounded-2xl bg-card" aria-hidden />}
        {pedidos?.length === 0 && (
          <div className="rounded-2xl border border-edge bg-card p-8 text-center text-sm text-mist">{t("No hay pedidos abiertos.", "No open orders.")}</div>
        )}
        {pedidos?.map((p) => {
          const estado = ESTADO[p.estado] ?? { es: p.estado, en: p.estado, tone: "bg-ink-2 text-mist" };
          const cerrable = p.estado === "confirmed" || p.estado === "handoff";
          return (
            <article key={p.pedido} className="rounded-2xl border border-edge bg-card p-4 sm:p-5">
              <header className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-fg">{p.pedido}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", estado.tone)}>{t(estado.es, estado.en)}</span>
                {p.canal === "wholesale" && <span className="rounded-full bg-ink-2 px-2 py-0.5 text-[11px] text-mist">{t("Mayorista", "Wholesale")}</span>}
                {p.cliente && <span className="text-xs text-mist">+{p.cliente}</span>}
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
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-3">
                <div className="text-sm">
                  <span className="font-semibold tabular-nums text-fg">{formatPrice(p.total)}</span>
                  <span className="ml-3 inline-flex items-center gap-1 text-xs text-mist">
                    <Clock className="size-3.5" />
                    {p.stock.estado === "apartado"
                      ? `${t(`${p.stock.unidades} apartadas`, `${p.stock.unidades} reserved`)}${p.estado === "confirmed" && p.stock.vence ? ` · ${venceEn(p.stock.vence, t)}` : ""}`
                      : t("sin stock apartado", "no stock reserved")}
                  </span>
                </div>
                {canManageOrders && (
                  <div className="flex gap-2">
                    {cerrable && (
                      <button type="button" disabled={enCurso !== null} onClick={() => void cerrar(p, "completar")} className={primaryBtn}>
                        <PackageCheck className="size-4" />
                        {enCurso === `${p.pedido}:completar` ? t("Cerrando…", "Closing…") : t("Venta cerrada", "Mark as sold")}
                      </button>
                    )}
                    <button type="button" disabled={enCurso !== null} onClick={() => void cerrar(p, "cancelar")} className={actionBtn}>
                      <XCircle className="size-4" />
                      {enCurso === `${p.pedido}:cancelar` ? t("Cancelando…", "Cancelling…") : t("Cancelar", "Cancel")}
                    </button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
