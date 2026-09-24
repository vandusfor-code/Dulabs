"use client";

// Bloque 25 — lo que la asesora necesita ver de un pedido: cliente (nombre, teléfono solo si puede
// atender, modalidad detal / mayorista), fechas, productos con foto, resumen, reserva y asesora.
// Solo muestra y pide acciones al backend: nunca edita stock, precios ni reservas.
import Link from "next/link";
import { ArrowRightLeft, Hand, MessageCircle, UserRound } from "lucide-react";
import type { PedidoContacto, PedidoPanel } from "@/lib/catalogo/pedidos/panel";
import { actionBtn, cn, formatPrice, ProductImage } from "@/components/dashboard/catalogo/ui";

type T = (es: string, en: string) => string;

export function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });
}

export const CANAL_LABEL = { retail: { es: "Detal", en: "Retail" }, wholesale: { es: "Mayorista", en: "Wholesale" } } as const;

const ORIGEN: Record<string, { es: string; en: string }> = {
  cliente: { es: "lo eligió el cliente", en: "chosen by the customer" },
  catalogo_detal: { es: "por su pedido de la tienda detal", en: "from a retail store order" },
  catalogo_mayorista: { es: "por su pedido de la tienda mayorista", en: "from a wholesale store order" },
  asesora: { es: "lo fijó una asesora", en: "set by an advisor" },
};

const PEDIDA_POR: Record<string, { es: string; en: string }> = {
  system: { es: "el sistema", en: "the system" },
  agent: { es: "el asistente", en: "the assistant" },
  human: { es: "una asesora", en: "an advisor" },
};

export function inboxHref(c: PedidoContacto): string | null {
  return c.telefono ? `/dashboard/mensajes?${new URLSearchParams({ phone_number_id: c.numero, telefono_cliente: c.telefono })}` : null;
}

/** Cliente del pedido. */
export function ClientePedido({ p, t }: { p: Pick<PedidoPanel, "contacto" | "cliente">; t: T }) {
  const c = p.contacto;
  if (!c) return p.cliente ? <span className="text-xs text-mist">+{p.cliente}</span> : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist">
      <span className="inline-flex items-center gap-1 text-fg">
        <UserRound className="size-3.5" />
        {c.nombre ?? t("Cliente sin nombre", "Unnamed customer")}
      </span>
      <span className="tabular-nums">{c.telefono ? `+${c.telefono}` : `•••• ${c.telefono_parcial}`}</span>
      <span
        className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", c.tipo === "wholesale" ? "bg-violet-500/15 text-violet-400" : c.tipo === "retail" ? "bg-sky-500/15 text-sky-400" : "bg-ink-2 text-mist")}
        title={c.tipo_origen ? t(`Modalidad: ${ORIGEN[c.tipo_origen]?.es ?? c.tipo_origen}`, `Type: ${ORIGEN[c.tipo_origen]?.en ?? c.tipo_origen}`) : undefined}
      >
        {c.tipo ? t(`Cliente ${CANAL_LABEL[c.tipo].es.toLowerCase()}`, `${CANAL_LABEL[c.tipo].en} customer`) : t("Sin clasificar", "Unclassified")}
      </span>
    </div>
  );
}

