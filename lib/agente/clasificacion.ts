/**
 * CLASIFICACIÓN DETAL / MAYORISTA POR CONTACTO (Bloque 25) — la decide y la guarda el BACKEND.
 *
 *   parseChannelChoice   qué eligió el cliente en su mensaje (botón o texto): detal, por mayor o nada.
 *   CustomerChannelStore el canal de cada contacto (dulabs_catalogo_clientes_canal) y su bitácora
 *                        inmutable. Se escribe SOLO por la RPC dulabs_catalogo_cliente_canal_fijar:
 *                          - primera clasificación (el cliente elige, o su solicitud del catálogo lo
 *                            indica): una sola vez, nunca pisa una existente;
 *                          - cambio: SOLO una asesora identificada, con compare-and-set.
 *
 * El modelo nunca ve ni cambia esta clasificación: el runtime fija el canal de cada turno con ella y
 * las herramientas cotizan con ese canal. Un cliente que "pide" otro canal pasa a una asesora.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderChannel } from "@/lib/catalogo/pedidos/contrato";

export type CustomerChannelOrigin = "cliente" | "catalogo_detal" | "catalogo_mayorista" | "asesora";
export type InitialChannelOrigin = Exclude<CustomerChannelOrigin, "asesora">;

export interface CustomerChannel {
  channel: OrderChannel;
  origin: CustomerChannelOrigin;
  updatedAt: string;
  updatedBy: number | null;
}

export interface CustomerChannelEvent {
  from: OrderChannel | null;
  to: OrderChannel;
  origin: CustomerChannelOrigin;
  memberId: number | null;
  reason: string | null;
  at: string;
}

export type CustomerChannelWrite = {
  result: "fijado" | "cambiado" | "sin_cambio" | "conflicto";
  channel: OrderChannel | null;
  origin: CustomerChannelOrigin | null;
};

export interface CustomerKey {
  tenantId: string;
  phoneNumberId: string;
  waId: string;
}

export interface CustomerChannelStore {
  get(key: CustomerKey): Promise<CustomerChannel | null>;
  /** Varios contactos de un número (panel). Solo los del negocio. */
  getMany(input: { tenantId: string; phoneNumberId: string; waIds: readonly string[] }): Promise<Map<string, CustomerChannel>>;
  /** Primera clasificación: solo si aún no tiene (si ya tenía => conflicto con la existente). */
  setInitial(key: CustomerKey, channel: OrderChannel, origin: InitialChannelOrigin): Promise<CustomerChannelWrite>;
  /** Cambio por una asesora: solo si el canal actual es `expected` (null = sin clasificar). */
  change(key: CustomerKey, input: { channel: OrderChannel; expected: OrderChannel | null; memberId: number; reason: string }): Promise<CustomerChannelWrite>;
  history(key: CustomerKey, limit?: number): Promise<CustomerChannelEvent[]>;
}

// ---------------------------------------------------------------------------
// Qué eligió el cliente
// ---------------------------------------------------------------------------

/**
 * Saludo del primer contacto: va en el MISMO mensaje de la pregunta, encima (Bloque 26). Cada negocio
 * puede poner el suyo en dulabs_agente_runtime_config.negocio.saludo; si no, este.
 */
export const DEFAULT_WELCOME = "¡Hola! 💖 Te damos la bienvenida 💍";

/**
 * Pregunta y botones FIJOS (sin IA). Títulos de botón: máx. 20 caracteres (Meta; aquí se cuentan en
 * UTF-16, lo más estricto, porque un emoji ocupa 2 o 3). El ícono de "responder" que WhatsApp dibuja
 * en cada botón es de la app: la API no permite quitarlo.
 */
export const CHANNEL_QUESTION = {
  body: "¿Tu compra es al detal o al por mayor?",
  buttons: [
    { id: "canal_detal", title: "🛍️ Compra al detal" },
    { id: "canal_mayor", title: "📦 Compra por mayor" },
  ],
  /** Si los botones no salen: la misma pregunta en texto. */
  textFallback: "¿Tu compra es al detal o al por mayor? Respóndeme *detal* o *por mayor*.",
} as const;

/** Pregunta del primer contacto: saludo + pregunta en un solo mensaje (con los botones). */
export const channelQuestionBody = (welcome: string | null) => (welcome ? `${welcome}\n\n${CHANNEL_QUESTION.body}` : CHANNEL_QUESTION.body);

/**
 * Bloque 26 — después de elegir DETAL, antes de cualquier IA: qué quiere hacer. Fijo, con botones.
 * El cliente igual puede escribir lo que busca (ese texto va al agente normal).
 */
