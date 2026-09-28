// Business Agent 2.0, FASE 4 — store en memoria con la MISMA semántica que las funciones de Postgres
// (dulabs_ba_action_claim / _complete / _booking_lock_*). Para tests del motor; la garantía real se verifica contra
// PostgreSQL con scripts/verify-ba-action-engine.sh.

import type { ActionExecutionStore, ClaimOutcome, FinalExecutionStatus } from "@/lib/agent-compiler/actions/store";

interface Row {
  id: string;
  tenantId: string;
  agentId: string;
  conversationId: string;
  action: string;
  argumentsHash: string;
  status: "RUNNING" | FinalExecutionStatus;
  attempt: number;
  retryable: boolean;
  leaseUntil: number | null;
  result: unknown;
  errorCode: string | null;
}

export interface InMemoryActionStore extends ActionExecutionStore {
  rows: Map<string, Row>;
  locks: Map<string, { holder: string; leaseUntil: number }>;
  setNow(ms: number): void;
}

export function createInMemoryActionStore(): InMemoryActionStore {
  let now = Date.parse("2026-09-26T15:00:00Z");
  let seq = 0;
  const rows = new Map<string, Row>();
  const locks = new Map<string, { holder: string; leaseUntil: number }>();
  const k = (tenant: string, key: string) => `${tenant}|${key}`;

  const store: InMemoryActionStore = {
    rows,
    locks,
    setNow(ms) {
      now = ms;
    },
    async claim(input): Promise<ClaimOutcome> {
      const key = k(input.tenantId, input.idempotencyKey);
      const r = rows.get(key);
      if (!r) {
        const id = `exec-${++seq}`;
        rows.set(key, { id, tenantId: input.tenantId, agentId: input.agentId, conversationId: input.conversationId, action: input.action, argumentsHash: input.argumentsHash, status: "RUNNING", attempt: 1, retryable: false, leaseUntil: now + input.leaseSeconds * 1000, result: null, errorCode: null });
        return { kind: "claimed", executionId: id, attempt: 1 };
      }
      if (r.argumentsHash !== input.argumentsHash || r.action !== input.action || r.agentId !== input.agentId || r.conversationId !== input.conversationId) {
        return { kind: "mismatch", executionId: r.id };
      }
      if (r.status === "SUCCEEDED" || r.status === "REJECTED" || (r.status === "FAILED" && !(input.retakeable && r.retryable))) {
        return { kind: "completed", executionId: r.id, attempt: r.attempt, status: r.status, result: r.result };
      }
      if (r.status === "RUNNING" && (r.leaseUntil ?? 0) > now) return { kind: "in_progress", executionId: r.id, attempt: r.attempt };
      if (input.retakeable && r.attempt < 10) {
        Object.assign(r, { status: "RUNNING", attempt: r.attempt + 1, leaseUntil: now + input.leaseSeconds * 1000, result: null, errorCode: null, retryable: false });
        return { kind: "claimed", executionId: r.id, attempt: r.attempt };
      }
      if (r.status === "RUNNING") Object.assign(r, { status: "TIMED_OUT", errorCode: "OUTCOME_UNKNOWN", leaseUntil: null });
      return { kind: "unknown", executionId: r.id, attempt: r.attempt, result: r.result };
    },
    async complete(input) {
      const r = [...rows.values()].find((x) => x.id === input.executionId && x.tenantId === input.tenantId);
      if (!r || r.status !== "RUNNING" || r.attempt !== input.attempt) return false;
      Object.assign(r, { status: input.status, result: input.result, errorCode: input.errorCode, retryable: input.retryable, leaseUntil: null });
      return true;
    },
    async acquireLock(input) {
      const key = k(input.tenantId, input.lockKey);
      const l = locks.get(key);
      if (l && l.leaseUntil >= now && l.holder !== input.holder) return false;
      locks.set(key, { holder: input.holder, leaseUntil: now + input.leaseSeconds * 1000 });
      return true;
    },
    async releaseLock(input) {
      const key = k(input.tenantId, input.lockKey);
      if (locks.get(key)?.holder === input.holder) locks.delete(key);
    },
  };
  return store;
}
