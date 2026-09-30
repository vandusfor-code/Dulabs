"use client";

// Bloque 27 — módulo "Pedidos": pedidos YA confirmados del negocio, por última actualización, con
// filtros (pago, modalidad, método, entrega, periodo y búsqueda). Todo lo filtra y pagina el
// backend (cursor); esta vista solo muestra. El teléfono solo lo ve quien atiende (admin / agente).
// Bloque 35: pestañas con contador (Todos, Pendientes, En preparación…), periodo, tarjetas compactas
// (el resto del detalle vive en la página del pedido) y eliminar pedidos cerrados (solo admin).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Clock, Copy, MessageCircle, Package, RefreshCw, Search, Store, Trash2, Truck } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { GrupoPedidos, PedidoGestion } from "@/lib/catalogo/pedidos/gestion";
import type { PedidosFiltros } from "@/lib/catalogo-client";
import { actionBtn, cn, formatPrice, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { CANAL_LABEL } from "@/components/dashboard/catalogo/PedidoDetalle";
import { ENTREGA, EstadoBadge, METODO, PagoBadge, fecha, hace, nombreCliente, rangoPeriodo, telefonoCliente, type Periodo } from "@/components/dashboard/pedidos/ui";

const PESTANAS: Array<{ id: GrupoPedidos; es: string; en: string }> = [
  { id: "todos", es: "Todos", en: "All" },
  { id: "pendientes", es: "Pendientes", en: "Pending" },
  { id: "en_preparacion", es: "En preparación", en: "Preparing" },
  { id: "enviados", es: "Enviados", en: "Shipped" },
  { id: "entregados", es: "Entregados", en: "Delivered" },
  { id: "completados", es: "Completados", en: "Completed" },
  { id: "cancelados", es: "Cancelados", en: "Cancelled" },
];

const PERIODOS: Array<{ id: Periodo; es: string; en: string }> = [
  { id: "hoy", es: "Hoy", en: "Today" },
  { id: "7d", es: "Últimos 7 días", en: "Last 7 days" },
  { id: "30d", es: "Últimos 30 días", en: "Last 30 days" },
  { id: "90d", es: "Últimos 90 días", en: "Last 90 days" },
  { id: "todo", es: "Todo el tiempo", en: "All time" },
  { id: "rango", es: "Personalizado", en: "Custom" },
];

const select = "rounded-xl border border-edge bg-card px-3 py-1.5 text-sm text-fg";

export default function PedidosGestionPage() {
  const { t } = useI18n();
  const { client, canManageOrders, canWrite } = useCatalogAccess();
  const toast = useCatalogToast();
  const [grupo, setGrupo] = useState<GrupoPedidos>("todos");
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [rango, setRango] = useState<{ desde?: string; hasta?: string }>({});
  const [filtros, setFiltros] = useState<Omit<PedidosFiltros, "grupo" | "desde" | "hasta" | "estado">>({});
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState<{ clave: string; pedidos: PedidoGestion[]; siguiente: string | null } | null>(null);
  const [conteos, setConteos] = useState<Record<GrupoPedidos, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [version, setVersion] = useState(0);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState<string | null>(null);

  const consulta: PedidosFiltros = { ...filtros, grupo, ...(periodo === "rango" ? rango : rangoPeriodo(periodo)) };
  const clave = JSON.stringify(consulta);

  // Primera página (con los contadores) de cada combinación; una respuesta vieja nunca pisa la nueva.
  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listManagedOrders(consulta).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setPagina({ clave, pedidos: r.data.pedidos, siguiente: r.data.siguiente });
        if (r.data.conteos !== undefined) setConteos(r.data.conteos);
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clave` resume la consulta
  }, [client, clave, version]);

  const actual = pagina?.clave === clave ? pagina : null;
  const set = useCallback((patch: Partial<PedidosFiltros>) => setFiltros((f) => ({ ...f, ...patch })), []);

  async function cargarMas() {
    if (!client || !actual?.siguiente) return;
    setCargandoMas(true);
    const r = await client.listManagedOrders(consulta, actual.siguiente);
    setCargandoMas(false);
    if (!r.ok) return setError(r.error.message);
    setPagina((p) => (p && p.clave === clave ? { clave, pedidos: [...p.pedidos, ...r.data.pedidos], siguiente: r.data.siguiente } : p));
  }

  async function copiar(pedido: string) {
    try {
      await navigator.clipboard.writeText(pedido);
      setCopiado(pedido);
      window.setTimeout(() => setCopiado((c) => (c === pedido ? null : c)), 1500);
    } catch {
      toast(t("No se pudo copiar.", "Could not copy."), "error");
    }
  }

  async function eliminar(p: PedidoGestion) {
    if (!client || eliminando) return;
    const ok = window.confirm(
      t(
        `¿Eliminar el pedido ${p.pedido}? Se borra con su historial y ya no aparecerá en Pedidos ni en Clientes. No se puede deshacer.`,
        `Delete order ${p.pedido}? It is removed with its history and will no longer appear in Orders or Customers. This cannot be undone.`,
      ),
    );
    if (!ok) return;
    setEliminando(p.pedido);
    const r = await client.deleteManagedOrder(p.pedido);
    setEliminando(null);
    if (!r.ok) return toast(r.error.message, "error");
    toast(t(`✓ Pedido ${p.pedido} eliminado.`, `✓ Order ${p.pedido} deleted.`));
    setVersion((v) => v + 1);
  }

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={t("Operación", "Operations")}
        title={t("Pedidos", "Orders")}
        description={t(
          "Pedidos confirmados por tus clientes. Registra el pago, la preparación, el envío y la entrega; cada paso queda en el historial con quién lo hizo.",
          "Orders confirmed by your customers. Record payment, preparation, shipping and delivery; every step is logged with who did it.",
        )}
      >
        <button type="button" onClick={() => setVersion((v) => v + 1)} className={actionBtn}>
          <RefreshCw className="size-4" />
          {t("Actualizar", "Refresh")}
        </button>
      </PageHeader>

      <form
        className="flex flex-wrap items-center gap-2 px-4 pt-6 md:px-8"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: busqueda.trim() || undefined });
        }}
      >
        <select aria-label={t("Pago", "Payment")} className={select} value={filtros.pago ?? ""} onChange={(e) => set({ pago: (e.target.value || undefined) as PedidosFiltros["pago"] })}>
          <option value="">{t("Pago: todos", "Payment: all")}</option>
          <option value="pendiente">{t("Pago pendiente", "Payment pending")}</option>
          <option value="recibido">{t("Pago recibido", "Payment received")}</option>
        </select>
        <select aria-label={t("Modalidad", "Type")} className={select} value={filtros.modalidad ?? ""} onChange={(e) => set({ modalidad: (e.target.value || undefined) as PedidosFiltros["modalidad"] })}>
          <option value="">{t("Detal y mayorista", "Retail & wholesale")}</option>
          <option value="detal">{t("Detal", "Retail")}</option>
          <option value="mayorista">{t("Mayorista", "Wholesale")}</option>
        </select>
        <select aria-label={t("Método de pago", "Payment method")} className={select} value={filtros.metodo ?? ""} onChange={(e) => set({ metodo: (e.target.value || undefined) as PedidosFiltros["metodo"] })}>
          <option value="">{t("Método: todos", "Method: all")}</option>
          <option value="pago_en_tienda">{t(METODO.pago_en_tienda.es, METODO.pago_en_tienda.en)}</option>
          <option value="transferencia">{t(METODO.transferencia.es, METODO.transferencia.en)}</option>
        </select>
        <select aria-label={t("Entrega", "Delivery")} className={select} value={filtros.entrega ?? ""} onChange={(e) => set({ entrega: (e.target.value || undefined) as PedidosFiltros["entrega"] })}>
          <option value="">{t("Entrega: todas", "Delivery: all")}</option>
          <option value="tienda">{t(ENTREGA.tienda.es, ENTREGA.tienda.en)}</option>
          <option value="domicilio">{t(ENTREGA.domicilio.es, ENTREGA.domicilio.en)}</option>
        </select>
        <select aria-label={t("Periodo", "Period")} className={select} value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
          {PERIODOS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.es, p.en)}
            </option>
          ))}
        </select>
        {periodo === "rango" && (
          <>
            <input type="date" aria-label={t("Desde", "From")} className={select} value={rango.desde ?? ""} onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value || undefined }))} />
            <input type="date" aria-label={t("Hasta", "To")} className={select} value={rango.hasta ?? ""} onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value || undefined }))} />
          </>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="search"
            maxLength={60}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={canManageOrders ? t("Pedido, nombre, referencia o teléfono", "Order, name, reference or phone") : t("Pedido, nombre o referencia", "Order, name or reference")}
            className={cn(select, "min-w-[12rem] flex-1")}
          />
          <button type="submit" className={actionBtn}>
            <Search className="size-4" />
            <span className="sr-only">{t("Buscar", "Search")}</span>
          </button>
        </div>
      </form>

      <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-edge px-4 md:px-8" aria-label={t("Estado de los pedidos", "Order status")}>
        {PESTANAS.map((p) => {
          const activa = grupo === p.id;
          const n = conteos?.[p.id];
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={activa}
              onClick={() => setGrupo(p.id)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors",
                activa ? "border-lime font-medium text-fg" : "border-transparent text-mist hover:text-fg",
              )}
            >
              {t(p.es, p.en)}
              {n !== undefined && (
                <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] tabular-nums", activa ? "bg-lime text-lime-fg" : "bg-ink-2 text-mist")}>{n}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-2.5 px-4 pt-4 md:px-8">
        {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
        {!actual && !error && <div className="h-32 animate-pulse rounded-2xl bg-card" aria-hidden />}
        {actual && actual.pedidos.length === 0 && (
          <div className="rounded-2xl border border-edge bg-card p-8 text-center text-sm text-mist">{t("No hay pedidos con estos filtros.", "No orders match these filters.")}</div>
        )}
        {actual?.pedidos.map((p) => {
          const tel = telefonoCliente(p);
          const chat = p.contacto?.telefono ? `/dashboard/mensajes?${new URLSearchParams({ phone_number_id: p.contacto.numero, telefono_cliente: p.contacto.telefono })}` : null;
          const entrega = p.checkout?.entrega ?? null;
          return (
            <div key={p.pedido} className="relative rounded-2xl border border-edge bg-card px-4 py-3.5 transition hover:border-fg/40 sm:px-5">
              {/* Toda la tarjeta abre el pedido; los botones de adentro van por encima. */}
              <Link href={`/dashboard/pedidos/${p.pedido}`} className="absolute inset-0 rounded-2xl" aria-label={t(`Abrir pedido ${p.pedido}`, `Open order ${p.pedido}`)} />
              <div className="grid items-center gap-x-6 gap-y-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto]">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-sm font-semibold text-fg">{p.pedido}</span>
                    <button type="button" onClick={() => void copiar(p.pedido)} className="relative z-10 rounded p-1 text-mist hover:text-fg" aria-label={t("Copiar número de pedido", "Copy order number")}>
                      {copiado === p.pedido ? <Check className="size-3.5 text-lime-text" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-mist">
                    <span className="truncate text-fg/90">{nombreCliente(p, t)}</span>
                    {tel && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{tel}</span>
                      </>
                    )}
                    {chat && (
                      <Link href={chat} className="relative z-10 rounded p-0.5 text-emerald-500 hover:text-emerald-400" aria-label={t("Abrir chat", "Open chat")}>
                        <MessageCircle className="size-3.5" />
                      </Link>
                    )}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EstadoBadge estado={p.estado_visible} t={t} />
                    <PagoBadge pago={p.estado_pago} t={t} />
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", p.canal === "wholesale" ? "bg-violet-500/15 text-violet-400" : "bg-pink-500/15 text-pink-400")}>
                      {t(CANAL_LABEL[p.canal].es, CANAL_LABEL[p.canal].en)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-mist">
                    {entrega === "tienda" ? <Store className="size-3.5" aria-hidden /> : entrega === "domicilio" ? <Truck className="size-3.5" aria-hidden /> : <Package className="size-3.5" aria-hidden />}
                    <span>{entrega ? t(ENTREGA[entrega].es, ENTREGA[entrega].en) : t("Pedido anterior al checkout", "Pre-checkout order")}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{p.asesora?.asignada ?? t("Sin asignar", "Unassigned")}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 md:justify-end">
                  <div className="text-left md:text-right">
                    <div className="font-semibold tabular-nums text-fg">{formatPrice(p.total)}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-mist md:justify-end" title={fecha(p.actualizado)}>
                      <Clock className="size-3" aria-hidden />
                      {hace(p.actualizado, t)}
                    </div>
                    {p.vence_reserva && (
                      <div className="mt-0.5 text-[11px] text-amber-500" title={fecha(p.vence_reserva)}>
                        {t("Vence", "Expires")} {hace(p.vence_reserva, t)}
                      </div>
                    )}
                  </div>
                  {canWrite && p.eliminable && (
                    <button
                      type="button"
                      disabled={eliminando === p.pedido}
                      onClick={() => void eliminar(p)}
                      className="relative z-10 rounded-lg p-1.5 text-mist hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                      aria-label={t(`Eliminar pedido ${p.pedido}`, `Delete order ${p.pedido}`)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                  <ChevronRight className="size-4 text-mist" aria-hidden />
                </div>
              </div>
            </div>
          );
        })}
        {actual?.siguiente && (
          <button type="button" disabled={cargandoMas} onClick={() => void cargarMas()} className={cn(actionBtn, "w-full justify-center")}>
            {cargandoMas ? t("Cargando…", "Loading…") : t("Ver más", "Load more")}
          </button>
        )}
      </div>
    </div>
  );
}
