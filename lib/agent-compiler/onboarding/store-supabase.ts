// DuLabs Business — Business Agent 2.0, FASE 6 — persistencia de producción del onboarding (RPC a Postgres).
//
// Toda la garantía (revisión optimista, publicación atómica registro + modelo + enlace) está en la migración
// 20261126000000; aquí solo se llaman las funciones y se valida la forma de la respuesta. Un error se propaga.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnboardingDraftStore, OnboardingPublisher, StoredDraft } from "@/lib/agent-compiler/onboarding/store";
import type { PublicationRecord } from "@/lib/agent-compiler/onboarding/status";

const first = <T>(data: unknown): T | undefined => (Array.isArray(data) ? (data[0] as T | undefined) : (data as T | undefined) ?? undefined);

export function createSupabaseOnboardingDraftStore(supabase: SupabaseClient): OnboardingDraftStore {
  return {
    async load(tenantId, agentId): Promise<StoredDraft | null> {
      const { data, error } = await supabase
        .from("dulabs_ba_onboarding_drafts")
        .select("draft, revision, updated_at")
        .eq("id_tenant", tenantId)
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as { draft: unknown; revision: number; updated_at: string };
      return { draft: row.draft, revision: row.revision, updatedAt: row.updated_at };
    },

    async save(input) {
      const { data, error } = await supabase.rpc("dulabs_ba_save_onboarding_draft", {
        p_tenant: input.tenantId,
        p_agent: input.agentId,
        p_expected_revision: input.expectedRevision,
        p_draft: input.draft,
        p_user: input.userId ?? null,
      });
      if (error) throw error;
      const row = first<{ outcome: string; revision: number }>(data);
      if (!row || (row.outcome !== "saved" && row.outcome !== "conflict") || typeof row.revision !== "number") throw new Error("onboarding_save_unexpected_response");
      return { outcome: row.outcome, revision: row.revision };
    },

    async lastPublication(tenantId, agentId): Promise<PublicationRecord | null> {
      const { data, error } = await supabase.rpc("dulabs_ba_onboarding_last_publication", { p_tenant: tenantId, p_agent: agentId });
      if (error) throw error;
      const row = first<{ published_version: number; flow_version_id: string; draft_revision: number; published_at: string }>(data);
      if (!row) return null;
      return { publishedVersion: row.published_version, flowVersionId: row.flow_version_id, draftRevision: row.draft_revision, publishedAt: row.published_at };
    },

    async latestModelVersion(tenantId, agentId) {
      const { data, error } = await supabase.rpc("dulabs_ba_latest_model_version", { p_tenant: tenantId, p_agent: agentId });
      if (error) throw error;
      if (typeof data !== "number") throw new Error("onboarding_latest_version_unexpected_response");
      return data;
    },
  };
}

export function createSupabaseOnboardingPublisher(supabase: SupabaseClient): OnboardingPublisher {
  return {
    async publish(input) {
      const { data, error } = await supabase.rpc("dulabs_ba_publish_onboarding", {
        p_tenant: input.tenantId,
        p_agent: input.agentId,
        p_flow_version_id: input.flowVersionId,
        p_expected_revision: input.expectedRevision,
        p_expected_version: input.expectedModelVersion,
        p_model: input.model,
        p_model_checksum: input.modelChecksum,
        p_artifact: input.artifact,
        p_artifact_checksum: input.artifact.checksum,
        p_execution_fingerprint: input.artifact.executionFingerprint,
      });
      if (error) throw error;
      const row = first<{ outcome: string; published_version: number | null }>(data);
      if (row?.outcome === "published" && typeof row.published_version === "number") return { outcome: "published", publishedVersion: row.published_version };
      if (row?.outcome === "draft_conflict" || row?.outcome === "version_conflict" || row?.outcome === "invalid") return { outcome: row.outcome, publishedVersion: null };
      throw new Error("onboarding_publish_unexpected_response");
    },
  };
}
