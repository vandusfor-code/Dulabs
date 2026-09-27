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
  message: string;
  /** Clave de idempotencia (32 hex): la de la operación del Action Engine. */
  idempotencyKey: string;
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
}

export interface ReminderStore {
  schedule(input: ScheduleReminderInput): Promise<{ outcome: ScheduleOutcome; remindAt: string }>;
  cancel(tenantId: string, conversationId: string, anchorRef: string | null): Promise<number>;
  reschedule(tenantId: string, conversationId: string, anchorRef: string | null, newStart: string, offsetMinutes: number): Promise<number>;
  claimDue(limit: number, leaseSeconds: number): Promise<DueReminder[]>;
  complete(input: { tenantId: string; id: string; attempts: number; status: "sent" | "failed" | "unknown" | "retry"; error: string | null; retryAt: string | null }): Promise<boolean>;
}

export function createSupabaseReminderStore(supabase: SupabaseClient): ReminderStore {
  return {
    async schedule(i) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_schedule", {
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
      });
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
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
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
      }));
    },
    async complete(i) {
      const { data, error } = await supabase.rpc("dulabs_ba_reminder_complete", { p_tenant: i.tenantId, p_id: i.id, p_attempts: i.attempts, p_status: i.status, p_error: i.error, p_retry_at: i.retryAt });
      if (error) throw new Error(`reminder_complete_failed:${error.code ?? "unknown"}`);
      return data === true;
    },
  };
}
