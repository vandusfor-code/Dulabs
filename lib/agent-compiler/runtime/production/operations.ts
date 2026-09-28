// DuLabs Business — Business Agent 2.0, FASE 9 — operación multi-tenant: límites de uso, costo, correlación e incidentes.
//
// Todo el estado vive en Postgres (migración 20261128000000), nunca en la memoria del proceso: N instancias serverless
// ven los mismos contadores. Reglas:
//   - FALLA ABIERTO: si el store no responde (o la migración no está aplicada) el mensaje se atiende igual. Un límite
//     de protección nunca debe convertirse en una caída; la falla queda en el log y el store se reintenta tras 60 s.
//   - Sin PII: la clave de un contacto es un hash (tenant + teléfono); los incidentes guardan códigos BA-*, nunca texto.
//   - El costo es una ESTIMACIÓN para observabilidad (tokens × tarifa declarada), no facturación.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessAgentTurnTrace } from "@/lib/agent-compiler/runtime/production/turn-trace";
import type { BaErrorClass } from "@/lib/agent-compiler/runtime/production/error-taxonomy";
import type { UnderstandingProvider } from "@/lib/agent-compiler/understanding/provider";

// ---------------------------------------------------------------------------
// Correlación y referencia de soporte
// ---------------------------------------------------------------------------

/** Id de correlación de UN mensaje: determinista (el reintento de Meta del mismo wamid da el mismo id). Sin PII. */
export function correlationIdOf(tenantId: string, messageId: string): string {
  return createHash("sha256").update(`${tenantId}|${messageId}`).digest("hex").slice(0, 24);
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I: se dicta por teléfono sin confusión

/** Referencia corta que el cliente o el negocio le dan a soporte (8 caracteres, derivada de la correlación). */
export function supportRefOf(correlationId: string): string {
  const bytes = createHash("sha256").update(`ref|${correlationId}`).digest();
  let out = "";
  for (let i = 0; i < 8; i++) out += REF_ALPHABET[bytes[i]! % REF_ALPHABET.length];
  return out;
}

// ---------------------------------------------------------------------------
// Límites de uso
// ---------------------------------------------------------------------------

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

/**
 * Límites de PROTECCIÓN (no de plan comercial). Holgados: un cliente real escribe muy por debajo; están para cortar
 * bucles bot↔bot, abuso y tormentas de costo de un tenant sin afectar a los demás.
 */
export const RATE_LIMITS = {
  /** Mensajes de UN contacto a UN número. */
  contact_messages: { limit: 30, windowSeconds: 60 },
  /** Mensajes de todos los contactos de UN tenant. */
  tenant_messages: { limit: 1_000, windowSeconds: 60 },
  /** Llamadas al proveedor de IA de UN tenant. */
  tenant_ai_calls: { limit: 600, windowSeconds: 60 },
  /** Acciones con efecto (reservar, cancelar, mover, guardar, recordar) de UNA conversación. */
  // (Los endpoints del panel ya tienen su límite por tenant y categoría: lib/rate-limit.ts, "costosa" para la IA.)
  conversation_writes: { limit: 10, windowSeconds: 3_600 },
  /** La MISMA respuesta a la MISMA conversación (detección de bucles): 2 normales, la 3.ª rompe el bucle. */
  reply_repeat: { limit: 2, windowSeconds: 900 },
} as const satisfies Record<string, RateLimitRule>;

export type RateScope = keyof typeof RATE_LIMITS;

export interface RateLimiter {
  /** Cuenta un uso. null = no se pudo contar (falla abierto: el llamador sigue). */
  hit(scope: RateScope, key: string): Promise<{ allowed: boolean; hits: number } | null>;
}

export function contactKey(tenantId: string, phoneNumberId: string, telefono: string): string {
  return createHash("sha256").update(`${tenantId}|${phoneNumberId}|${telefono.replace(/\D/g, "")}`).digest("hex").slice(0, 32);
}

const MISSING = new Set(["PGRST202", "42883", "42P01"]);

export function createSupabaseRateLimiter(supabase: SupabaseClient, clock: () => number = Date.now): RateLimiter {
  let unavailableUntil = 0;
  return {
    async hit(scope, key) {
      if (clock() < unavailableUntil) return null;
      const rule = RATE_LIMITS[scope];
      try {
        const { data, error } = await supabase.rpc("dulabs_ba_rate_limit_hit", { p_scope: scope, p_key: key.slice(0, 160), p_window_seconds: rule.windowSeconds, p_limit: rule.limit });
        if (error) {
          if (MISSING.has(error.code ?? "")) unavailableUntil = clock() + 60_000;
          console.warn(`[business-agent.rate_limit] store_unavailable code=${error.code ?? "unknown"}`);
          return null;
        }
        const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; hits: number } | undefined;
        return row ? { allowed: row.allowed === true, hits: Number(row.hits) } : null;
      } catch {
        return null;
      }
    },
  };
}

