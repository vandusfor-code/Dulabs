/**
 * ATENCIÓN HUMANA en el Inbox (Bloque 17) — por qué una conversación pasó a una asesora.
 *
 * No hay tabla nueva: el motivo YA está en la traza del turno que hizo el traspaso
 * (dulabs_agente_trazas: resultado 'handoff', traza.handoff = {source, motive}, lista cerrada;
 * Bloque 16). Aquí se DERIVA para una persona:
 *
 *   se muestra si la conversación está en manos humanas (pausada) o pendiente, no está
 *   cerrada, y nadie la devolvió a la IA después del traspaso ("liberado" en
 *   dulabs_conversacion_eventos).
 *
 * La asesora ve un texto claro de una lista CERRADA (nunca el texto libre del modelo, nunca la
 * traza técnica, nunca ids internos): motivo, desde cuándo, quién lo decidió y, si existe, el
 * número PÚBLICO del pedido (DL-ORD-XXXXXX).
 *
 * Aislamiento: la lectura exige el negocio (id_tenant) y los números del negocio (los resuelve
 * el backend desde la sesión, nunca el navegador); el teléfono solo se usa para calcular el
 * mismo hash que guarda la traza (contact_ref) y no sale de aquí.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactRef } from "@/lib/catalogo/pedidos/log";
import type { HandoffMotive, SystemHandoffMotive, TurnIntent } from "@/lib/agente/intencion";

type AnyMotive = HandoffMotive | SystemHandoffMotive;

/** Motivo para una persona. `codigo` es el mismo que muestra el diagnóstico SQL. */
export const MOTIVOS_ASESORA: Readonly<Record<AnyMotive | "sin_detalle", { codigo: string; texto: string }>> = {
  customer_request: { codigo: "cliente_pidio_asesora", texto: "El cliente pidió hablar con una asesora" },
  order_issue: { codigo: "problema_pedido", texto: "Hay un problema con el pedido del cliente" },
  payment_or_delivery: { codigo: "pago_o_entrega", texto: "El cliente pregunta por pago, envío o entrega" },
  complaint: { codigo: "reclamo", texto: "El cliente tiene un reclamo" },
  out_of_scope: { codigo: "fuera_de_alcance", texto: "El cliente pide algo que el asistente no puede resolver" },
  other: { codigo: "otro", texto: "El asistente pidió apoyo de una asesora" },
  repeated_failures: { codigo: "fallas_del_asistente", texto: "El asistente no pudo responder y necesita apoyo" },
  limit_contact_day: { codigo: "limite_uso_cliente", texto: "El asistente llegó a su límite de mensajes con este cliente hoy" },
  limit_tenant_tokens_day: { codigo: "limite_uso_negocio", texto: "El asistente llegó a su límite de uso del día" },
  sin_detalle: { codigo: "sin_detalle", texto: "El asistente pasó la conversación a una asesora" },
};

/** Intención en español (diagnóstico). Lista cerrada: misma que TurnIntent. */
export const INTENCIONES: Readonly<Record<TurnIntent, string>> = {
  search: "buscar",
  more_results: "ver_mas",
  similar: "similares",
  product_detail: "detalle",
  cart: "carrito",
  order: "pedido",
  confirm_order: "confirmar",
  photos: "fotos",
  handoff: "asesora",
  catalog_link: "link_catalogo",
  conversation: "conversacion",
};

const ORIGENES = { customer: "cliente", model: "asistente", system: "sistema" } as const;
export type OrigenTraspaso = (typeof ORIGENES)[keyof typeof ORIGENES];

export interface AtencionHumana {
  motivo: string;
  texto: string;
  origen: OrigenTraspaso;
  desde: string;
  /** Número público del pedido (DL-ORD-XXXXXX), si el traspaso tenía uno. */
  pedido: string | null;
}

export interface HandoffRegistrado {
  at: string;
  /** traza.handoff tal como está guardado (se valida contra la lista cerrada). */
  handoff: unknown;
  orderId: unknown;
}

const ORDER_PUBLIC = /^DL-ORD-[0-9A-Z]{6}$/;

/** Motivo legible a partir de lo guardado; cualquier valor fuera de la lista cerrada => "sin detalle". */
export function motivoLegible(handoff: unknown): { motivo: string; texto: string; origen: OrigenTraspaso } {
  const h = handoff && typeof handoff === "object" ? (handoff as { source?: unknown; motive?: unknown }) : {};
  const origen = typeof h.source === "string" && h.source in ORIGENES ? ORIGENES[h.source as keyof typeof ORIGENES] : "asistente";
  const known = typeof h.motive === "string" && Object.hasOwn(MOTIVOS_ASESORA, h.motive) && h.motive !== "sin_detalle";
  const m = MOTIVOS_ASESORA[known ? (h.motive as AnyMotive) : "sin_detalle"];
  return { motivo: m.codigo, texto: m.texto, origen };
}