/** Productos del pedido con foto, precio unitario y subtotal (del backend). */
export function LineasPedido({ p, t }: { p: Pick<PedidoPanel, "lineas">; t: T }) {
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {p.lineas.map((l) => (
        <li key={l.referencia} className="flex items-center gap-3">
          {l.foto !== undefined && <ProductImage src={l.foto} alt="" className="size-10 shrink-0 rounded-md" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-fg">{l.nombre}</span>
            <span className="text-xs text-mist">
              <span className="font-mono">{l.referencia}</span> · {l.cantidad} × {l.precio_unitario === null ? t("a consultar", "on request") : formatPrice(l.precio_unitario)}
            </span>
          </span>
          <span className="shrink-0 tabular-nums text-mist">{l.subtotal === null ? t("a consultar", "on request") : formatPrice(l.subtotal)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Fechas del pedido y bloque de la asesora. */
export function DatosPedido({ p, t }: { p: PedidoPanel; t: T }) {
  const a = p.asesora;
  return (
    <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-mist sm:grid-cols-2">
      <div>
        <dt className="inline">{t("Creado: ", "Created: ")}</dt>
        <dd className="inline text-fg">{fechaCorta(p.creado)}</dd>
      </div>
      {p.confirmado && (
        <div>
          <dt className="inline">{t("Confirmado: ", "Confirmed: ")}</dt>
          <dd className="inline text-fg">{fechaCorta(p.confirmado)}</dd>
        </div>
      )}
      {p.vence && (
        <div>
          <dt className="inline">{p.estado === "confirmed" ? t("Reserva vence: ", "Reservation expires: ") : t("Propuesta vence: ", "Proposal expires: ")}</dt>
          <dd className="inline text-fg">{fechaCorta(p.vence)}</dd>
        </div>
      )}
      <div>
        <dt className="inline">{t("Tipo de precio: ", "Price type: ")}</dt>
        <dd className="inline text-fg">{t(CANAL_LABEL[p.canal].es, CANAL_LABEL[p.canal].en)}</dd>
      </div>
      {a && (
        <div className="sm:col-span-2">
          <dt className="inline">{t("Asesora: ", "Advisor: ")}</dt>
          <dd className="inline text-fg">
            {a.asignada ?? t("sin asignar", "unassigned")}
            {a.motivo && <span className="text-mist"> · {t("motivo", "reason")}: {a.motivo}</span>}
            {a.pedida_por && <span className="text-mist"> · {t(`la pidió ${PEDIDA_POR[a.pedida_por]?.es ?? a.pedida_por}`, `requested by ${PEDIDA_POR[a.pedida_por]?.en ?? a.pedida_por}`)}</span>}
            {a.desde && <span className="text-mist"> · {fechaCorta(a.desde)}</span>}
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Modalidad a la que lleva el botón: la otra; sin clasificar, la del pedido. */
export function destinoModalidad(p: PedidoPanel): "retail" | "wholesale" {
  const tipo = p.contacto?.tipo ?? null;
  return tipo === null ? p.canal : tipo === "wholesale" ? "retail" : "wholesale";
}

/** Acciones sobre la CONVERSACIÓN y la modalidad del cliente (las del pedido van aparte). */
export function AccionesCliente({
  p,
  t,
  enCurso,
  onTomar,
  onCambiarModalidad,
}: {
  p: PedidoPanel;
  t: T;
  enCurso: boolean;
  onTomar: (p: PedidoPanel) => void;
  onCambiarModalidad: (p: PedidoPanel) => void;
}) {
  const c = p.contacto;
  if (!c?.telefono) return null;
  const href = inboxHref(c);
  const destino = destinoModalidad(p);
  return (
    <div className="flex flex-wrap gap-2">
      {href && (
        <Link href={href} className={actionBtn}>
          <MessageCircle className="size-4" />
          {t("Abrir en Inbox", "Open in Inbox")}
        </Link>
      )}
      <button type="button" disabled={enCurso} onClick={() => onTomar(p)} className={actionBtn}>
        <Hand className="size-4" />
        {t("Tomar conversación", "Take conversation")}
      </button>
      <button type="button" disabled={enCurso} onClick={() => onCambiarModalidad(p)} className={actionBtn}>
        <ArrowRightLeft className="size-4" />
        {c.tipo
          ? t(`Pasar a ${CANAL_LABEL[destino].es.toLowerCase()}`, `Switch to ${CANAL_LABEL[destino].en.toLowerCase()}`)
          : t(`Clasificar como ${CANAL_LABEL[destino].es.toLowerCase()}`, `Classify as ${CANAL_LABEL[destino].en.toLowerCase()}`)}
      </button>
    </div>
  );
}
