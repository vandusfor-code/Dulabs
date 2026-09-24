/**
 * Memoria de CORTO PLAZO estructurada de una conversación (no texto libre).
 *
 * Guarda solo lo necesario para continuar sin releer el historial completo:
 * canal y su fuente, carrito (referencias + cantidades, NUNCA precios),
 * productos mostrados en orden (para "el primero", "el tercero"),
 * procedencia de referencias (anti-invención), ambigüedad pendiente,
 * propuesta presentada, pedido activo, fotos enviadas, la selección del
 * último mensaje, el traspaso a una asesora y los últimos wamid atendidos. Precios, stock y totales NO se
 * guardan aquí: siempre se consultan al backend.
 *
 * Persistencia: dulabs_agente_conversaciones con compare-and-set por `version`
 * (dos turnos concurrentes nunca se pisan en silencio).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ORDER_MAX_QUANTITY } from "@/lib/catalogo/pedido";

const reference = z.string().regex(/^[A-Z]{1,6}-\d{6,}$/);
const orderId = z.string().regex(/^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/);

export const MAX_CART_LINES = 30;
export const MAX_KNOWN_REFERENCES = 80;
export const MAX_SHOWN = 10;
export const MAX_IMAGES_REMEMBERED = 20;
export const MAX_RECENT_WAMIDS = 10;

export const conversationStateSchema = z
  .object({
    v: z.literal(1),
    /** Turnos atendidos por el agente (el actual incluido). */
    turn: z.number().int().min(0),
    /** Canal de precios fijado por el backend y de dónde salió. */
    channel: z.object({ value: z.enum(["retail", "wholesale"]), source: z.enum(["number_config", "catalog_request"]) }).strict().nullable(),
    cart: z
      .array(z.object({ reference, quantity: z.number().int().min(1).max(ORDER_MAX_QUANTITY) }).strict())
      .max(MAX_CART_LINES),
    /** Procedencia: referencias que el cliente escribió, que una herramienta devolvió o de la foto que el cliente citó. */
    known: z
      .array(z.object({ reference, via: z.enum(["customer", "tool", "image"]), turn: z.number().int().min(0) }).strict())
      .max(MAX_KNOWN_REFERENCES),
    /** Últimos productos presentados, en orden (para "el primero", "el tercero"). */
    lastShown: z
      .array(z.object({ reference, name: z.string().max(160) }).strict())
      .max(MAX_SHOWN),
    /** Conjunto ambiguo pendiente: el cliente debe elegir antes de agregar cualquiera de estas referencias. */
    ambiguity: z
      .object({ references: z.array(reference).min(2).max(MAX_SHOWN), createdTurn: z.number().int().min(0), presentedTurn: z.number().int().min(0).nullable() })
      .strict()
      .nullable(),
    /** Propuesta del backend (confirmation_id) y el turno en que se le mostró al cliente. */
    proposal: z.object({ orderId, confirmationId: z.string().regex(/^cf_[0-9a-z]{16}$/), presentedTurn: z.number().int().min(0).nullable() }).strict().nullable(),
    activeOrderId: orderId.nullable(),
    /** Fallos técnicos seguidos del agente (2 => pasa a una asesora). */
    failures: z.number().int().min(0).max(10),
    lastInteractionAt: z.iso.datetime().nullable(),
    // --- Agregados en la Fase 9 (con default: los estados guardados antes siguen siendo válidos) ---
    /** Fotos que el sistema envió (solo referencia y turno; el wamid de cada foto vive en dulabs_agente_medios_enviados). */
    imagesSent: z
      .array(z.object({ reference, turn: z.number().int().min(0) }).strict())
      .max(MAX_IMAGES_REMEMBERED)
      .default([]),
    /** Lo que el mensaje MÁS RECIENTE del cliente señaló de forma determinista (foto citada, posición, referencia o nombre). */
    selection: z
      .array(z.object({ reference, via: z.enum(["image_reply", "position", "reference", "name"]), turn: z.number().int().min(0) }).strict())
      .max(MAX_SHOWN)
      .default([]),
    /** Turno en que el agente pasó la conversación a una asesora (null = no hay traspaso). */
    handoffTurn: z.number().int().min(0).nullable().default(null),
    /** wamid de los últimos mensajes atendidos: un reintento de Meta no genera otra respuesta. */
    recentWamids: z.array(z.string().min(1).max(200)).max(MAX_RECENT_WAMIDS).default([]),
  })
  .strict();

export type ConversationState = z.infer<typeof conversationStateSchema>;

