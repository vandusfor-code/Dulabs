// DuLabs Business — Business Agent 2.0, FASE 5 — store de producción del Universal Business Model (RPC a Postgres).
//
// La atomicidad, la inmutabilidad y la consistencia contenido/columnas viven en la migración 20261125000000; aquí solo
// se llaman las funciones y se valida la forma de la respuesta. Un error de la base se propaga (fail-closed).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessModelStore, StoredArtifactRow } from "@/lib/agent-compiler/business-model/store";

interface PublishRow {
  outcome: string;
  published_version: number | null;
  artifact_id: string | null;
}

interface ActiveRow {
  published_version: number;
  artifact: unknown;
  artifact_checksum: string;
  model: unknown;
}

export function createSupabaseBusinessModelStore(supabase: SupabaseClient): BusinessModelStore {
  return {
    async publish(input) {
      const { data, error } = await supabase.rpc("dulabs_ba_publish_business_model", {
        p_tenant: input.tenantId,
        p_agent: input.agentId,
        p_expected_version: input.expectedVersion,
        p_model: input.model,
        p_model_checksum: input.modelChecksum,
        p_artifact: input.artifact,
        p_artifact_checksum: input.artifact.checksum,
        p_execution_fingerprint: input.artifact.executionFingerprint,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as PublishRow | undefined;
      if (!row || (row.outcome !== "published" && row.outcome !== "conflict" && row.outcome !== "invalid")) throw new Error("business_model_publish_unexpected_response");
      return { outcome: row.outcome, publishedVersion: typeof row.published_version === "number" ? row.published_version : null };
    },

    async loadActive(tenantId, agentId): Promise<StoredArtifactRow | null> {
      const { data, error } = await supabase.rpc("dulabs_ba_active_business_artifact", { p_tenant: tenantId, p_agent: agentId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as ActiveRow | undefined;
      if (!row) return null;
      if (typeof row.published_version !== "number" || typeof row.artifact_checksum !== "string") throw new Error("business_model_active_unexpected_response");
      return { publishedVersion: row.published_version, artifact: row.artifact, artifactChecksum: row.artifact_checksum, model: row.model };
    },

    async activate(tenantId, agentId, version) {
      const { data, error } = await supabase.rpc("dulabs_ba_activate_business_model_version", { p_tenant: tenantId, p_agent: agentId, p_version: version });
      if (error) throw error;
      return data === true;
    },
  };
}
