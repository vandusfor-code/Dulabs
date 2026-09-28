// DuLabs Business — Business Agent 2.0, FASE 4 — persistencia de ejecuciones del Action Engine (contrato).
//
// La garantía de "una sola ejecución efectiva" vive en Postgres (migración 20261124000000: dulabs_ba_action_claim,
// dulabs_ba_action_complete, dulabs_ba_booking_lock_*). Este contrato es lo que el motor necesita; la implementación
// de producción llama a esas funciones por RPC (store-supabase.ts) y la de tests replica su semántica en memoria.

export interface ClaimInput {
  tenantId: string;
  agentId: string;
  conversationId: string;
  action: string;
  contractVersion: string;
  idempotencyKey: string;
  argumentsHash: string;
  leaseSeconds: number;
  /** true = la acción puede re-ejecutarse sin riesgo (lecturas): se retoma tras un lease vencido o un fallo reintentable. */
  retakeable: boolean;
}

export type ClaimOutcome =
  | { kind: "claimed"; executionId: string; attempt: number }
  | { kind: "completed"; executionId: string; attempt: number; status: string; result: unknown }
  | { kind: "in_progress"; executionId: string; attempt: number }
  | { kind: "mismatch"; executionId: string }
  /** Escritura con desenlace desconocido (worker caído o timeout): nunca se re-ejecuta. */
  | { kind: "unknown"; executionId: string; attempt: number; result: unknown };

export type FinalExecutionStatus = "SUCCEEDED" | "FAILED" | "REJECTED" | "TIMED_OUT";

export interface CompleteInput {
  tenantId: string;
  executionId: string;
  attempt: number;
  status: FinalExecutionStatus;
  result: Record<string, unknown>;
  errorCode: string | null;
  retryable: boolean;
}

export interface ActionExecutionStore {
  claim(input: ClaimInput): Promise<ClaimOutcome>;
  /** false = el attempt ya no es el vigente (otro worker lo retomó): el resultado NO se escribe. */
  complete(input: CompleteInput): Promise<boolean>;
  acquireLock(input: { tenantId: string; lockKey: string; holder: string; leaseSeconds: number }): Promise<boolean>;
  releaseLock(input: { tenantId: string; lockKey: string; holder: string }): Promise<void>;
}
