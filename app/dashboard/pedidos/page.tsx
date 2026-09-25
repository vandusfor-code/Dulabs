"use client";

// Bloque 27 — módulo "Pedidos": pedidos YA confirmados del negocio, por última actualización, con
// filtros (estado, pago, modalidad, método, entrega, fechas y búsqueda). Todo lo filtra y pagina el
// backend (cursor); esta vista solo muestra. El teléfono solo lo ve quien atiende (admin / agente).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, RefreshCw, Search } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { PedidoGestion } from "@/lib/catalogo/pedidos/gestion";
import type { PedidosFiltros } from "@/lib/catalogo-client";
import { actionBtn, cn, formatPrice, useCatalogAccess } from "@/components/dashboard/catalogo/ui";
import { CANAL_LABEL } from "@/components/dashboard/catalogo/PedidoDetalle";
import { ENTREGA, ESTADO_VISIBLE, EstadoBadge, METODO, fecha, nombreCliente, telefonoCliente } from "@/components/dashboard/pedidos/ui";

const ESTADOS = ["todos", "pendiente_pago", "pago_recibido", "en_preparacion", "enviado", "completado", "cancelado", "rechazado", "vencido"] as const;
const select = "rounded-xl border border-edge bg-card px-3 py-1.5 text-sm text-fg";

export default function PedidosGestionPage() {
  const { t } = useI18n();
  const { client, canManageOrders } = useCatalogAccess();
  const [filtros, setFiltros] = useState<PedidosFiltros>({ estado: "todos" });
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState<{ clave: string; pedidos: PedidoGestion[]; siguiente: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [version, setVersion] = useState(0);
  const clave = JSON.stringify(filtros);

  // Primera página de cada combinación de filtros; una respuesta vieja nunca pisa la nueva.
  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listManagedOrders(filtros).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setPagina({ clave, pedidos: r.data.pedidos, siguiente: r.data.siguiente });
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clave` resume `filtros`
  }, [client, clave, version]);

  const actual = pagina?.clave === clave ? pagina : null;
  const set = useCallback((patch: Partial<PedidosFiltros>) => setFiltros((f) => ({ ...f, ...patch })), []);

  async function cargarMas() {
    if (!client || !actual?.siguiente) return;
    setCargandoMas(true);
    const r = await client.listManagedOrders(filtros, actual.siguiente);
    setCargandoMas(false);
    if (!r.ok) return setError(r.error.message);
    setPagina((p) => (p && p.clave === clave ? { clave, pedidos: [...p.pedidos, ...r.data.pedidos], siguiente: r.data.siguiente } : p));
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
        <label className="sr-only" htmlFor="estado">
          {t("Estado", "Status")}
        </label>
        <select id="estado" className={select} value={filtros.estado ?? "todos"} onChange={(e) => set({ estado: e.target.value as PedidosFiltros["estado"] })}>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {e === "todos" ? t("Todos los estados", "All statuses") : t(ESTADO_VISIBLE[e].es, ESTADO_VISIBLE[e].en)}
            </option>
          ))}
        </select>
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
        <input type="date" aria-label={t("Desde", "From")} className={select} value={filtros.desde ?? ""} onChange={(e) => set({ desde: e.target.value || undefined })} />
        <input type="date" aria-label={t("Hasta", "To")} className={select} value={filtros.hasta ?? ""} onChange={(e) => set({ hasta: e.target.value || undefined })} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="search"
            maxLength={60}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={canManageOrders ? t("Pedido, nombre, referencia o teléfono", "Order, name, reference or phone") : t("Pedido, nombre o referencia", "Order, name or reference")}
            className={cn(select, "min-w-0 flex-1")}
          />
          <button type="submit" className={actionBtn}>
            <Search className="size-4" />
            <span className="sr-only">{t("Buscar", "Search")}</span>
          </button>
        </div>
      </form>

      <div className="space-y-3 px-4 pt-4 md:px-8">
        {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
        {!actual && !error && <div className="h-32 animate-pulse rounded-2xl bg-card" aria-hidden />}
        {actual && actual.pedidos.length === 0 && (
          <div className="rounded-2xl border border-edge bg-card p-8 text-center text-sm text-mist">{t("No hay pedidos con estos filtros.", "No orders match these filters.")}</div>
        )}
        {actual?.pedidos.map((p) => (
          <Link key={p.pedido} href={`/dashboard/pedidos/${p.pedido}`} className="block rounded-2xl border border-edge bg-card p-4 transition hover:border-fg/40 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-fg">{p.pedido}</span>
              <EstadoBadge estado={p.estado_visible} t={t} />
              <span className={cn("rounded-full px-2 py-0.5 text-[11px]", p.canal === "wholesale" ? "bg-violet-500/15 text-violet-400" : "bg-ink-2 text-mist")}>
                {t(CANAL_LABEL[p.canal].es, CANAL_LABEL[p.canal].en)}
              </span>
              <span className="ml-auto font-semibold tabular-nums text-fg">{formatPrice(p.total)}</span>
              <ChevronRight className="size-4 text-mist" aria-hidden />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist">
              <span className="text-fg">{nombreCliente(p, t)}</span>
              {telefonoCliente(p) && <span className="tabular-nums">{telefonoCliente(p)}</span>}
              {p.checkout ? (
                <>
                  <span>{t(METODO[p.checkout.metodo_pago].es, METODO[p.checkout.metodo_pago].en)}</span>
                  <span>{p.checkout.estado_pago === "recibido" ? t("Pago recibido", "Payment received") : t("Pago pendiente", "Payment pending")}</span>
                  <span>{t(ENTREGA[p.checkout.entrega].es, ENTREGA[p.checkout.entrega].en)}</span>
                </>
              ) : (
                <span>{t("Pedido anterior al checkout", "Pre-checkout order")}</span>
              )}
              <span>{t("Asesora", "Advisor")}: {p.asesora?.asignada ?? t("sin asignar", "unassigned")}</span>
              <span>
                {t("Creado", "Created")} {fecha(p.creado)}
              </span>
              <span>
                {t("Actualizado", "Updated")} {fecha(p.actualizado)}
              </span>
            </div>
          </Link>
        ))}
        {actual?.siguiente && (
          <button type="button" disabled={cargandoMas} onClick={() => void cargarMas()} className={cn(actionBtn, "w-full justify-center")}>
            {cargandoMas ? t("Cargando…", "Loading…") : t("Ver más", "Load more")}
          </button>
        )}
      </div>
    </div>
  );
}
