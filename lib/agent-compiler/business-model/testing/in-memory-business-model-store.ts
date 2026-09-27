// Business Agent 2.0, FASE 5 — store en memoria con la semántica de la migración 20261125000000 (control optimista,
// versión = max + 1, contenido consistente con tenant/agente/versión, lecturas como copia del jsonb). La SQL real se
// verifica con scripts/verify-ba-business-models.sh.

import type { BusinessModelStore, StoredArtifactRow } from "@/lib/agent-compiler/business-model/store";

export function memoryStore() {
  const rows: Array<StoredArtifactRow & { tenantId: string; agentId: string }> = [];
  const active = new Map<string, number>();
  const calls: string[] = [];
  const store: BusinessModelStore = {
    async publish(input) {
      calls.push("publish");
      const current = Math.max(0, ...rows.filter((r) => r.tenantId === input.tenantId && r.agentId === input.agentId).map((r) => r.publishedVersion));
      if (current !== input.expectedVersion) return { outcome: "conflict", publishedVersion: current };
      const a = input.artifact;
      if (a.tenantId !== input.tenantId || a.agentId !== input.agentId || a.version.publishedVersion !== current + 1 || a.source !== "business_model") return { outcome: "invalid", publishedVersion: null };
      rows.push({ tenantId: input.tenantId, agentId: input.agentId, publishedVersion: current + 1, artifact: JSON.parse(JSON.stringify(a)), artifactChecksum: a.checksum, model: JSON.parse(JSON.stringify(input.model)) });
      active.set(`${input.tenantId}:${input.agentId}`, current + 1);
      return { outcome: "published", publishedVersion: current + 1 };
    },
    async loadActive(tenantId, agentId) {
      calls.push("load");
      const v = active.get(`${tenantId}:${agentId}`);
      const row = rows.find((r) => r.tenantId === tenantId && r.agentId === agentId && r.publishedVersion === v);
      // Como la base: cada lectura es una copia nueva del jsonb.
      return row ? JSON.parse(JSON.stringify({ publishedVersion: row.publishedVersion, artifact: row.artifact, artifactChecksum: row.artifactChecksum, model: row.model })) : null;
    },
    async activate(tenantId, agentId, version) {
      if (!rows.some((r) => r.tenantId === tenantId && r.agentId === agentId && r.publishedVersion === version)) return false;
      active.set(`${tenantId}:${agentId}`, version);
      return true;
    },
  };
  return { store, rows, calls };
}