export function emptyConversationState(): ConversationState {
  return {
    v: 1,
    turn: 0,
    channel: null,
    cart: [],
    known: [],
    lastShown: [],
    ambiguity: null,
    proposal: null,
    activeOrderId: null,
    failures: 0,
    lastInteractionAt: null,
    imagesSent: [],
    selection: [],
    handoffTurn: null,
    recentWamids: [],
  };
}

/** Estado guardado ilegible (versión vieja, corrupción) => se reinicia; nunca se usa a medias. */
export function parseConversationState(raw: unknown): { state: ConversationState; reset: boolean } {
  const parsed = conversationStateSchema.safeParse(raw);
  return parsed.success ? { state: parsed.data, reset: false } : { state: emptyConversationState(), reset: raw !== null && raw !== undefined && Object.keys(raw as object).length > 0 };
}

/** Registra procedencia (sin duplicar; conserva la primera vía) respetando el tope. */
export function rememberReferences(state: ConversationState, refs: readonly string[], via: "customer" | "tool" | "image"): ConversationState {
  const known = [...state.known];
  for (const r of refs) {
    const ref = r.toUpperCase();
    if (!reference.safeParse(ref).success || known.some((k) => k.reference === ref)) continue;
    known.push({ reference: ref, via, turn: state.turn });
  }
  return { ...state, known: known.slice(-MAX_KNOWN_REFERENCES) };
}

export function isKnownReference(state: ConversationState, ref: string): boolean {
  return state.known.some((k) => k.reference === ref.toUpperCase());
}

// ---------------------------------------------------------------------------

export interface ConversationKey {
  tenantId: string;
  phoneNumberId: string;
  waId: string;
}

export interface ConversationStateStore {
  /** version null = la conversación aún no tiene fila. */
  load(key: ConversationKey): Promise<{ state: ConversationState; version: number | null; reset: boolean }>;
  /** Compare-and-set: false si otra escritura ganó (nada se sobrescribe). */
  save(key: ConversationKey, state: ConversationState, expectedVersion: number | null): Promise<boolean>;
}

const T = "dulabs_agente_conversaciones";

export function createSupabaseConversationStateStore(supabase: SupabaseClient): ConversationStateStore {
  return {
    async load(key) {
      const { data, error } = await supabase.from(T).select("estado, version").eq("id_tenant", key.tenantId).eq("phone_number_id", key.phoneNumberId).eq("wa_id", key.waId).maybeSingle();
      if (error) throw new Error(`[agente/estado] load ${error.code ?? "?"}`);
      if (!data) return { state: emptyConversationState(), version: null, reset: false };
      const { state, reset } = parseConversationState((data as { estado: unknown }).estado);
      return { state, version: (data as { version: number }).version, reset };
    },
    async save(key, state, expectedVersion) {
      const estado = conversationStateSchema.parse(state);
      if (expectedVersion === null) {
        const { error } = await supabase.from(T).insert({ id_tenant: key.tenantId, phone_number_id: key.phoneNumberId, wa_id: key.waId, estado, version: 1 });
        if (!error) return true;
        if (error.code === "23505") return false;
        throw new Error(`[agente/estado] insert ${error.code ?? "?"}`);
      }
      const { data, error } = await supabase
        .from(T)
        .update({ estado, version: expectedVersion + 1, updated_at: new Date().toISOString() })
        .eq("id_tenant", key.tenantId)
        .eq("phone_number_id", key.phoneNumberId)
        .eq("wa_id", key.waId)
        .eq("version", expectedVersion)
        .select("version");
      if (error) throw new Error(`[agente/estado] update ${error.code ?? "?"}`);
      return (data ?? []).length === 1;
    },
  };
}

export function createMemoryConversationStateStore() {
  const rows = new Map<string, { tenantId: string; state: ConversationState; version: number }>();
  const k = (key: ConversationKey) => `${key.phoneNumberId}|${key.waId}`;
  const store: ConversationStateStore & { rows: typeof rows } = {
    rows,
    async load(key) {
      const row = rows.get(k(key));
      if (!row || row.tenantId !== key.tenantId) return { state: emptyConversationState(), version: null, reset: false };
      return { state: structuredClone(row.state), version: row.version, reset: false };
    },
    async save(key, state, expectedVersion) {
      const current = rows.get(k(key));
      const parsed = conversationStateSchema.parse(state);
      if (expectedVersion === null) {
        if (current) return false;
        rows.set(k(key), { tenantId: key.tenantId, state: structuredClone(parsed), version: 1 });
        return true;
      }
      if (!current || current.tenantId !== key.tenantId || current.version !== expectedVersion) return false;
      rows.set(k(key), { tenantId: key.tenantId, state: structuredClone(parsed), version: expectedVersion + 1 });
      return true;
    },
  };
  return store;
}
