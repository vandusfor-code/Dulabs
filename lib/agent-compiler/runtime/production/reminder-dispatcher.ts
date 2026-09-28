// DuLabs Business — Business Agent 2.0, FASE 8/9 — despacho de recordatorios de cita.
//
//   verificar desconocidos → claim (lease, SKIP LOCKED) → begin_send (¿sigue vigente?) → ventana de WhatsApp →
//   texto renderizado AHORA → envío → cierre con fencing (attempts) → latido
//
// Reglas (política de reintentos única: retry-policy.ts → reminder_send):
//   - WhatsApp solo permite texto libre dentro de las 24 h desde el último mensaje del cliente. Fuera de la ventana NO
//     se envía (haría falta una plantilla aprobada, que este negocio no tiene configurada): se cierra como fallido
//     WINDOW_CLOSED. Nunca se "simula" el envío.
//   - FASE 9: justo antes de enviar se pregunta a Postgres si el recordatorio sigue vigente (`begin_send`): si la cita
//     se canceló o se reprogramó mientras el despachador lo tenía tomado, NO se envía (cancelado / vuelve a programarse
//     para la hora nueva). El texto se renderiza en ese momento con el inicio VIGENTE de la cita (nunca la hora vieja).
//   - Error transitorio ANTES de enviar (config no disponible) o 429/5xx de Meta → reintento acotado (3 intentos,
//     backoff exponencial con jitter, nunca después de la cita). 4xx definitivo → failed.
//   - Timeout / conexión cortada DURANTE el envío → unknown: pudo haber llegado. FASE 9: se VERIFICA contra el historial
//     de salientes; encontrado → sent; no encontrado → sigue unknown (no registrado ≠ no entregado). NUNCA se reenvía.
//   - Palanca de emergencia: BUSINESS_AGENT_REMINDERS_DISABLED=1 detiene el despacho (no se toma ninguno).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import { enviarTexto, MetaGraphApiError } from "@/lib/whatsapp";
import { incrementarUsoMensajes, registrarMensaje, resolverTokenMeta } from "@/lib/whatsapp-outbound";
import { createSupabaseReminderStore, type DueReminder, type ReminderStore } from "@/lib/agent-compiler/actions/native/reminders";
import { phrasebook } from "@/lib/agent-compiler/conversation/phrasebook";
import { formatInstant } from "@/lib/agent-compiler/conversation/renderer";
import { RETRY_POLICIES, retryDecision } from "@/lib/agent-compiler/runtime/production/retry-policy";
import { sharedCircuits, underCircuit, type CircuitRegistry } from "@/lib/agent-compiler/runtime/production/circuits";

export const REMINDERS_DISABLED_ENV = "BUSINESS_AGENT_REMINDERS_DISABLED";
export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_REMINDER_ATTEMPTS = RETRY_POLICIES.reminder_send.maxAttempts;
export const REMINDER_LEASE_SECONDS = 60;
export const REMINDER_DISPATCH_JOB = "reminders_dispatch";

export type SendOutcome = { kind: "sent"; providerMessageId?: string | null } | { kind: "retryable"; code: string } | { kind: "definitive"; code: string } | { kind: "ambiguous"; code: string };

export interface ReminderDispatchDeps {
  store: ReminderStore;
  /** Último mensaje del CLIENTE en esa conversación (ventana de 24 h). null = no se sabe → no se envía. */
  lastInboundAt(reminder: DueReminder): Promise<Date | null>;
  send(reminder: DueReminder, text: string): Promise<SendOutcome>;
  /** FASE 9 — ¿el envío de desenlace desconocido quedó en el historial de salientes? Lanza si no se puede saber. */
  findSent?(reminder: DueReminder, text: string): Promise<boolean>;
  /** FASE 9 — latido del job (readiness). Best-effort. */
  heartbeat?(ok: boolean, summary: DispatchSummary): Promise<void>;
  clock?: () => Date;
  env?: Record<string, string | undefined>;
  log?: (event: ReminderDispatchEvent) => void;
  random?: () => number;
  /** FASE 9 — circuito de WhatsApp por tenant: con Meta caído para ese número no se insiste (se reprograma). */
  circuits?: CircuitRegistry;
}

/** Fallas de Meta que hablan de su salud o de la credencial del tenant (no de un destinatario puntual). */
const countsAgainstWhatsApp = (o: SendOutcome) => o.kind === "retryable" || o.kind === "ambiguous" || (o.kind === "definitive" && /^META_(401|403)$/.test(o.code));

export interface ReminderDispatchEvent {
  event: "business_agent.reminder";
  tenantId: string;
  reminderId: string;
  outcome: "sent" | "failed" | "unknown" | "retry" | "cancelled" | "rescheduled" | "lost" | "verified_sent" | "verified_not_found";
  code: string | null;
  attempts: number;
}

