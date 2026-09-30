"use client";

// Bloque 27 — piezas visuales del módulo "Pedidos". Solo muestran lo que decidió el backend.
import type { AccionPedido, EstadoVisible, PedidoGestion } from "@/lib/catalogo/pedidos/gestion";
import { cn } from "@/components/dashboard/catalogo/ui";

type T = (es: string, en: string) => string;

export const ESTADO_VISIBLE: Record<EstadoVisible, { es: string; en: string; tone: string }> = {
  confirmado: { es: "Confirmado", en: "Confirmed", tone: "bg-sky-500/15 text-sky-400" },
  en_preparacion: { es: "En preparación", en: "Preparing", tone: "bg-violet-500/15 text-violet-400" },
  enviado: { es: "Enviado", en: "Shipped", tone: "bg-indigo-500/15 text-indigo-400" },
  entregado: { es: "Entregado", en: "Delivered", tone: "bg-teal-500/15 text-teal-400" },
  completado: { es: "Completado", en: "Completed", tone: "bg-lime-soft text-lime-text" },
  cancelado: { es: "Cancelado", en: "Cancelled", tone: "bg-ink-2 text-mist" },
  rechazado: { es: "Rechazado", en: "Rejected", tone: "bg-red-500/15 text-red-400" },
  vencido: { es: "Vencido", en: "Expired", tone: "bg-ink-2 text-mist" },
  con_asesora: { es: "Con asesora (anterior)", en: "With advisor (legacy)", tone: "bg-amber-500/15 text-amber-500" },
};

/** Estado del PAGO: eje aparte del estado del pedido ("confirmado" no es pagado). */
export const PAGO: Record<"pendiente" | "recibido", { es: string; en: string; tone: string }> = {
  pendiente: { es: "Pendiente de pago", en: "Payment pending", tone: "bg-amber-500/15 text-amber-500" },
  recibido: { es: "Pago recibido", en: "Payment received", tone: "bg-lime-soft text-lime-text" },
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
    es: "Registrar pago recibido",
    en: "Record payment received",
    confirmar: { es: "¿Confirmas que el pago de este pedido ya se RECIBIÓ? Queda registrado a tu nombre y no se puede deshacer.", en: "Confirm the payment for this order was RECEIVED? It is recorded under your name and cannot be undone." },
  },
  en_preparacion: {
    es: "Pasar a preparación",
    en: "Move to preparation",
    confirmar: { es: "¿Pasar el pedido a EN PREPARACIÓN?", en: "Move the order to PREPARING?" },
  },
  enviado: {
    es: "Marcar enviado",
    en: "Mark shipped",
    confirmar: { es: "¿Marcar el pedido como ENVIADO? Después ya no se puede cancelar ni rechazar.", en: "Mark the order as SHIPPED? It can no longer be cancelled or rejected." },
  },
  entregado: {
    es: "Marcar entregado",
    en: "Mark delivered",
    confirmar: { es: "¿Confirmas que el cliente ya RECIBIÓ el pedido?", en: "Confirm the customer RECEIVED the order?" },
  },
  completar: {
    es: "Completar",
    en: "Complete",
    confirmar: { es: "¿Cerrar el pedido como COMPLETADO? El stock apartado queda vendido.", en: "Close the order as COMPLETED? Reserved stock is sold." },
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

export function PagoBadge({ pago, t }: { pago: "pendiente" | "recibido" | null; t: T }) {
  if (!pago) return null;
  const e = PAGO[pago];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", e.tone)}>{t(e.es, e.en)}</span>;
}

/** Atención de la CONVERSACIÓN (no del pedido), en una línea. */
export function atencionTexto(p: PedidoGestion, t: T): string {
  const a = p.atencion;
  if (!a) return "—";
  const partes = [
    a.asignada ? t(`Asignada a ${a.asignada}`, `Assigned to ${a.asignada}`) : t("Sin asignar", "Unassigned"),
    a.ia_pausada_hasta ? t(`IA pausada hasta ${fecha(a.ia_pausada_hasta)}`, `AI paused until ${fecha(a.ia_pausada_hasta)}`) : t("IA activa", "AI active"),
    a.conversacion === "pending" ? t("Pendiente en Inbox", "Pending in Inbox") : a.conversacion === "closed" ? t("Cerrada en Inbox", "Closed in Inbox") : null,
  ];
  return partes.filter(Boolean).join(" · ");
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

/** Bloque 35 — "Hace 2 h" / "en 3 h" (cerca de ahora); más de una semana: la fecha. */
export function hace(iso: string | null | undefined, t: T, ahora: number = Date.now()): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - ahora;
  if (Number.isNaN(ms)) return "—";
  const futuro = ms > 0;
  const min = Math.round(Math.abs(ms) / 60_000);
  const texto = (es: string, en: string) => (futuro ? t(`en ${es}`, `in ${en}`) : t(`Hace ${es}`, `${en} ago`));
  if (min < 1) return t("Ahora", "Now");
  if (min < 60) return texto(`${min} min`, `${min} min`);
  const h = Math.round(min / 60);
  if (h < 24) return texto(`${h} h`, `${h} h`);
  const d = Math.round(h / 24);
  if (d <= 7) return texto(d === 1 ? "1 día" : `${d} días`, d === 1 ? "1 day" : `${d} days`);
  return new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" });
}

/** Bloque 35 — periodo del filtro (fechas de Colombia). "rango" = fechas que elige la persona. */
export type Periodo = "hoy" | "7d" | "30d" | "90d" | "todo" | "rango";

/** Día de Colombia (YYYY-MM-DD) `dias` días antes de `ahora`. */
function diaBogota(ahora: number, dias: number): string {
  return new Date(ahora - dias * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** Desde / hasta (inclusive, YYYY-MM-DD) del periodo; "todo" y "rango" no fijan fechas aquí. */
export function rangoPeriodo(p: Periodo, ahora: number = Date.now()): { desde?: string; hasta?: string } {
  const dias = p === "hoy" ? 1 : p === "7d" ? 7 : p === "30d" ? 30 : p === "90d" ? 90 : 0;
  return dias ? { desde: diaBogota(ahora, dias - 1), hasta: diaBogota(ahora, 0) } : {};
}