/** Regla ÚNICA de cuándo mostrarle el motivo a la asesora. */
export function atencionHumanaDe(input: { pausado: boolean; estado: string | undefined; ultimoHandoff: HandoffRegistrado | null; liberadoEn: string | null }): AtencionHumana | null {
  const h = input.ultimoHandoff;
  if (!h) return null;
  if (input.estado === "closed") return null;
  if (!input.pausado && input.estado !== "pending") return null;
  // Fechas comparadas como instantes (la BD puede devolver "+00:00" o "Z").
  if (input.liberadoEn && Date.parse(input.liberadoEn) >= Date.parse(h.at)) return null;
  return { ...motivoLegible(h.handoff), desde: h.at, pedido: typeof h.orderId === "string" && ORDER_PUBLIC.test(h.orderId) ? h.orderId : null };
}

export interface ConversacionInbox {
  phone_number_id: string;
  telefono_cliente: string;
  pausado: boolean;
  estado?: string;
}

/** Traspasos más viejos que esto no se muestran (la pausa del agente dura 24 h; la de "tomar", 30 días). */
const VENTANA_DIAS = 31;
const TOPE_FILAS = 1000;
const SIN_MIGRACION = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);

/**
 * Lee el motivo de atención humana de las conversaciones dadas (las del negocio de la sesión).
 * Nunca rompe el Inbox: sin trazas / sin tabla / error => sin motivo.
 */
export async function leerAtencionHumana(
  supabase: SupabaseClient,
  input: { tenantId: string; conversaciones: readonly ConversacionInbox[]; ahora?: number },
): Promise<Map<string, AtencionHumana>> {
  const out = new Map<string, AtencionHumana>();
  const candidatas = input.conversaciones.filter((c) => c.estado !== "closed" && (c.pausado || c.estado === "pending")).slice(0, 300);
  if (candidatas.length === 0) return out;

  const clave = (pn: string, tel: string) => `${pn}:${tel}`;
  const porRef = new Map<string, ConversacionInbox[]>();
  for (const c of candidatas) {
    const ref = contactRef(c.telefono_cliente);
    porRef.set(ref, [...(porRef.get(ref) ?? []), c]);
  }
  const numeros = [...new Set(candidatas.map((c) => c.phone_number_id))];
  const desde = new Date((input.ahora ?? Date.now()) - VENTANA_DIAS * 86_400_000).toISOString();

  const [trazas, eventos] = await Promise.all([
    supabase
      .from("dulabs_agente_trazas")
      .select("phone_number_id, contact_ref, created_at, handoff:traza->handoff, pedido:traza->>order_id")
      .eq("id_tenant", input.tenantId)
      .eq("tipo", "turn")
      .eq("resultado", "handoff")
      .in("phone_number_id", numeros)
      .in("contact_ref", [...porRef.keys()])
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(TOPE_FILAS),
    supabase
      .from("dulabs_conversacion_eventos")
      .select("phone_number_id, telefono_cliente, created_at")
      .eq("tipo", "liberado")
      .in("phone_number_id", numeros)
      .in("telefono_cliente", candidatas.map((c) => c.telefono_cliente))
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(TOPE_FILAS),
  ]);
  if (trazas.error) {
    if (!SIN_MIGRACION.has(trazas.error.code ?? "")) console.error(`[agente/atencion-humana] trazas ${trazas.error.code ?? "?"}`);
    return out;
  }

  const ultimoHandoff = new Map<string, HandoffRegistrado>();
  for (const t of (trazas.data ?? []) as Array<{ phone_number_id: string; contact_ref: string; created_at: string; handoff: unknown; pedido: unknown }>) {
    for (const c of porRef.get(t.contact_ref) ?? []) {
      if (c.phone_number_id !== t.phone_number_id) continue;
      const k = clave(c.phone_number_id, c.telefono_cliente);
      if (!ultimoHandoff.has(k)) ultimoHandoff.set(k, { at: t.created_at, handoff: t.handoff, orderId: t.pedido });
    }
  }
  const liberado = new Map<string, string>();
  // Sin eventos (tabla ausente / error): no se puede saber si la devolvieron a la IA; el estado
  // (pausada/pendiente) sigue mandando, así que el motivo se muestra igual.
  for (const e of (eventos.error ? [] : (eventos.data ?? [])) as Array<{ phone_number_id: string; telefono_cliente: string; created_at: string }>) {
    const k = clave(e.phone_number_id, e.telefono_cliente);
    if (!liberado.has(k)) liberado.set(k, e.created_at);
  }

  for (const c of candidatas) {
    const k = clave(c.phone_number_id, c.telefono_cliente);
    const a = atencionHumanaDe({ pausado: c.pausado, estado: c.estado, ultimoHandoff: ultimoHandoff.get(k) ?? null, liberadoEn: liberado.get(k) ?? null });
    if (a) out.set(k, a);
  }
  return out;
}
