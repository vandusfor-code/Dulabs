// DuLabs Business — Business Agent 2.0, FASE 8 — recordatorios de cita (dominio + store de Postgres).
//
// El recordatorio SIEMPRE está anclado a una cita que el agente agendó en esta conversación (state.lastBooking, dato
// del backend). El momento se calcula aquí, en la zona horaria del negocio, nunca lo decide el modelo:
//
//   sin fecha ni hora            → inicio de la cita − anticipación configurada (offsetMinutes)
//   fecha y hora                 → exactamente ese momento
//   solo fecha (= día de la cita) → inicio − anticipación, si cae ese día; si no, a la hora de la cita de ese día… (ver abajo)
//   solo hora                    → ese reloj el día de la cita
//
// Reglas duras (también en Postgres, migración 20261127000000): antes de la cita y no en el pasado.
// Idempotencia: la misma solicitud (clave = operación del Action Engine) no crea dos; una hora nueva ACTUALIZA el único
// recordatorio activo de esa cita. Cancelar / reprogramar la cita cancela / mueve el recordatorio.
//
// FASE 9 (migración 20261128000000): el texto se RENDERIZA AL ENVIAR (tono + servicio + inicio VIGENTE de la cita), así
// una cita reprogramada nunca recibe el recordatorio con la hora vieja; cancelar / reprogramar un recordatorio que el
// despachador YA tomó lo invalida (begin_send), y un envío de desenlace desconocido se VERIFICA, nunca se reenvía.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ReminderTimeResult = { ok: true; remindAt: string } | { ok: false; reason: "after_appointment" | "in_past" | "invalid_input" };

/** Offset (min) de una zona IANA en un instante. */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Fecha + hora LOCALES del negocio → instante UTC (ISO). */
export function zonedToUtc(date: string, time: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  let guess = new Date(naive - offsetMinutes(timeZone, new Date(naive)) * 60_000);
  guess = new Date(naive - offsetMinutes(timeZone, guess) * 60_000);
  return guess;
}

