"use client";

// Bloque 33 — piezas visuales del módulo "Clientes". Solo muestran lo que decidió el backend.
import type { OrderChannel } from "@/lib/catalogo/pedidos/contrato";
import { cn } from "@/components/dashboard/catalogo/ui";

type T = (es: string, en: string) => string;

export const MODALIDAD: Record<OrderChannel, { es: string; en: string; tone: string }> = {
  retail: { es: "🛍️ Detal", en: "🛍️ Retail", tone: "bg-ink-2 text-mist" },
  wholesale: { es: "📦 Mayorista", en: "📦 Wholesale", tone: "bg-violet-500/15 text-violet-400" },
};

export const ORIGEN: Record<string, { es: string; en: string }> = {
  cliente: { es: "la eligió en el chat", en: "chosen in chat" },
  catalogo_detal: { es: "por la tienda web al detal", en: "from the retail web store" },
  catalogo_mayorista: { es: "por el enlace mayorista", en: "from the wholesale link" },
  asesora: { es: "la fijó una asesora", en: "set by an advisor" },
};

/** Estado de un pedido tal como lo guarda la BD (+ etapa si está confirmado), en palabras. */
export function estadoPedido(estado: string | null, etapa: string | null, t: T): { texto: string; tone: string } {
  if (estado === "confirmed") {
    const e = etapa ?? "confirmado";
    const m: Record<string, [string, string, string]> = {
      confirmado: ["Confirmado", "Confirmed", "bg-sky-500/15 text-sky-400"],
      en_preparacion: ["En preparación", "Preparing", "bg-violet-500/15 text-violet-400"],
      enviado: ["Enviado", "Shipped", "bg-indigo-500/15 text-indigo-400"],
      entregado: ["Entregado", "Delivered", "bg-teal-500/15 text-teal-400"],
    };
    const [es, en, tone] = m[e] ?? m.confirmado;
    return { texto: t(es, en), tone };
  }
  const m: Record<string, [string, string, string]> = {
    pending_confirmation: ["Solicitud sin confirmar", "Unconfirmed request", "bg-amber-500/15 text-amber-500"],
    completed: ["Completado", "Completed", "bg-lime-soft text-lime-text"],
    cancelled: ["Cancelado", "Cancelled", "bg-ink-2 text-mist"],
    rejected: ["Rechazado", "Rejected", "bg-red-500/15 text-red-400"],
    expired: ["Vencido", "Expired", "bg-ink-2 text-mist"],
    handoff: ["Con asesora", "With advisor", "bg-amber-500/15 text-amber-500"],
  };
  const [es, en, tone] = m[estado ?? ""] ?? ["—", "—", "bg-ink-2 text-mist"];
  return { texto: t(es, en), tone };
}

export function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>{children}</span>;
}

/** "+57 314 812 7388" para mostrar. */
export function telefonoVisible(waId: string): string {
  const m = /^(57)(\d{3})(\d{3})(\d{4})$/.exec(waId);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${waId}`;
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}