export interface DispatchSummary {
  disabled: boolean;
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  unknown: number;
  /** FASE 9 — invalidados justo antes de enviar. */
  skippedCancelled: number;
  skippedRescheduled: number;
  lost: number;
  /** FASE 9 — verificación de desconocidos. */
  verifiedSent: number;
  verifiedNotFound: number;
}

/** Texto del recordatorio con los HECHOS vigentes (tono del agente; sin tono guardado = plantillas de siempre). */
export function renderReminderText(r: Pick<DueReminder, "tone" | "service" | "appointmentStart" | "timezone">): string {
  return phrasebook(r.tone).reminderMessage(r.service, formatInstant(r.appointmentStart, r.timezone)).slice(0, 500);
}

export async function dispatchDueReminders(deps: ReminderDispatchDeps, opts: { limit?: number } = {}): Promise<DispatchSummary> {
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? (() => new Date());
  const log = deps.log ?? ((e: ReminderDispatchEvent) => console.info("[business-agent.reminder]", JSON.stringify(e)));
  const summary: DispatchSummary = { disabled: false, claimed: 0, sent: 0, failed: 0, retried: 0, unknown: 0, skippedCancelled: 0, skippedRescheduled: 0, lost: 0, verifiedSent: 0, verifiedNotFound: 0 };
  const beat = async (ok: boolean) => {
    try {
      await deps.heartbeat?.(ok, summary);
    } catch {
      // El latido es observabilidad: nunca rompe el despacho.
    }
  };
  if ((env[REMINDERS_DISABLED_ENV] ?? "").trim() === "1") {
    summary.disabled = true;
    await beat(true);
    return summary;
  }
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const emit = (r: DueReminder, outcome: ReminderDispatchEvent["outcome"], code: string | null) =>
    log({ event: "business_agent.reminder", tenantId: r.tenantId, reminderId: r.id, outcome, code, attempts: r.attempts });

  try {
    // 1. Desenlaces desconocidos: VERIFICAR (lectura) antes de cualquier envío nuevo. Nunca se reenvían.
    if (deps.findSent) {
      for (const r of await deps.store.unverified(limit)) {
        let found: boolean;
        try {
          found = await deps.findSent(r, renderReminderText(r));
        } catch {
          continue; // No se puede saber ahora: sigue pendiente de verificar (siguiente despacho).
        }
        if (await deps.store.resolveUnknown(r.tenantId, r.id, found)) {
          if (found) summary.verifiedSent++;
          else summary.verifiedNotFound++;
          emit(r, found ? "verified_sent" : "verified_not_found", null);
        }
      }
    }

    // 2. Vencidos.
    const due = await deps.store.claimDue(limit, REMINDER_LEASE_SECONDS);
    summary.claimed = due.length;
    for (const r of due) {
      const close = async (status: "failed" | "unknown" | "retry", code: string, retryAt: string | null = null) => {
        await deps.store.complete({ tenantId: r.tenantId, id: r.id, attempts: r.attempts, status, error: code, retryAt });
        emit(r, status, code);
        if (status === "failed") summary.failed++;
        else if (status === "unknown") summary.unknown++;
        else summary.retried++;
      };
      const retryOrFail = (code: string) => {
        const d = retryDecision(RETRY_POLICIES.reminder_send, r.attempts, "RETRYABLE", deps.random);
        return d.retry ? close("retry", code, new Date(clock().getTime() + d.delayMs).toISOString()) : close("failed", code);
      };
      try {
        // ¿Sigue vigente? (cancelado / reprogramado mientras lo teníamos tomado → no se envía).
        const begin = await deps.store.beginSend(r.tenantId, r.id, r.attempts);
        if (begin !== "go") {
          if (begin === "cancelled") summary.skippedCancelled++;
          else if (begin === "rescheduled") summary.skippedRescheduled++;
          else summary.lost++;
          emit(r, begin, null);
          continue;
        }
        let last: Date | null;
        try {
          last = await deps.lastInboundAt(r);
        } catch {
          await retryOrFail("WINDOW_CHECK_FAILED");
          continue;
        }
        if (!last || clock().getTime() - last.getTime() > WHATSAPP_SESSION_WINDOW_MS) {
          await close("failed", "WINDOW_CLOSED");
          continue;
        }
        const breaker = deps.circuits?.get("whatsapp", r.tenantId) ?? null;
        const text = renderReminderText(r);
        // Circuito abierto: NO se llamó a Meta (nada ambiguo) → reintento acotado como cualquier transitorio.
        const out = await underCircuit<SendOutcome>(breaker, () => clock().getTime(), () => deps.send(r, text), countsAgainstWhatsApp, () => ({ kind: "retryable", code: "CIRCUIT_OPEN" }));
        if (out.kind === "sent") {
          await deps.store.markSent(r.tenantId, r.id, r.attempts, out.providerMessageId ?? null);
          summary.sent++;
          emit(r, "sent", null);
        } else if (out.kind === "ambiguous") await close("unknown", out.code);
        else if (out.kind === "definitive") await close("failed", out.code);
        else await retryOrFail(out.code);
      } catch {
        // Error inesperado tras el claim: el lease vence y el siguiente despacho lo marca unknown → se verifica.
      }
    }
  } catch (e) {
    await beat(false);
    throw e;
  }
  await beat(true);
  return summary;
}