/** Misma semántica que dulabs_ba_rate_limit_hit (ventana fija). Tests. */
export function createMemoryRateLimiter(clock: () => number = Date.now): RateLimiter & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async hit(scope, key) {
      const rule = RATE_LIMITS[scope];
      const window = Math.floor(clock() / 1000 / rule.windowSeconds);
      const k = `${scope}|${key}|${window}`;
      const hits = (counts.get(k) ?? 0) + 1;
      counts.set(k, hits);
      return { allowed: hits <= rule.limit, hits };
    },
  };
}

/**
 * Límite de llamadas de IA por tenant. Va POR FUERA del circuito de Gemini: el exceso de UN tenant nunca cuenta como
 * falla del proveedor (no abre el circuito compartido para los demás). Excedido → el turno sigue sin IA (fallback sin
 * acciones, igual que ante una caída del proveedor).
 */
export function withTenantAiLimit(provider: UnderstandingProvider, limiter: RateLimiter, tenantId: string): UnderstandingProvider {
  return {
    name: provider.name,
    async understand(request) {
      const r = await limiter.hit("tenant_ai_calls", tenantId);
      if (r && !r.allowed) return { ok: false, category: "EXTERNAL_SERVICE_ERROR", code: "understanding_tenant_rate_limited", retryable: false, reason: "rejected" };
      return provider.understand(request);
    },
  };
}

// ---------------------------------------------------------------------------
// Uso y costo estimado por tenant y día
// ---------------------------------------------------------------------------

export interface UsageDelta {
  turns: number;
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicroUsd: number;
  actions: number;
  actionErrors: number;
  turnErrors: number;
  latencyMs: number;
}

/**
 * Tarifa DECLARADA para estimar (USD por millón de tokens). Configurable por entorno porque cambia con el modelo y el
 * proveedor; el valor por defecto es una referencia para ordenar tenants por consumo, no una factura.
 */
export function tokenRates(env: Record<string, string | undefined> = process.env): { inputPerMTok: number; outputPerMTok: number } {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  return { inputPerMTok: n(env.BUSINESS_AGENT_COST_INPUT_PER_MTOK_USD, 0.3), outputPerMTok: n(env.BUSINESS_AGENT_COST_OUTPUT_PER_MTOK_USD, 2.5) };
}

export function estimateCostMicroUsd(inputTokens: number, outputTokens: number, rates = tokenRates()): number {
  // tokens × USD/MTok = USD × 1e-6 → en micro-USD: tokens × tarifa
  return Math.round(inputTokens * rates.inputPerMTok + outputTokens * rates.outputPerMTok);
}

/** Uso de UN turno del motor conversacional (a partir de su traza; nunca del contenido). */
export function usageFromTurnTrace(trace: BusinessAgentTurnTrace, rates = tokenRates()): UsageDelta {
  const u = trace.understanding;
  const inputTokens = Math.max(0, u?.inputTokens ?? 0);
  const outputTokens = Math.max(0, u?.outputTokens ?? 0);
  const real = trace.actions.filter((a) => !a.action.startsWith("verify:") && a.action !== "reminder_lifecycle");
  return {
    turns: 1,
    aiCalls: u ? Math.max(1, u.attempts ?? 1) : 0,
    inputTokens,
    outputTokens,
    estimatedCostMicroUsd: estimateCostMicroUsd(inputTokens, outputTokens, rates),
    actions: real.length,
    actionErrors: real.filter((a) => a.status !== "SUCCEEDED" && a.status !== "IN_PROGRESS").length,
    turnErrors: trace.errorCode ? 1 : 0,
    latencyMs: Math.max(0, trace.latencyMs.total),
  };
}

export interface UsageRecorder {
  record(tenantId: string, day: string, delta: UsageDelta): Promise<boolean>;
}

export function createSupabaseUsageRecorder(supabase: SupabaseClient): UsageRecorder {
  return {
    async record(tenantId, day, d) {
      try {
        const { error } = await supabase.rpc("dulabs_ba_usage_record", {
          p_tenant: tenantId,
          p_day: day,
          p_turns: d.turns,
          p_ai_calls: d.aiCalls,
          p_input_tokens: d.inputTokens,
          p_output_tokens: d.outputTokens,
          p_cost_micro_usd: d.estimatedCostMicroUsd,
          p_actions: d.actions,
          p_action_errors: d.actionErrors,
          p_turn_errors: d.turnErrors,
          p_latency_ms: d.latencyMs,
        });
        return !error;
      } catch {
        return false;
      }
    },
  };
}

