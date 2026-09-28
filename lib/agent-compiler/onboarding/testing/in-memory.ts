// Business Agent 2.0, FASE 6 — dobles en memoria del onboarding con la semántica de la migración 20261126000000:
// revisión optimista del borrador, publicación TODO-O-NADA (registro + modelo + artefacto + versión activa + enlace),
// conflictos por revisión y por versión del modelo. La SQL real se verifica con scripts/verify-ba-onboarding.sh.

import type { BusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/types";
import type { BusinessModelStore, StoredArtifactRow } from "@/lib/agent-compiler/business-model/store";
import type { OnboardingDraftStore, OnboardingPublisher } from "@/lib/agent-compiler/onboarding/store";
import type { PublicationRecord } from "@/lib/agent-compiler/onboarding/status";

interface ModelRow {
  tenantId: string;
  agentId: string;
  version: number;
  model: unknown;
  artifact: Record<string, unknown>;
  checksum: string;
}

export function createOnboardingFakes(registry: BusinessAgentRegistryStore) {
  const drafts = new Map<string, { draft: unknown; revision: number; updatedAt: string }>();
  const models: ModelRow[] = [];
  const active = new Map<string, number>();
  const publications: Array<PublicationRecord & { tenantId: string; agentId: string }> = [];
  const key = (t: string, a: string) => `${t}:${a}`;
  const calls: string[] = [];
  /** Hace fallar el paso del registro (para probar que TODO se revierte). */
  const faults = { failRegistryPublish: false };

  const draftStore: OnboardingDraftStore = {
    async load(tenantId, agentId) {
      calls.push("draft.load");
      const d = drafts.get(key(tenantId, agentId));
      return d ? JSON.parse(JSON.stringify(d)) : null;
    },
    async save(input) {
      calls.push("draft.save");
      const k = key(input.tenantId, input.agentId);
      const cur = drafts.get(k);
      const current = cur?.revision ?? 0;
      if (current !== input.expectedRevision) return { outcome: "conflict", revision: current };
      const revision = current + 1;
      drafts.set(k, { draft: JSON.parse(JSON.stringify(input.draft)), revision, updatedAt: new Date().toISOString() });
      return { outcome: "saved", revision };
    },
    async lastPublication(tenantId, agentId) {
      const rows = publications.filter((p) => p.tenantId === tenantId && p.agentId === agentId).sort((a, b) => b.publishedVersion - a.publishedVersion);
      if (!rows[0]) return null;
      const { tenantId: _t, agentId: _a, ...rest } = rows[0];
      void _t;
      void _a;
      return rest;
    },
    async latestModelVersion(tenantId, agentId) {
      return Math.max(0, ...models.filter((m) => m.tenantId === tenantId && m.agentId === agentId).map((m) => m.version));
    },
  };

  // Como pg_advisory_xact_lock en dulabs_ba_publish_onboarding: una publicación a la vez por (tenant, agente).
  let lock: Promise<unknown> = Promise.resolve();
  const serialized = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(fn, fn);
    lock = run.catch(() => undefined);
    return run;
  };

  const publisher: OnboardingPublisher = {
    publish: (input) => serialized(() => publishLocked(input)),
  };

  async function publishLocked(input: Parameters<OnboardingPublisher["publish"]>[0]): ReturnType<OnboardingPublisher["publish"]> {
    {
      calls.push("publish");
      const k = key(input.tenantId, input.agentId);
      if ((drafts.get(k)?.revision ?? -1) !== input.expectedRevision) return { outcome: "draft_conflict", publishedVersion: null };
      const version = await registry.getVersion(input.tenantId, input.flowVersionId);
      if (!version || version.flowId !== input.agentId || version.validationStatus !== "validated") return { outcome: "invalid", publishedVersion: null };
      const current = await draftStore.latestModelVersion(input.tenantId, input.agentId);
      if (current !== input.expectedModelVersion) return { outcome: "version_conflict", publishedVersion: null };
      const a = input.artifact;
      const next = current + 1;
      if (a.tenantId !== input.tenantId || a.agentId !== input.agentId || a.version.publishedVersion !== next || a.source !== "business_model") return { outcome: "invalid", publishedVersion: null };
      // Todo o nada: si el registro falla, no queda el modelo ni se mueve nada.
      if (faults.failRegistryPublish) throw new Error("FLOW_PUBLISH_VERSION_NOT_FOUND");
      const r = await registry.publishVersion(input.tenantId, input.agentId, input.flowVersionId);
      if (!r.ok) throw new Error(`registry_publish_failed:${r.reason}`);
      models.push({ tenantId: input.tenantId, agentId: input.agentId, version: next, model: JSON.parse(JSON.stringify(input.model)), artifact: JSON.parse(JSON.stringify(a)), checksum: a.checksum });
      active.set(k, next);
      publications.push({ tenantId: input.tenantId, agentId: input.agentId, publishedVersion: next, flowVersionId: input.flowVersionId, draftRevision: input.expectedRevision, publishedAt: new Date().toISOString() });
      return { outcome: "published", publishedVersion: next };
    }
  }

  /** Lectura del modelo publicado, como la usa el runtime (FASE 5) con el enlace de FASE 6. */
  const modelStore: BusinessModelStore = {
    async publish() {
      throw new Error("usar el publisher del onboarding");
    },
    async loadActive(tenantId, agentId): Promise<StoredArtifactRow | null> {
      const v = active.get(key(tenantId, agentId));
      const row = models.find((m) => m.tenantId === tenantId && m.agentId === agentId && m.version === v);
      return row ? JSON.parse(JSON.stringify({ publishedVersion: row.version, artifact: row.artifact, artifactChecksum: row.checksum, model: row.model })) : null;
    },
    async activate(tenantId, agentId, version) {
      if (!models.some((m) => m.tenantId === tenantId && m.agentId === agentId && m.version === version)) return false;
      active.set(key(tenantId, agentId), version);
      return true;
    },
    async activeFlowVersionLink(tenantId, agentId) {
      const v = active.get(key(tenantId, agentId));
      return publications.find((p) => p.tenantId === tenantId && p.agentId === agentId && p.publishedVersion === v)?.flowVersionId ?? null;
    },
  };

  return { drafts: draftStore, publisher, modelStore, rows: { drafts, models, publications, active }, calls, faults };
}
