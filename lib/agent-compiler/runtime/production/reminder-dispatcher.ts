// DuLabs Business — Business Agent 2.0, FASE 8 — despacho de recordatorios de cita.
//
//   claim (lease, SKIP LOCKED) → ventana de WhatsApp → envío → cierre con fencing
//
// Reglas (política de reintentos explícita, ver FASE-8 doc):
//   - WhatsApp solo permite texto libre dentro de las 24 h desde el último mensaje del cliente. Fuera de la ventana NO
//     se envía (haría falta una plantilla aprobada, que este negocio no tiene configurada): se cierra como fallido
//     WINDOW_CLOSED. Nunca se "simula" el envío.
//   - Error transitorio ANTES de enviar (config no disponible) o 429/5xx de Meta → reintento acotado (3 intentos,
//     backoff 2/4 min, nunca después de la cita). 4xx definitivo → failed.
//   - Timeout / conexión cortada DURANTE el envío → unknown: pudo haber llegado; nunca se reenvía.
//   - Palanca de emergencia: BUSINESS_AGENT_REMINDERS_DISABLED=1 detiene el despacho (no se toma ninguno).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import { enviarTexto, MetaGraphApiError } from "@/lib/whatsapp";
import { incrementarUsoMensajes, registrarMensaje, resolverTokenMeta } from "@/lib/whatsapp-outbound";
import { createSupabaseReminderStore, type DueReminder, type ReminderStore } from "@/lib/agent-compiler/actions/native/reminders";

export const REMINDERS_DISABLED_ENV = "BUSINESS_AGENT_REMINDERS_DISABLED";
export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_REMINDER_ATTEMPTS = 3;
export const REMINDER_LEASE_SECONDS = 60;

export type SendOutcome = { kind: "sent" } | { kind: "retryable"; code: string } | { kind: "definitive"; code: string } | { kind: "ambiguous"; code: string };

export interface ReminderDispatchDeps {
  store: ReminderStore;
  /** Último mensaje del CLIENTE en esa conversación (ventana de 24 h). null = no se sabe → no se envía. */
  lastInboundAt(reminder: DueReminder): Promise<Date | null>;
  send(reminder: DueReminder): Promise<SendOutcome>;
  clock?: () => Date;
  env?: Record<string, string | undefined>;
  log?: (event: ReminderDispatchEvent) => void;
}

export interface ReminderDispatchEvent {
  event: "business_agent.reminder";
  tenantId: string;
  reminderId: string;
  outcome: "sent" | "failed" | "unknown" | "retry";
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
}

export async function dispatchDueReminders(deps: ReminderDispatchDeps, opts: { limit?: number } = {}): Promise<DispatchSummary> {
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? (() => new Date());
  const log = deps.log ?? ((e: ReminderDispatchEvent) => console.info("[business-agent.reminder]", JSON.stringify(e)));
  const summary: DispatchSummary = { disabled: false, claimed: 0, sent: 0, failed: 0, retried: 0, unknown: 0 };
  if ((env[REMINDERS_DISABLED_ENV] ?? "").trim() === "1") return { ...summary, disabled: true };

  const due = await deps.store.claimDue(Math.min(100, Math.max(1, opts.limit ?? 50)), REMINDER_LEASE_SECONDS);
  summary.claimed = due.length;
  for (const r of due) {
    const close = async (status: "sent" | "failed" | "unknown" | "retry", code: string | null, retryAt: string | null = null) => {
      await deps.store.complete({ tenantId: r.tenantId, id: r.id, attempts: r.attempts, status, error: code, retryAt });
      log({ event: "business_agent.reminder", tenantId: r.tenantId, reminderId: r.id, outcome: status, code, attempts: r.attempts });
      if (status === "sent") summary.sent++;
      else if (status === "failed") summary.failed++;
      else if (status === "unknown") summary.unknown++;
      else summary.retried++;
    };
    const retryOrFail = (code: string) =>
      r.attempts < MAX_REMINDER_ATTEMPTS ? close("retry", code, new Date(clock().getTime() + 2 ** r.attempts * 60_000).toISOString()) : close("failed", code);
    try {
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
      const out = await deps.send(r);
      if (out.kind === "sent") await close("sent", null);
      else if (out.kind === "ambiguous") await close("unknown", out.code);
      else if (out.kind === "definitive") await close("failed", out.code);
      else await retryOrFail(out.code);
    } catch {
      // Error inesperado tras el claim: el lease vence y el siguiente despacho lo marca unknown (nunca se reenvía).
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Producción: WhatsApp real (mismo envío y registro que el agente) + ventana desde el estado conversacional
// ---------------------------------------------------------------------------


export const REMINDER_SEND_TIMEOUT_MS = 10_000;

export function createProductionReminderDispatchDeps(supabase: SupabaseClient): ReminderDispatchDeps {
  return {
    store: createSupabaseReminderStore(supabase),
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
    async send(r) {
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
        ({ wamid } = await enviarTexto({ phoneNumberId: r.phoneNumberId, token, para: r.telefonoCliente, texto: r.message, signal: controller.signal }));
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
        await registrarMensaje(supabase, r.phoneNumberId, r.telefonoCliente.replace(/\D/g, ""), "saliente", r.message, "ia", wamid ?? undefined);
      } catch {
        // observabilidad best-effort
      }
      return { kind: "sent" };
    },
  };
}
