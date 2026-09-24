/**
 * BUZÓN + TURNO ÚNICO por conversación (Bloque 11).
 *
 * Cada mensaje para el agente entra al buzón (único por wamid). Solo UN proceso a la vez
 * tiene el turno de la conversación; ese proceso atiende TODOS los mensajes pendientes
 * juntos (la ráfaga completa, conservando la foto citada) y, antes de soltar el turno,
 * vuelve a mirar el buzón en la MISMA operación atómica (dulabs_agente_soltar_turno):
 * ningún mensaje se queda sin atender y nunca hay dos turnos del agente en paralelo.
 *
 *   mensaje -> buzón -> ¿turno? --no--> "en cola" (lo atiende el turno en curso)
 *                         |sí
 *                         v
 *              [pendientes -> UN turno del agente -> marcar procesados]*  (acotado en tiempo)
 *                         -> soltar (si llegó algo: seguir)
 *
 * Si el proceso se cae, el turno vence solo; el siguiente mensaje atiende lo pendiente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationKey } from "@/lib/agente/estado";

export interface MailboxMessage {
  wamid: string;
  text: string;
  /** wamid citado (respuesta a una foto) y si el mensaje fue reenviado. */
  replyTo: { wamid: string | null; forwarded: boolean } | null;
  /** Cuándo entró al buzón (ms); lo pone el store. */
  receivedAt?: number;
}

export type EnqueueResult = "queued" | "duplicate" | "unavailable";
export type ReleaseResult = "released" | "pending" | "lost";

export interface MailboxStore {
  enqueue(key: ConversationKey, message: MailboxMessage): Promise<EnqueueResult>;
  /** Toma o renueva el turno (true = es del dueño indicado). */
  acquire(key: ConversationKey, owner: string, seconds: number): Promise<boolean>;
  /** Suelta el turno SOLO si no hay pendientes (atómico). */
  release(key: ConversationKey, owner: string): Promise<ReleaseResult>;
  /** Suelta el turno aunque haya pendientes (se acabó el tiempo de esta ejecución). */
  forceRelease(key: ConversationKey, owner: string): Promise<void>;
  /** Pendientes de la conversación, del más antiguo al más nuevo. */
  pending(key: ConversationKey, limit: number): Promise<MailboxMessage[]>;
  markProcessed(key: ConversationKey, wamids: readonly string[], turn: number | null): Promise<void>;
}

/** Varios mensajes -> una entrada del turno: textos en orden, el wamid más nuevo, la cita más reciente. */
export function batchInput(messages: readonly MailboxMessage[]): { text: string; wamid: string; wamids: string[]; replyTo: MailboxMessage["replyTo"] } {
  const last = messages[messages.length - 1];
  const withReply = [...messages].reverse().find((m) => m.replyTo && (m.replyTo.wamid || m.replyTo.forwarded));
  const text = messages
    .map((m) => m.text.trim())
    .filter(Boolean)
    .join("\n")
    .slice(-4_000);
  return { text, wamid: last.wamid, wamids: messages.map((m) => m.wamid), replyTo: withReply?.replyTo ?? null };
}

export interface DrainOptions {
  /** Turno de la conversación (s) mientras se atiende; se renueva antes de cada turno. */
  leaseSeconds?: number;
  /**
   * No se empieza otro turno si ya pasó este tiempo (ms) desde que se tomó el turno. Con 45 s
   * (y turnos de máx. 45 s) dos turnos caben en los 120 s de la función del webhook.
   */
  budgetMs?: number;
  maxMessagesPerTurn?: number;
  /** Tope de turnos por ejecución (defensa ante un bucle). */
  maxTurns?: number;
  /**
   * Pendientes más viejos que esto (ms) se cierran sin responder: p. ej. quedaron en el buzón
   * mientras una asesora tenía el chat; responderlos después sería contestar algo ya atendido.
   */
  staleMs?: number;
  now?: () => number;
}

export type DrainResult =
  | { status: "queued" }
  | { status: "unavailable" }
  | { status: "drained"; turns: number; leftPending: boolean; lost: boolean };