export const INTENT_MENU = {
  body: "¡Perfecto! ✨ ¿Qué quieres hacer?",
  buttons: [
    { id: "accion_buscar", title: "🔎 Buscar una joya" },
    { id: "accion_catalogo", title: "📖 Ver catálogo" },
  ],
  textFallback: "¡Perfecto! ✨ Escríbeme qué joya buscas (por ejemplo: dijes, aretes dorados…) o escribe *ver catálogo*.",
} as const;

/** Mensajes FIJOS de las acciones de inicio (sin IA). */
export const START_MESSAGES = {
  searchPrompt: "Cuéntame qué estás buscando y te ayudo a encontrarlo.\n\nPor ejemplo: dijes, aretes dorados, collar corazón…",
  /** El enlace lo arma el backend con la publicación REAL del negocio y el canal GUARDADO del contacto. */
  catalog: (url: string) => `Aquí tienes nuestro catálogo 📖✨\n${url}\n\nSi algo te gusta, escríbeme su nombre o referencia y te ayudo.`,
  catalogUnavailable: "En este momento el catálogo en línea no está disponible. Cuéntame qué joya buscas y te ayudo por aquí.",
} as const;

/**
 * Acción de inicio que pidió el cliente, decidida por el BACKEND (nunca por el modelo):
 *   1) por el id del botón (cuando llega: turno directo);
 *   2) si no, por el texto EXACTO de uno de nuestros botones (el buzón guarda solo el texto): los
 *      títulos son fijos y distintos entre sí, así que la acción es inequívoca.
 * Cualquier otro texto => null (sigue el flujo normal: búsqueda libre con el agente).
 */
export type StartAction = "classify_retail" | "classify_wholesale" | "search_product" | "open_catalog";

const BUTTON_ACTIONS: Record<string, StartAction> = {
  [CHANNEL_QUESTION.buttons[0].id]: "classify_retail",
  [CHANNEL_QUESTION.buttons[1].id]: "classify_wholesale",
  [INTENT_MENU.buttons[0].id]: "search_product",
  [INTENT_MENU.buttons[1].id]: "open_catalog",
};

/** Solo letras y números (sin emojis, tildes ni signos), en minúsculas y con un espacio. */
const bare = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const EXACT_ACTIONS = new Map<string, StartAction>([
  ...[...CHANNEL_QUESTION.buttons, ...INTENT_MENU.buttons].map((b) => [bare(b.title), BUTTON_ACTIONS[b.id]] as const),
  // Títulos del Bloque 25 (mensajes ya enviados que el cliente todavía puede tocar) y respuestas mínimas.
  ["comprar al detal", "classify_retail"],
  ["comprar al por mayor", "classify_wholesale"],
  ["al detal", "classify_retail"],
  ["detal", "classify_retail"],
  ["al por mayor", "classify_wholesale"],
  ["por mayor", "classify_wholesale"],
  ["ver catalogo", "open_catalog"],
  ["catalogo", "open_catalog"],
]);

export function resolveStartAction(text: string, buttonId?: string | null): StartAction | null {
  if (buttonId && BUTTON_ACTIONS[buttonId]) return BUTTON_ACTIONS[buttonId];
  const t = bare(text).slice(0, 60);
  return t ? (EXACT_ACTIONS.get(t) ?? null) : null;
}

export const CHANNEL_LABEL: Record<OrderChannel, string> = { retail: "al detal", wholesale: "al por mayor" };

/** Mensajes FIJOS de la clasificación (sin IA; nunca prometen un precio ni un cambio). */
export const CLASSIFICATION_MESSAGES = {
  /** El cliente pide el otro canal: solo una asesora puede cambiarlo. */
  changeRequested: (current: OrderChannel) =>
    `Tu número está registrado para compras ${CHANNEL_LABEL[current]}, así que te muestro ese catálogo y esos precios. Para cambiar tu modalidad de compra, una asesora debe revisarlo: te comunico con ella y en breve te escribe.`,
  /** Hay un pedido abierto de otro canal (p. ej. una solicitud de la tienda mayorista de un cliente al detal). */
  orderMismatch: (orderId: string, orderChannel: OrderChannel, current: OrderChannel) =>
    `Tu solicitud ${orderId} es de compra ${CHANNEL_LABEL[orderChannel]} y tu número está registrado para compras ${CHANNEL_LABEL[current]}. Te comunico con una asesora para revisarla; en breve te escribe.`,
} as const;