export function createMemoryUsageRecorder(): UsageRecorder & { rows: Map<string, UsageDelta> } {
  const rows = new Map<string, UsageDelta>();
  return {
    rows,
    async record(tenantId, day, d) {
      const k = `${tenantId}|${day}`;
      const prev = rows.get(k);
      rows.set(k, prev ? (Object.fromEntries(Object.entries(prev).map(([f, v]) => [f, v + d[f as keyof UsageDelta]])) as unknown as UsageDelta) : { ...d });
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Incidentes (errores BA-* localizables por referencia de soporte)
// ---------------------------------------------------------------------------

export interface Incident {
  tenantId: string;
  ref: string;
  correlationId: string;
  agentId: string | null;
  publishedVersion: string | null;
  engine: string | null;
  /** BA-<CLASE>-<MOTIVO> */
  code: string;
  errorClass: BaErrorClass;
  dependency: string | null;
  /** Causa legible para soporte (códigos, nunca datos del cliente ni trazas de pila). */
  cause: string | null;
  occurredAt: string;
}

export interface IncidentStore {
  record(incident: Incident): Promise<boolean>;
  find(tenantId: string, query: { ref?: string; limit?: number }): Promise<Incident[]>;
}

const CODE_RE = /^BA-[A-Z]+-[A-Z0-9_]{1,60}$/;

/** Solo lo que un humano de soporte debe ver: la PRIMERA línea (nunca la pila), sin rutas de archivo, acotada. */
export function sanitizeCause(cause: string | null | undefined): string | null {
  if (!cause) return null;
  const firstLine = cause.split(/\r?\n/)[0] ?? "";
  return firstLine.replace(/(\/[\w.-]+){2,}/g, "[path]").replace(/\s+/g, " ").slice(0, 120).trim() || null;
}

export function createSupabaseIncidentStore(supabase: SupabaseClient): IncidentStore {
  return {
    async record(i) {
      if (!CODE_RE.test(i.code)) return false;
      try {
        const { error } = await supabase.from("dulabs_ba_incidents").upsert(
          {
            id_tenant: i.tenantId,
            ref: i.ref,
            correlation_id: i.correlationId,
            agent_id: i.agentId?.slice(0, 64) ?? null,
            published_version: i.publishedVersion?.slice(0, 64) ?? null,
            engine: i.engine,
            code: i.code,
            error_class: i.errorClass,
            dependency: i.dependency,
            cause: sanitizeCause(i.cause),
            occurred_at: i.occurredAt,
          },
          { onConflict: "id_tenant,ref,code", ignoreDuplicates: true },
        );
        return !error;
      } catch {
        return false;
      }
    },
    async find(tenantId, q) {
      let query = supabase
        .from("dulabs_ba_incidents")
        .select("id_tenant, ref, correlation_id, agent_id, published_version, engine, code, error_class, dependency, cause, occurred_at")
        .eq("id_tenant", tenantId)
        .order("occurred_at", { ascending: false })
        .limit(Math.min(50, Math.max(1, q.limit ?? 20)));
      if (q.ref) query = query.eq("ref", q.ref);
      const { data, error } = await query;
      if (error) throw new Error(`incidents_read_failed:${error.code ?? "unknown"}`);
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        tenantId: String(r.id_tenant),
        ref: String(r.ref),
        correlationId: String(r.correlation_id),
        agentId: (r.agent_id as string | null) ?? null,
        publishedVersion: (r.published_version as string | null) ?? null,
        engine: (r.engine as string | null) ?? null,
        code: String(r.code),
        errorClass: String(r.error_class) as BaErrorClass,
        dependency: (r.dependency as string | null) ?? null,
        cause: (r.cause as string | null) ?? null,
        occurredAt: new Date(String(r.occurred_at)).toISOString(),
      }));
    },
  };
}

export function createMemoryIncidentStore(): IncidentStore & { rows: Incident[] } {
  const rows: Incident[] = [];
  return {
    rows,
    async record(i) {
      if (!CODE_RE.test(i.code)) return false;
      if (rows.some((r) => r.tenantId === i.tenantId && r.ref === i.ref && r.code === i.code)) return true;
      rows.push({ ...i, cause: sanitizeCause(i.cause) });
      return true;
    },
    async find(tenantId, q) {
      return rows
        .filter((r) => r.tenantId === tenantId && (!q.ref || r.ref === q.ref))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, q.limit ?? 20);
    },
  };
}

// ---------------------------------------------------------------------------
// Paquete de operación (lo que recibe la frontera del Business Agent)
// ---------------------------------------------------------------------------

export interface BusinessAgentOperations {
  limiter: RateLimiter;
  usage: UsageRecorder;
  incidents: IncidentStore;
  /** Tope de espera de las escrituras de observabilidad (nunca retrasan el turno más que esto). */
  writeBudgetMs?: number;
}

export function createSupabaseOperations(supabase: SupabaseClient): BusinessAgentOperations {
  return { limiter: createSupabaseRateLimiter(supabase), usage: createSupabaseUsageRecorder(supabase), incidents: createSupabaseIncidentStore(supabase) };
}

/** Espera `p` como máximo `ms`; nunca lanza (la observabilidad no rompe el turno). */
export async function bounded<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}