/** Fecha y hora locales (YYYY-MM-DD, HH:MM) de un instante en la zona dada. */
export function localParts(at: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

export function computeReminderAt(input: { appointmentStart: string; offsetMinutes: number; date?: string; time?: string; timeZone: string; now: Date }): ReminderTimeResult {
  const start = new Date(input.appointmentStart);
  if (Number.isNaN(start.getTime()) || input.offsetMinutes < 0) return { ok: false, reason: "invalid_input" };
  const byDefault = new Date(start.getTime() - input.offsetMinutes * 60_000);
  const appt = localParts(start, input.timeZone);
  let at: Date | null;
  if (input.date && input.time) at = zonedToUtc(input.date, input.time, input.timeZone);
  else if (input.time) at = zonedToUtc(appt.date, input.time, input.timeZone);
  else if (input.date) {
    // El día pedido: si la anticipación por defecto cae ese día, esa; si no, ese día a la misma hora de la cita.
    at = localParts(byDefault, input.timeZone).date === input.date ? byDefault : zonedToUtc(input.date, appt.time, input.timeZone);
  } else at = byDefault;
  if (!at) return { ok: false, reason: "invalid_input" };
  if (at.getTime() >= start.getTime()) return { ok: false, reason: "after_appointment" };
  if (at.getTime() < input.now.getTime() - 60_000) return { ok: false, reason: "in_past" };
  return { ok: true, remindAt: at.toISOString() };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ScheduleReminderInput {
  tenantId: string;
  agentId: string;
  conversationId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  anchorRef: string;
  appointmentStart: string;
  service: string | null;
  remindAt: string;
  timezone: string;
  /** Texto de respaldo (histórico). El que se envía se renderiza al enviar (ver reminder-dispatcher.ts). */
  message: string;
  /** Clave de idempotencia (32 hex): la de la operación del Action Engine. */
  idempotencyKey: string;
  /** FASE 9 — tono del agente publicado (para renderizar el texto al enviar). */
  tone?: string | null;
}

export type ScheduleOutcome = "scheduled" | "updated" | "unchanged" | "already_sending" | "after_appointment" | "in_past" | `closed_${string}`;

export interface DueReminder {
  id: string;
  tenantId: string;
  agentId: string;
  conversationId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  appointmentStart: string;
  remindAt: string;
  message: string;
  attempts: number;
  /** FASE 9 — hechos para renderizar el texto al enviar. */
  service: string | null;
  timezone: string;
  tone: string | null;
  /** Cuándo lo tomó el despachador por última vez (ventana para verificar un envío desconocido). */
  lastClaimedAt: string | null;
}

/** Justo antes de enviar: go = enviar; cancelled / rescheduled / lost = NO enviar. */
export type BeginSendOutcome = "go" | "cancelled" | "rescheduled" | "lost";

export interface ReminderStore {
  schedule(input: ScheduleReminderInput): Promise<{ outcome: ScheduleOutcome; remindAt: string }>;
  cancel(tenantId: string, conversationId: string, anchorRef: string | null): Promise<number>;
  reschedule(tenantId: string, conversationId: string, anchorRef: string | null, newStart: string, offsetMinutes: number): Promise<number>;
  claimDue(limit: number, leaseSeconds: number): Promise<DueReminder[]>;
  complete(input: { tenantId: string; id: string; attempts: number; status: "sent" | "failed" | "unknown" | "retry"; error: string | null; retryAt: string | null }): Promise<boolean>;
  /** FASE 9 — revalida el recordatorio tomado justo antes de enviar (cancelado / reprogramado mientras tanto). */
  beginSend(tenantId: string, id: string, attempts: number): Promise<BeginSendOutcome>;
  /** FASE 9 — cierre como enviado con el id del mensaje del proveedor (fencing por attempts). */
  markSent(tenantId: string, id: string, attempts: number, providerMessageId: string | null): Promise<boolean>;
  /** FASE 9 — envíos de desenlace desconocido pendientes de verificar. */
  unverified(limit: number): Promise<DueReminder[]>;
  /** FASE 9 — resultado de la verificación: encontrado → sent; no encontrado → sigue unknown (nunca se reenvía). */
  resolveUnknown(tenantId: string, id: string, found: boolean): Promise<boolean>;
}

const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

function dueFromRow(r: Record<string, unknown>): DueReminder {
  return {
    id: String(r.id),
    tenantId: String(r.id_tenant),
    agentId: String(r.agent_id),
    conversationId: String(r.conversation_id),
    phoneNumberId: String(r.phone_number_id),
    telefonoCliente: String(r.telefono_cliente),
    appointmentStart: new Date(String(r.appointment_start)).toISOString(),
    remindAt: new Date(String(r.remind_at)).toISOString(),
    message: String(r.message),
    attempts: Number(r.attempts),
    service: typeof r.service === "string" ? r.service : null,
    timezone: typeof r.timezone === "string" ? r.timezone : "America/Bogota",
    tone: typeof r.tone === "string" ? r.tone : null,
    lastClaimedAt: typeof r.last_claimed_at === "string" ? new Date(r.last_claimed_at).toISOString() : null,
  };
}

export function createSupabaseReminderStore(supabase: SupabaseClient): ReminderStore {
  return {
    async schedule(i) {
      const args = {
        p_tenant: i.tenantId,
        p_agent: i.agentId,
        p_conversation: i.conversationId,
        p_phone_number_id: i.phoneNumberId,
        p_telefono: i.telefonoCliente,
        p_anchor: i.anchorRef,
        p_appointment_start: i.appointmentStart,
        p_service: i.service,
        p_remind_at: i.remindAt,
        p_timezone: i.timezone,
        p_message: i.message,
        p_key: i.idempotencyKey,
      };
      let { data, error } = await supabase.rpc("dulabs_ba_reminder_schedule", { ...args, p_tone: i.tone ?? null });
      // Sin la migración 20261128 (solo 20261127): la firma de 12 argumentos, sin tono (el despachador usa el texto guardado).
      if (error && MISSING_FUNCTION.has(error.code ?? "")) ({ data, error } = await supabase.rpc("dulabs_ba_reminder_schedule", args));
      if (error) throw new Error(`reminder_schedule_failed:${error.code ?? "unknown"}`);
      const row = (Array.isArray(data) ? data[0] : data) as { outcome: string; remind_at: string } | undefined;
      if (!row) throw new Error("reminder_schedule_empty");
      return { outcome: row.outcome as ScheduleOutcome, remindAt: new Date(row.remind_at).toISOString() };
    },
    async cancel(tenantId, conversationId, anchorRef) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_cancel", { p_tenant: tenantId, p_conversation: conversationId, p_anchor: anchorRef });
      if (error) throw new Error(`reminder_cancel_failed:${error.code ?? "unknown"}`);
      return Number(data ?? 0);
    },
    async reschedule(tenantId, conversationId, anchorRef, newStart, offset) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_reschedule", { p_tenant: tenantId, p_conversation: conversationId, p_anchor: anchorRef, p_new_start: newStart, p_offset_minutes: offset });
      if (error) throw new Error(`reminder_reschedule_failed:${error.code ?? "unknown"}`);
      return Number(data ?? 0);
    },
    async claimDue(limit, leaseSeconds) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_claim_due", { p_limit: limit, p_lease_seconds: leaseSeconds });
      if (error) throw new Error(`reminder_claim_failed:${error.code ?? "unknown"}`);
      return ((data ?? []) as Array<Record<string, unknown>>).map(dueFromRow);
    },
    async complete(i) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_complete", { p_tenant: i.tenantId, p_id: i.id, p_attempts: i.attempts, p_status: i.status, p_error: i.error, p_retry_at: i.retryAt });
      if (error) throw new Error(`reminder_complete_failed:${error.code ?? "unknown"}`);
      return data === true;
    },
    async beginSend(tenantId, id, attempts) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_begin_send", { p_tenant: tenantId, p_id: id, p_attempts: attempts });
      if (error) throw new Error(`reminder_begin_send_failed:${error.code ?? "unknown"}`);
      return data === "go" || data === "cancelled" || data === "rescheduled" ? data : "lost";
    },
    async markSent(tenantId, id, attempts, providerMessageId) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_mark_sent", { p_tenant: tenantId, p_id: id, p_attempts: attempts, p_provider_message_id: providerMessageId });
      if (error) throw new Error(`reminder_mark_sent_failed:${error.code ?? "unknown"}`);
      return data === true;
    },
    async unverified(limit) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_unverified", { p_limit: limit });
      if (error) throw new Error(`reminder_unverified_failed:${error.code ?? "unknown"}`);
      return ((data ?? []) as Array<Record<string, unknown>>).map(dueFromRow);
    },
    async resolveUnknown(tenantId, id, found) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_resolve_unknown", { p_tenant: tenantId, p_id: id, p_found: found });
      if (error) throw new Error(`reminder_resolve_unknown_failed:${error.code ?? "unknown"}`);
      return data === true;
    },
  };
}
