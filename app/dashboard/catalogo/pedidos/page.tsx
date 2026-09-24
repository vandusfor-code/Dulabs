"use client";

// Bloque 19 — pedidos del catálogo con su stock apartado. La asesora cierra la venta
// (el stock queda descontado) o cancela (el stock vuelve). Todo lo decide el backend;
// esta vista solo muestra y pide la acción. Bloque 21: pestaña de historial (cerrados, por cursor).
// Bloque 25: cliente (nombre, modalidad detal / mayorista), fechas, fotos, asesora, filtros por estado
// y por modalidad, tomar la conversación y cambiar la modalidad del cliente (explícito, con motivo).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Clock, PackageCheck, RefreshCw, XCircle } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { PedidoPanel } from "@/lib/catalogo/pedidos/panel";
import { actionBtn, cn, formatPrice, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { HistorialPedidos } from "@/components/dashboard/catalogo/HistorialPedidos";
import { AccionesCliente, CANAL_LABEL, ClientePedido, DatosPedido, LineasPedido, destinoModalidad } from "@/components/dashboard/catalogo/PedidoDetalle";

type FiltroEstado = "todos" | "pending_confirmation" | "confirmed" | "handoff";
type FiltroCanal = "todos" | "retail" | "wholesale";

const FILTROS_ESTADO: Array<{ id: FiltroEstado; es: string; en: string }> = [
  { id: "todos", es: "Todos", en: "All" },
  { id: "pending_confirmation", es: "Propuestas", en: "Proposals" },
  { id: "confirmed", es: "Confirmados", en: "Confirmed" },
  { id: "handoff", es: "Con asesora", en: "With advisor" },
];
const FILTROS_CANAL: Array<{ id: FiltroCanal; es: string; en: string }> = [
  { id: "todos", es: "Detal y mayorista", en: "Retail & wholesale" },
  { id: "retail", es: "Detal", en: "Retail" },
  { id: "wholesale", es: "Mayorista", en: "Wholesale" },
];

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
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos");
  const [filtroCanal, setFiltroCanal] = useState<FiltroCanal>("todos");
  const visibles = useMemo(
    () => (pedidos ?? []).filter((p) => (filtroEstado === "todos" || p.estado === filtroEstado) && (filtroCanal === "todos" || p.canal === filtroCanal)),
    [pedidos, filtroEstado, filtroCanal],
  );

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

  async function tomar(p: PedidoPanel) {
    const c = p.contacto;
    if (!client || !c?.telefono) return;
    setEnCurso(`${p.pedido}:tomar`);
    const r = await client.takeConversation(c.numero, c.telefono);
    setEnCurso(null);
    if (!r.ok) return toast(r.error.message, "error");
    toast(t("Conversación tomada: el asistente deja de responder en ese chat.", "Conversation taken: the assistant stops replying in that chat."));
    cargar();
  }

  async function cambiarModalidad(p: PedidoPanel) {
    const c = p.contacto;
    if (!client || !c?.telefono) return;
    const destino = destinoModalidad(p);
    const nombre = c.nombre ?? `•••• ${c.telefono_parcial}`;
    const otros = (pedidos ?? []).filter((x) => x.contacto?.telefono === c.telefono && x.contacto?.numero === c.numero && x.canal !== destino).map((x) => x.pedido);
    const aviso = otros.length
      ? t(
          `\n\nSus pedidos abiertos (${otros.join(", ")}) conservan su modalidad y sus precios: cancélalos o ciérralos tú; el asistente no los confirmará.`,
          `\n\nTheir open orders (${otros.join(", ")}) keep their type and prices: cancel or close them yourself; the assistant won't confirm them.`,
        )
      : "";
    const motivo = window.prompt(
      t(
        `Pasar a ${nombre} a cliente ${CANAL_LABEL[destino].es.toLowerCase()}. Desde su próximo mensaje verá el catálogo y los precios ${destino === "wholesale" ? "mayoristas" : "al detal"}.${aviso}\n\nMotivo del cambio (queda registrado):`,
        `Switch ${nombre} to ${CANAL_LABEL[destino].en.toLowerCase()}. From their next message they'll see ${destino === "wholesale" ? "wholesale" : "retail"} catalog and prices.${aviso}\n\nReason (recorded):`,
      ),
    );
    if (motivo === null) return;
    if (motivo.trim().length < 3) return toast(t("Escribe un motivo (mínimo 3 caracteres).", "Write a reason (at least 3 characters)."), "error");
    setEnCurso(`${p.pedido}:modalidad`);
    const r = await client.changeCustomerChannel({ numero: c.numero, telefono: c.telefono, canal: destino, canalActual: c.tipo, motivo: motivo.trim() });
    setEnCurso(null);
    if (!r.ok) {
      toast(r.error.message, "error");
      cargar();
      return;
    }
    toast(t(`${nombre}: cliente ${CANAL_LABEL[destino].es.toLowerCase()}.`, `${nombre}: ${CANAL_LABEL[destino].en.toLowerCase()} customer.`));
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
          <HistorialPedidos client={client} canal={filtroCanal} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-4 pt-4 md:px-8">
        {vista === "abiertos" &&
          FILTROS_ESTADO.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltroEstado(f.id)}
              className={cn("rounded-full border px-3 py-1 text-sm", filtroEstado === f.id ? "border-fg bg-fg font-medium text-ink" : "border-edge text-mist hover:text-fg")}
            >
              {t(f.es, f.en)}
            </button>
          ))}
        <span className="mx-1 hidden w-px bg-edge sm:block" aria-hidden />
        {FILTROS_CANAL.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltroCanal(f.id)}
            className={cn("rounded-full border px-3 py-1 text-sm", filtroCanal === f.id ? "border-fg bg-fg font-medium text-ink" : "border-edge text-mist hover:text-fg")}
          >
            {t(f.es, f.en)}
          </button>
        ))}
      </div>

      <div className={cn("space-y-3 px-4 pt-4 md:px-8", vista !== "abiertos" && "hidden")}>
        {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
        {pedidos === null && !error && <div className="h-32 animate-pulse rounded-2xl bg-card" aria-hidden />}
        {pedidos !== null && visibles.length === 0 && (
          <div className="rounded-2xl border border-edge bg-card p-8 text-center text-sm text-mist">
            {pedidos.length === 0 ? t("No hay pedidos abiertos.", "No open orders.") : t("Ningún pedido abierto con este filtro.", "No open orders match this filter.")}
          </div>
        )}
        {visibles.map((p) => {
          const estado = ESTADO[p.estado] ?? { es: p.estado, en: p.estado, tone: "bg-ink-2 text-mist" };
          const cerrable = p.estado === "confirmed" || p.estado === "handoff";
          return (
            <article key={p.pedido} className="rounded-2xl border border-edge bg-card p-4 sm:p-5">
              <header className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-fg">{p.pedido}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", estado.tone)}>{t(estado.es, estado.en)}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px]", p.canal === "wholesale" ? "bg-violet-500/15 text-violet-400" : "bg-ink-2 text-mist")}>
                  {t(`Pedido ${CANAL_LABEL[p.canal].es.toLowerCase()}`, `${CANAL_LABEL[p.canal].en} order`)}
                </span>
              </header>
              <div className="mt-2">
                <ClientePedido p={p} t={t} />
              </div>
              <LineasPedido p={p} t={t} />
              <DatosPedido p={p} t={t} />
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
                  <div className="flex flex-wrap gap-2">
                    <AccionesCliente p={p} t={t} enCurso={enCurso !== null} onTomar={(x) => void tomar(x)} onCambiarModalidad={(x) => void cambiarModalidad(x)} />
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
