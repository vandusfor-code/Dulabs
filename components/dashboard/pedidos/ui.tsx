"use client";

// Bloque 27 — piezas visuales del módulo "Pedidos". Solo muestran lo que decidió el backend.
import type { AccionPedido, EstadoVisible, PedidoGestion } from "@/lib/catalogo/pedidos/gestion";
import { cn } from "@/components/dashboard/catalogo/ui";

type T = (es: string, en: string) => string;

export const ESTADO_VISIBLE: Record<EstadoVisible, { es: string; en: string; tone: string }> = {
  pendiente_pago: { es: "Pendiente de pago", en: "Awaiting payment", tone: "bg-amber-500/15 text-amber-500" },
  pago_recibido: { es: "Pago recibido", en: "Payment received", tone: "bg-sky-500/15 text-sky-400" },
  en_preparacion: { es: "En preparación", en: "Preparing", tone: "bg-violet-500/15 text-violet-400" },
  enviado: { es: "Enviado", en: "Shipped", tone: "bg-indigo-500/15 text-indigo-400" },
  completado: { es: "Completado", en: "Completed", tone: "bg-lime-soft text-lime-text" },
  cancelado: { es: "Cancelado", en: "Cancelled", tone: "bg-ink-2 text-mist" },
  rechazado: { es: "Rechazado", en: "Rejected", tone: "bg-red-500/15 text-red-400" },
  vencido: { es: "Vencido", en: "Expired", tone: "bg-ink-2 text-mist" },
  confirmado: { es: "Confirmado", en: "Confirmed", tone: "bg-lime-soft text-lime-text" },
  con_asesora: { es: "Con asesora", en: "With advisor", tone: "bg-amber-500/15 text-amber-500" },
};

export const METODO: Record<"pago_en_tienda" | "transferencia", { es: string; en: string }> = {
  pago_en_tienda: { es: "Pago en tienda", en: "Pay in store" },
  transferencia: { es: "Transferencia", en: "Bank transfer" },
};

export const ENTREGA: Record<"tienda" | "domicilio", { es: string; en: string }> = {
  tienda: { es: "Recoger en tienda", en: "Store pickup" },
  domicilio: { es: "Domicilio", en: "Home delivery" },
};

export const ACCION: Record<AccionPedido, { es: string; en: string; confirmar: { es: string; en: string } }> = {
  pago_recibido: {
    es: "Marcar pago recibido",
    en: "Mark payment received",
    confirmar: { es: "¿Confirmas que el pago de este pedido ya se RECIBIÓ? Queda registrado a tu nombre.", en: "Confirm the payment for this order was RECEIVED? It is recorded under your name." },
  },
  en_preparacion: {
    es: "Pasar a preparación",
    en: "Move to preparation",
    confirmar: { es: "¿Pasar el pedido a EN PREPARACIÓN?", en: "Move the order to PREPARING?" },
  },
  enviado: {
    es: "Marcar enviado",
    en: "Mark shipped",
    confirmar: { es: "¿Marcar el pedido como ENVIADO?", en: "Mark the order as SHIPPED?" },
  },
  completar: {
    es: "Completar",
    en: "Complete",
    confirmar: { es: "¿Marcar el pedido como COMPLETADO? El stock apartado queda vendido.", en: "Mark the order as COMPLETED? Reserved stock is sold." },
  },
  cancelar: {
    es: "Cancelar",
    en: "Cancel",
    confirmar: { es: "Cancelar el pedido (el stock apartado vuelve al inventario). Escribe el motivo:", en: "Cancel the order (reserved stock returns). Write the reason:" },
  },
  rechazar: {
    es: "Rechazar",
    en: "Reject",
    confirmar: { es: "Rechazar el pedido (la empresa no lo acepta; el stock vuelve). Escribe el motivo:", en: "Reject the order (the business declines it; stock returns). Write the reason:" },
  },
};

export function EstadoBadge({ estado, t }: { estado: EstadoVisible; t: T }) {
  const e = ESTADO_VISIBLE[estado];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", e.tone)}>{t(e.es, e.en)}</span>;
}

/** Nombre a mostrar: el que dio en el checkout; si no, el nombre conocido del contacto. */
export function nombreCliente(p: PedidoGestion, t: T): string {
  return p.checkout?.nombre ?? p.contacto?.nombre ?? t("Cliente sin nombre", "Unnamed customer");
}

export function telefonoCliente(p: PedidoGestion): string | null {
  const c = p.contacto;
  if (!c) return null;
  return c.telefono ? `+${c.telefono}` : `•••• ${c.telefono_parcial}`;
}

export function fecha(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }) : "—";
}