const norm = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:*_"'()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// "detal" no incluye "detalle" (ver el detalle de un producto): \b corta la palabra.
const RETAIL = /\b(al detal|detal|al por menor|por menor|minorista|minoristas|menudeo|al menudeo)\b/;
const WHOLESALE = /\b(al por mayor|por mayor|mayorista|mayoristas|mayoreo|al mayor)\b/;

/**
 * Canal que el cliente nombra en su mensaje (el título de un botón o texto libre). Si nombra los dos
 * ("no es al por mayor, es al detal") o ninguno, null: el backend no adivina.
 */
export function parseChannelChoice(text: string): OrderChannel | null {
  const t = norm(text).slice(0, 500);
  if (!t) return null;
  const retail = RETAIL.test(t);
  const wholesale = WHOLESALE.test(t);
  if (retail === wholesale) return null;
  return retail ? "retail" : "wholesale";
}

// ---------------------------------------------------------------------------
// Supabase (RPC atómica) y memoria (pruebas)
// ---------------------------------------------------------------------------

const ORIGINS = new Set<CustomerChannelOrigin>(["cliente", "catalogo_detal", "catalogo_mayorista", "asesora"]);
const asChannel = (v: unknown): OrderChannel | null => (v === "retail" || v === "wholesale" ? v : null);
const asOrigin = (v: unknown): CustomerChannelOrigin | null => (typeof v === "string" && ORIGINS.has(v as CustomerChannelOrigin) ? (v as CustomerChannelOrigin) : null);

function writeResult(raw: unknown): CustomerChannelWrite {
  const r = (raw ?? {}) as Record<string, unknown>;
  const result = r.resultado;
  if (result !== "fijado" && result !== "cambiado" && result !== "sin_cambio" && result !== "conflicto") throw new Error("[agente/clasificacion] respuesta inesperada");
  return { result, channel: asChannel(r.canal), origin: asOrigin(r.origen) };
}

type Row = { wa_id: string; canal: string; origen: string; updated_at: string; actualizado_por: number | null };
const fromRow = (r: Row): CustomerChannel | null => {
  const channel = asChannel(r.canal);
  const origin = asOrigin(r.origen);
  return channel && origin ? { channel, origin, updatedAt: r.updated_at, updatedBy: r.actualizado_por ?? null } : null;
};

export function createSupabaseCustomerChannelStore(supabase: SupabaseClient): CustomerChannelStore {
  const rpc = async (key: CustomerKey, p: { canal: OrderChannel; origen: CustomerChannelOrigin; miembro: number | null; motivo: string | null; esperado: string | null }) => {
    const { data, error } = await supabase.rpc("dulabs_catalogo_cliente_canal_fijar", {
      p_tenant: key.tenantId,
      p_pn: key.phoneNumberId,
      p_wa: key.waId,
      p_canal: p.canal,
      p_origen: p.origen,
      p_miembro: p.miembro,
      p_motivo: p.motivo,
      p_esperado: p.esperado,
    });
    if (error) throw new Error(`[agente/clasificacion] ${error.code ?? "?"}`);
    return writeResult(data);
  };
  return {
    async get(key) {
      const { data, error } = await supabase
        .from("dulabs_catalogo_clientes_canal")
        .select("wa_id, canal, origen, updated_at, actualizado_por")
        .eq("id_tenant", key.tenantId)
        .eq("phone_number_id", key.phoneNumberId)
        .eq("wa_id", key.waId)
        .maybeSingle();
      if (error) throw new Error(`[agente/clasificacion] ${error.code ?? "?"}`);
      return data ? fromRow(data as Row) : null;
    },
    async getMany({ tenantId, phoneNumberId, waIds }) {
      const out = new Map<string, CustomerChannel>();
      const ids = [...new Set(waIds)].filter((w) => /^[0-9]{6,20}$/.test(w)).slice(0, 500);
      if (ids.length === 0) return out;
      const { data, error } = await supabase
        .from("dulabs_catalogo_clientes_canal")
        .select("wa_id, canal, origen, updated_at, actualizado_por")
        .eq("id_tenant", tenantId)
        .eq("phone_number_id", phoneNumberId)
        .in("wa_id", ids);
      if (error) throw new Error(`[agente/clasificacion] ${error.code ?? "?"}`);
      for (const r of (data ?? []) as Row[]) {
        const c = fromRow(r);
        if (c) out.set(r.wa_id, c);
      }
      return out;
    },
    setInitial: (key, channel, origin) => rpc(key, { canal: channel, origen: origin, miembro: null, motivo: null, esperado: null }),
    change: (key, input) => rpc(key, { canal: input.channel, origen: "asesora", miembro: input.memberId, motivo: input.reason.slice(0, 300), esperado: input.expected ?? "ninguno" }),
    async history(key, limit = 20) {
      const { data, error } = await supabase
        .from("dulabs_catalogo_clientes_canal_eventos")
        .select("canal_anterior, canal_nuevo, origen, miembro_id, motivo, created_at")
        .eq("id_tenant", key.tenantId)
        .eq("phone_number_id", key.phoneNumberId)
        .eq("wa_id", key.waId)
        .order("created_at", { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 100));
      if (error) throw new Error(`[agente/clasificacion] ${error.code ?? "?"}`);
      return ((data ?? []) as Array<Record<string, unknown>>).flatMap((r) => {
        const to = asChannel(r.canal_nuevo);
        const origin = asOrigin(r.origen);
        return to && origin
          ? [{ from: asChannel(r.canal_anterior), to, origin, memberId: typeof r.miembro_id === "number" ? r.miembro_id : null, reason: typeof r.motivo === "string" ? r.motivo : null, at: String(r.created_at) }]
          : [];
      });
    },
  };
}

