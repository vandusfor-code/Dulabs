// DuLabs Business — Business Agent 2.0, FASE 9 — salud del servicio: LIVENESS vs READINESS.
//
//   liveness   ¿el proceso responde? Sin dependencias, sin datos. Nunca falla por un tercero.
//   readiness  ¿puede atender mensajes reales AHORA? Base de datos, migraciones del Business Agent aplicadas, IA
//              configurada y su circuito, circuitos abiertos por dependencia, latido del despacho de recordatorios,
//              palancas operativas (kill switch / despliegue gradual). Solo códigos y estados: ningún secreto ni dato
//              de clientes.
//
// Estados: ready (todo bien) · degraded (atiende, con algo reducido: p. ej. IA caída → respuestas sin IA, recordatorios
// sin despachar) · not_ready (no puede atender: base caída o migraciones base ausentes).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CircuitRegistry } from "@/lib/agent-compiler/runtime/production/circuits";
import { ENGINE_KILL_SWITCH_ENV, rolloutSummary } from "@/lib/agent-compiler/runtime/production/engine-selection";
import { REMINDER_DISPATCH_JOB, REMINDERS_DISABLED_ENV } from "@/lib/agent-compiler/runtime/production/reminder-dispatcher";

export type CheckStatus = "ok" | "degraded" | "down" | "not_configured";

export interface ReadinessCheck {
  id: string;
  status: CheckStatus;
  /** Código corto para soporte (nunca un mensaje de error crudo). */
  detail?: string;
}

export interface ReadinessReport {
  status: "ready" | "degraded" | "not_ready";
  checks: ReadinessCheck[];
  at: string;
}

export interface ReadinessDeps {
  /** Tablas del Business Agent: true = existe y responde; false = no existe; lanza = base no disponible. */
  tableAvailable(table: string): Promise<boolean>;
  aiConfigured(): boolean;
  circuits: CircuitRegistry;
  /** Último latido de un job (null = nunca corrió). */
  lastHeartbeat(job: string): Promise<{ finishedAt: string; ok: boolean } | null>;
  env?: Record<string, string | undefined>;
  clock?: () => Date;
}

/** Tablas sin las que el motor no atiende (20261123–26, ya en producción) y las de FASE 8/9 (degradan si faltan). */
export const CORE_TABLES = ["dulabs_ba_conversation_states", "dulabs_ba_action_executions", "dulabs_ba_active_artifacts", "dulabs_ba_onboarding_drafts"] as const;
export const HARDENING_TABLES = ["dulabs_ba_reminders", "dulabs_ba_rate_counters", "dulabs_ba_usage_daily", "dulabs_ba_incidents", "dulabs_ba_job_runs"] as const;

/** Un despacho que no late hace más de esto se considera detenido (se programa cada pocos minutos). */
export const HEARTBEAT_STALE_MS = 15 * 60_000;

export function liveness(clock: () => Date = () => new Date()): { status: "alive"; service: "business-agent"; at: string } {
  return { status: "alive", service: "business-agent", at: clock().toISOString() };
}