/**
 * Encola el mensaje y, si consigue el turno, atiende el buzón. `runTurn` ejecuta UN turno
 * del agente con los mensajes dados (nunca lanza; devuelve el turno de estado o null).
 */
export async function enqueueAndDrain(
  store: MailboxStore,
  key: ConversationKey,
  message: MailboxMessage,
  runTurn: (batch: MailboxMessage[]) => Promise<number | null>,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const enq = await store.enqueue(key, message);
  if (enq === "unavailable") return { status: "unavailable" };
  return drain(store, key, message.wamid, runTurn, opts);
}

export async function drain(
  store: MailboxStore,
  key: ConversationKey,
  owner: string,
  runTurn: (batch: MailboxMessage[]) => Promise<number | null>,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const leaseSeconds = opts.leaseSeconds ?? 75;
  const budgetMs = opts.budgetMs ?? 45_000;
  const limit = opts.maxMessagesPerTurn ?? 10;
  const maxTurns = opts.maxTurns ?? 3;
  const staleMs = opts.staleMs ?? 15 * 60_000;
  const now = opts.now ?? Date.now;
  const started = now();

  if (!(await store.acquire(key, owner, leaseSeconds))) return { status: "queued" };
  let turns = 0;
  for (;;) {
    const pending = await store.pending(key, limit);
    const stale = pending.filter((m) => m.receivedAt !== undefined && now() - m.receivedAt > staleMs);
    if (stale.length > 0) {
      await store.markProcessed(
        key,
        stale.map((m) => m.wamid),
        null,
      );
      continue;
    }
    const batch = pending;
    if (batch.length > 0) {
      // Sin tiempo para otro turno: lo pendiente queda para el siguiente mensaje (el turno se suelta).
      if (turns >= maxTurns || (turns > 0 && now() - started > budgetMs)) {
        await store.forceRelease(key, owner);
        return { status: "drained", turns, leftPending: true, lost: false };
      }
      if (!(await store.acquire(key, owner, leaseSeconds))) return { status: "drained", turns, leftPending: true, lost: true };
      // Un turno que falla igual cierra sus mensajes (el runtime ya respondió con un mensaje fijo o calló):
      // nunca se reintenta en bucle el mismo mensaje.
      const turn = await runTurn(batch).catch(() => null);
      turns++;
      await store.markProcessed(
        key,
        batch.map((m) => m.wamid),
        turn,
      );
      continue;
    }
    const released = await store.release(key, owner);
    if (released === "pending") continue;
    return { status: "drained", turns, leftPending: false, lost: released === "lost" };
  }
}

// ---------------------------------------------------------------------------

const T_BUZON = "dulabs_agente_buzon";
const T_TURNO = "dulabs_agente_turno";
const MISSING_SCHEMA = new Set(["42P01", "42703", "PGRST202", "PGRST204", "PGRST205", "42883"]);