/** Misma semántica que la RPC (pruebas). `numbers` = qué número pertenece a qué negocio. */
export function createMemoryCustomerChannelStore(numbers: Record<string, string> = {}) {
  const rows = new Map<string, CustomerChannel & { tenantId: string }>();
  const events: Array<CustomerChannelEvent & CustomerKey> = [];
  const id = (k: { phoneNumberId: string; waId: string }) => `${k.phoneNumberId}|${k.waId}`;
  const owned = (k: CustomerKey) => {
    const owner = numbers[k.phoneNumberId];
    if (owner !== undefined && owner !== k.tenantId) throw new Error("[agente/clasificacion] 42501");
  };
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString();
  const store: CustomerChannelStore & { rows: typeof rows; events: typeof events; failNext: boolean } = {
    rows,
    events,
    failNext: false,
    async get(key) {
      if (store.failNext) {
        store.failNext = false;
        throw new Error("[agente/clasificacion] simulated");
      }
      const r = rows.get(id(key));
      return r && r.tenantId === key.tenantId ? { channel: r.channel, origin: r.origin, updatedAt: r.updatedAt, updatedBy: r.updatedBy } : null;
    },
    async getMany({ tenantId, phoneNumberId, waIds }) {
      const out = new Map<string, CustomerChannel>();
      for (const w of waIds) {
        const r = rows.get(id({ phoneNumberId, waId: w }));
        if (r && r.tenantId === tenantId) out.set(w, { channel: r.channel, origin: r.origin, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
      }
      return out;
    },
    async setInitial(key, channel, origin) {
      owned(key);
      const cur = rows.get(id(key));
      if (cur) return { result: "conflicto", channel: cur.channel, origin: cur.origin };
      const at = stamp();
      rows.set(id(key), { tenantId: key.tenantId, channel, origin, updatedAt: at, updatedBy: null });
      events.push({ ...key, from: null, to: channel, origin, memberId: null, reason: null, at });
      return { result: "fijado", channel, origin };
    },
    async change(key, input) {
      owned(key);
      const cur = rows.get(id(key));
      if (cur && cur.tenantId !== key.tenantId) throw new Error("[agente/clasificacion] 42501");
      if ((cur?.channel ?? null) !== input.expected) return { result: "conflicto", channel: cur?.channel ?? null, origin: cur?.origin ?? null };
      if (cur?.channel === input.channel) return { result: "sin_cambio", channel: cur.channel, origin: cur.origin };
      const at = stamp();
      rows.set(id(key), { tenantId: key.tenantId, channel: input.channel, origin: "asesora", updatedAt: at, updatedBy: input.memberId });
      events.push({ ...key, from: cur?.channel ?? null, to: input.channel, origin: "asesora", memberId: input.memberId, reason: input.reason.slice(0, 300), at });
      return { result: "cambiado", channel: input.channel, origin: "asesora" };
    },
    async history(key, limit = 20) {
      return events
        .filter((e) => e.tenantId === key.tenantId && e.phoneNumberId === key.phoneNumberId && e.waId === key.waId)
        .reverse()
        .slice(0, limit)
        .map(({ from, to, origin, memberId, reason, at }) => ({ from, to, origin, memberId, reason, at }));
    },
  };
  return store;
}
