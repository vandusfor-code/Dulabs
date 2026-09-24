/**
 * TRAZAS PERSISTENTES del agente (Bloque 13) — dulabs_agente_trazas.
 *
 * Cada turno (y cada error de la frontera webhook -> agente) queda guardado para poder
 * diagnosticar después: qué entró, con qué contexto se decidió, qué herramientas se pidieron y
 * qué validó el backend, qué se respondió y qué se envió (con el wamid que cruza con el estado
 * real de entrega de Meta en dulabs_mensajes_log; ver dulabs_agente_diagnosticar).
 *
 * La traza ya viene sin datos personales (contact_ref = hash del wa_id; argumentos resumidos;
 * sin texto del cliente, tokens ni secretos). Aquí además se DEPURA antes de guardar: se
 * descartan claves no esperadas y se acota el tamaño. Guardar nunca frena ni rompe un turno.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTurnTrace } from "@/lib/agente/runtime";

export interface TraceRecord {
  tenantId: string;
  phoneNumberId: string;
  contactRef: string;
  kind: "turn" | "boundary";
  wamid: string | null;
  result: string;
  trace: Record<string, unknown>;
}

export interface TraceSink {
  record(entry: TraceRecord): Promise<void>;
}

/** Claves de una traza de turno que se guardan (lista cerrada: nada inesperado llega a la BD). */
const TURN_KEYS: ReadonlyArray<keyof AgentTurnTrace> = [
  "request_id",
  "turn",
  "provider",
  "model",
  "outcome",
  "rounds",
  "tool_calls",
  "usage",
  "latency_ms",
  "retries",
  "grounding",
  "order_id",
  "images",
  "error_kind",
  "state_saved",
  "sent",
  "reply_to",
  "selection",
  "clarification_needed",
  "stage",
  "delivery",
  "input",
  "context",
  "limits",
  "intent",
  "handoff",
];
const BOUNDARY_KEYS = ["result", "reason", "provider", "turns"] as const;
const MAX_BYTES = 30_000;

/** Solo claves conocidas; si aun así es muy grande, se recortan los argumentos de las herramientas. */
export function sanitizeTurnTrace(t: AgentTurnTrace): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TURN_KEYS) out[k] = t[k];
  if (JSON.stringify(out).length > MAX_BYTES) out.tool_calls = t.tool_calls.slice(0, 20).map(({ name, result, ms }) => ({ name, result, ms }));
  return out;
}

export function turnRecord(t: AgentTurnTrace, phoneNumberId: string): TraceRecord {
  return { tenantId: t.business_id, phoneNumberId, contactRef: t.contact_ref, kind: "turn", wamid: t.wamid, result: t.outcome, trace: sanitizeTurnTrace(t) };
}

export function boundaryRecord(entry: Record<string, unknown>, ctx: { tenantId: string; phoneNumberId: string; contactRef: string; wamid: string | null }): TraceRecord {
  const trace: Record<string, unknown> = {};
  for (const k of BOUNDARY_KEYS) if (entry[k] !== undefined) trace[k] = entry[k];
  return { ...ctx, kind: "boundary", result: String(entry.result ?? "error").slice(0, 40), trace };
}

const MISSING_SCHEMA = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

export function createSupabaseTraceSink(supabase: SupabaseClient): TraceSink {
  return {
    async record(e) {
      try {
        const { error } = await supabase.from("dulabs_agente_trazas").insert({
          id_tenant: e.tenantId,
          phone_number_id: e.phoneNumberId,
          contact_ref: e.contactRef,
          tipo: e.kind,
          wamid: e.wamid,
          resultado: e.result.slice(0, 40),
          traza: e.trace,
        });
        // Sin la migración: las trazas siguen yendo a los logs; no se insiste.
        if (error && !MISSING_SCHEMA.has(error.code ?? "")) console.error(`[agente/trazas] ${error.code ?? "?"}`);
      } catch {
        /* nunca rompe un turno */
      }
    },
  };
}

export function createMemoryTraceSink() {
  const records: TraceRecord[] = [];
  const sink: TraceSink & { records: TraceRecord[] } = {
    records,
    async record(e) {
      records.push(structuredClone(e));
    },
  };
  return sink;
}