// ---------------------------------------------------------------------------
// Producción: WhatsApp real (mismo envío y registro que el agente) + ventana desde el estado conversacional
// ---------------------------------------------------------------------------


export const REMINDER_SEND_TIMEOUT_MS = 10_000;

export function createProductionReminderDispatchDeps(supabase: SupabaseClient): ReminderDispatchDeps {
  return {
    store: createSupabaseReminderStore(supabase),
    circuits: sharedCircuits,
    async lastInboundAt(r) {
      const { data, error } = await supabase
        .from("dulabs_ba_conversation_states")
        .select("last_message_at")
        .eq("id_tenant", r.tenantId)
        .eq("phone_number_id", r.phoneNumberId)
        .eq("telefono_cliente", r.telefonoCliente)
        .eq("agent_id", r.agentId)
        .maybeSingle();
      if (error) throw new Error(`window_read_failed:${error.code ?? "unknown"}`);
      const at = (data as { last_message_at: string | null } | null)?.last_message_at;
      return at ? new Date(at) : null;
    },
    async findSent(r, text) {
      // Ventana: desde que se tomó (o el momento programado) — el mismo texto al mismo cliente por el mismo número.
      const since = new Date(Date.parse(r.lastClaimedAt ?? r.remindAt) - 5_000).toISOString();
      const { data, error } = await supabase
        .from("dulabs_mensajes_log")
        .select("id")
        .eq("phone_number_id", r.phoneNumberId)
        .eq("telefono_cliente", r.telefonoCliente.replace(/\D/g, ""))
        .eq("direccion", "saliente")
        .eq("contenido", text)
        .gte("created_at", since)
        .limit(1);
      if (error) throw new Error(`outbound_log_read_failed:${error.code ?? "unknown"}`);
      return Array.isArray(data) && data.length > 0;
    },
    async heartbeat(ok, summary) {
      await supabase.rpc("dulabs_ba_job_heartbeat", { p_job: REMINDER_DISPATCH_JOB, p_ok: ok, p_summary: summary });
    },
    async send(r, text) {
      const { data, error } = await supabase.from("dulabs_clientes_config").select("*").eq("phone_number_id", r.phoneNumberId).maybeSingle();
      if (error) return { kind: "retryable", code: "CONFIG_UNAVAILABLE" };
      const cliente = data as ClienteConfig | null;
      // El número debe seguir siendo del MISMO tenant que programó el recordatorio.
      if (!cliente || cliente.id_tenant !== r.tenantId) return { kind: "definitive", code: "TENANT_NUMBER_MISMATCH" };
      const token = resolverTokenMeta(cliente);
      if (!token) return { kind: "definitive", code: "NO_META_TOKEN" };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REMINDER_SEND_TIMEOUT_MS);
      let wamid: string | null;
      try {
        ({ wamid } = await enviarTexto({ phoneNumberId: r.phoneNumberId, token, para: r.telefonoCliente, texto: text, signal: controller.signal }));
      } catch (e) {
        if (e instanceof MetaGraphApiError) {
          if (e.httpStatus === 429 || e.httpStatus >= 500) return { kind: "retryable", code: `META_${e.httpStatus}` };
          return { kind: "definitive", code: `META_${e.httpStatus}` };
        }
        // Timeout / conexión cortada: pudo haber llegado. Nunca se reenvía.
        return { kind: "ambiguous", code: "SEND_OUTCOME_UNKNOWN" };
      } finally {
        clearTimeout(timer);
      }
      // Registro y uso: igual que cualquier mensaje saliente del agente (fallar aquí no des-envía el mensaje).
      try {
        await incrementarUsoMensajes(supabase, cliente);
        await registrarMensaje(supabase, r.phoneNumberId, r.telefonoCliente.replace(/\D/g, ""), "saliente", text, "ia", wamid ?? undefined);
      } catch {
        // observabilidad best-effort
      }
      return { kind: "sent", providerMessageId: wamid ?? null };
    },
  };
}