export async function evaluateReadiness(deps: ReadinessDeps): Promise<ReadinessReport> {
  const env = deps.env ?? process.env;
  const now = (deps.clock ?? (() => new Date()))();
  const checks: ReadinessCheck[] = [];

  // Base de datos + migraciones base.
  let dbUp = true;
  const missingCore: string[] = [];
  for (const t of CORE_TABLES) {
    try {
      if (!(await deps.tableAvailable(t))) missingCore.push(t);
    } catch {
      dbUp = false;
      break;
    }
  }
  checks.push(!dbUp ? { id: "database", status: "down", detail: "DB_UNAVAILABLE" } : missingCore.length ? { id: "database", status: "down", detail: `MISSING:${missingCore.join(",")}` } : { id: "database", status: "ok" });

  // Migraciones de FASE 8/9 (recordatorios, límites, uso, incidentes, latidos).
  if (dbUp) {
    const missing: string[] = [];
    for (const t of HARDENING_TABLES) {
      try {
        if (!(await deps.tableAvailable(t))) missing.push(t);
      } catch {
        missing.push(t);
      }
    }
    checks.push(missing.length ? { id: "hardening_migrations", status: "degraded", detail: `MISSING:${missing.join(",")}` } : { id: "hardening_migrations", status: "ok" });
  }

  // IA (solo presencia de la credencial + estado del circuito del proceso).
  const circuitsOpen = deps.circuits.snapshot(now.getTime());
  const gemini = circuitsOpen.find((c) => c.dependency === "gemini");
  checks.push(!deps.aiConfigured() ? { id: "ai", status: "not_configured", detail: "GEMINI_KEY_MISSING" } : gemini ? { id: "ai", status: "degraded", detail: `CIRCUIT_${gemini.state.toUpperCase()}` } : { id: "ai", status: "ok" });

  // Circuitos por dependencia y tenant (nombres de dependencia + cantidad; nunca ids de clientes).
  const perTenant = circuitsOpen.filter((c) => c.dependency !== "gemini");
  checks.push(perTenant.length ? { id: "circuits", status: "degraded", detail: [...new Set(perTenant.map((c) => c.dependency))].map((d) => `${d}:${perTenant.filter((c) => c.dependency === d).length}`).join(",") } : { id: "circuits", status: "ok" });

  // Despacho de recordatorios.
  if ((env[REMINDERS_DISABLED_ENV] ?? "").trim() === "1") checks.push({ id: "reminders_dispatch", status: "degraded", detail: "DISABLED" });
  else if (dbUp) {
    let beat: { finishedAt: string; ok: boolean } | null = null;
    let readable = true;
    try {
      beat = await deps.lastHeartbeat(REMINDER_DISPATCH_JOB);
    } catch {
      readable = false;
    }
    checks.push(
      !readable
        ? { id: "reminders_dispatch", status: "degraded", detail: "HEARTBEAT_UNREADABLE" }
        : !beat
          ? { id: "reminders_dispatch", status: "not_configured", detail: "NEVER_RAN" }
          : now.getTime() - Date.parse(beat.finishedAt) > HEARTBEAT_STALE_MS
            ? { id: "reminders_dispatch", status: "degraded", detail: "STALE" }
            : !beat.ok
              ? { id: "reminders_dispatch", status: "degraded", detail: "LAST_RUN_FAILED" }
              : { id: "reminders_dispatch", status: "ok" },
    );
  }

  // Palancas operativas (informativas).
  const kill = (env[ENGINE_KILL_SWITCH_ENV] ?? "").trim().toLowerCase();
  checks.push({ id: "kill_switch", status: kill ? "degraded" : "ok", ...(kill ? { detail: kill === "all" ? "ALL" : "TENANTS" } : {}) });
  // FASE 10 — etapa y cuántos tenants admite cada lista (nunca sus ids).
  const r = rolloutSummary(env);
  checks.push({ id: "engine_rollout", status: "ok", detail: `${r.stage.toUpperCase()}${r.percent !== null ? `:${r.percent}` : ""} canary=${r.canaryTenants} pilot=${r.pilotTenants}` });

  const status = checks.some((c) => c.id === "database" && c.status === "down") ? "not_ready" : checks.some((c) => c.status === "degraded" || (c.id === "ai" && c.status === "not_configured")) ? "degraded" : "ready";
  return { status, checks, at: now.toISOString() };
}

export function createSupabaseReadinessDeps(supabase: SupabaseClient, circuits: CircuitRegistry, aiConfigured: () => boolean): ReadinessDeps {
  return {
    async tableAvailable(table) {
      const { error } = await supabase.from(table).select("*", { count: "exact", head: true }).limit(1);
      if (!error) return true;
      if (error.code === "42P01" || error.code === "PGRST205") return false;
      throw new Error(`db_unavailable:${error.code ?? "unknown"}`);
    },
    aiConfigured,
    circuits,
    async lastHeartbeat(job) {
      const { data, error } = await supabase.from("dulabs_ba_job_runs").select("last_finished_at, last_ok").eq("job", job).maybeSingle();
      if (error) throw new Error(`heartbeat_read_failed:${error.code ?? "unknown"}`);
      const row = data as { last_finished_at: string | null; last_ok: boolean | null } | null;
      return row?.last_finished_at ? { finishedAt: new Date(row.last_finished_at).toISOString(), ok: row.last_ok === true } : null;
    },
  };
}