export function createSupabaseMailboxStore(supabase: SupabaseClient): MailboxStore {
  return {
    async enqueue(key, m) {
      const { error } = await supabase.from(T_BUZON).insert({
        id_tenant: key.tenantId,
        phone_number_id: key.phoneNumberId,
        wa_id: key.waId,
        wamid: m.wamid,
        texto: m.text.slice(0, 4_000),
        responde_a: m.replyTo?.wamid ?? null,
        reenviado: m.replyTo?.forwarded ?? false,
      });
      if (!error) return "queued";
      if (error.code === "23505") return "duplicate";
      if (MISSING_SCHEMA.has(error.code ?? "")) return "unavailable";
      throw new Error(`[agente/buzon] enqueue ${error.code ?? "?"}`);
    },
    async acquire(key, owner, seconds) {
      const { data, error } = await supabase.rpc("dulabs_agente_tomar_turno", { p_tenant: key.tenantId, p_pn: key.phoneNumberId, p_wa: key.waId, p_dueno: owner, p_segundos: seconds });
      if (error) throw new Error(`[agente/buzon] acquire ${error.code ?? "?"}`);
      return data === true;
    },
    async release(key, owner) {
      const { data, error } = await supabase.rpc("dulabs_agente_soltar_turno", { p_pn: key.phoneNumberId, p_wa: key.waId, p_dueno: owner });
      if (error) throw new Error(`[agente/buzon] release ${error.code ?? "?"}`);
      return data === "pending" || data === "lost" ? data : "released";
    },
    async forceRelease(key, owner) {
      await supabase.from(T_TURNO).delete().eq("phone_number_id", key.phoneNumberId).eq("wa_id", key.waId).eq("dueno", owner);
    },
    async pending(key, limit) {
      const { data, error } = await supabase
        .from(T_BUZON)
        .select("wamid, texto, responde_a, reenviado, recibido_at")
        .eq("phone_number_id", key.phoneNumberId)
        .eq("wa_id", key.waId)
        .eq("id_tenant", key.tenantId)
        .is("procesado_at", null)
        .order("id", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`[agente/buzon] pending ${error.code ?? "?"}`);
      return ((data ?? []) as Array<{ wamid: string; texto: string | null; responde_a: string | null; reenviado: boolean; recibido_at: string }>).map((r) => ({
        wamid: r.wamid,
        text: r.texto ?? "",
        replyTo: r.responde_a || r.reenviado ? { wamid: r.responde_a, forwarded: r.reenviado } : null,
        receivedAt: Date.parse(r.recibido_at),
      }));
    },
    async markProcessed(key, wamids, turn) {
      if (wamids.length === 0) return;
      // El texto se borra al procesarse: ya vive en dulabs_mensajes_log (no se duplica contenido del cliente).
      const { error } = await supabase
        .from(T_BUZON)
        .update({ procesado_at: new Date().toISOString(), texto: null, turno: turn })
        .eq("phone_number_id", key.phoneNumberId)
        .eq("wa_id", key.waId)
        .in("wamid", [...wamids]);
      if (error) throw new Error(`[agente/buzon] markProcessed ${error.code ?? "?"}`);
    },
  };
}

/** Buzón en memoria con las MISMAS reglas (pruebas; también simula procesos concurrentes). */
export function createMemoryMailboxStore(opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const rows: Array<MailboxMessage & { key: string; tenantId: string; processed: boolean; turn: number | null }> = [];
  const leases = new Map<string, { owner: string; tenantId: string; until: number }>();
  const k = (key: ConversationKey) => `${key.phoneNumberId}|${key.waId}`;
  const store: MailboxStore & { rows: typeof rows; leases: typeof leases; available: boolean } = {
    rows,
    leases,
    available: true,
    async enqueue(key, m) {
      if (!store.available) return "unavailable";
      if (rows.some((r) => r.wamid === m.wamid)) return "duplicate";
      rows.push({ ...m, receivedAt: m.receivedAt ?? now(), key: k(key), tenantId: key.tenantId, processed: false, turn: null });
      return "queued";
    },
    async acquire(key, owner, seconds) {
      const l = leases.get(k(key));
      if (l && (l.tenantId !== key.tenantId || (l.until >= now() && l.owner !== owner))) return false;
      leases.set(k(key), { owner, tenantId: key.tenantId, until: now() + Math.min(Math.max(seconds, 10), 300) * 1000 });
      return true;
    },
    async release(key, owner) {
      const l = leases.get(k(key));
      if (!l || l.owner !== owner) return "lost";
      if (rows.some((r) => r.key === k(key) && !r.processed)) return "pending";
      leases.delete(k(key));
      return "released";
    },
    async forceRelease(key, owner) {
      if (leases.get(k(key))?.owner === owner) leases.delete(k(key));
    },
    async pending(key, limit) {
      return rows
        .filter((r) => r.key === k(key) && r.tenantId === key.tenantId && !r.processed)
        .slice(0, limit)
        .map((r) => ({ wamid: r.wamid, text: r.text, replyTo: r.replyTo, receivedAt: r.receivedAt }));
    },
    async markProcessed(key, wamids, turn) {
      for (const r of rows) if (r.key === k(key) && wamids.includes(r.wamid)) Object.assign(r, { processed: true, turn, text: "" });
    },
  };
  return store;
}
