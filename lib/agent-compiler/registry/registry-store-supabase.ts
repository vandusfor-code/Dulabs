// DuLabs Business — Agent Compiler, Step 8A — Registry, adapter Supabase.
//
// Implementación real del puerto BusinessAgentRegistryStore. REUTILIZA sin
// cambios: createFlow/createFlowVersion/publishFlowVersion/getFlowById/
// getFlowVersion (lib/flow/flow-store.ts) — incluida su verificación de
// secretos embebidos y su manejo de errores tipado (FlowStoreError). Solo la
// tabla NUEVA (dulabs_business_agent_versions) y el binding en
// dulabs_clientes_config (columnas ya existentes) se acceden directo.
//
// Tenant isolation: cada query lleva .eq("tenant_id", ...) explícito (defensa
// en profundidad además de RLS); el UPDATE de binding lleva
// .eq("id_tenant", tenantId) en el WHERE — si el número pertenece a OTRO
// tenant, el UPDATE afecta 0 filas (nunca escribe cross-tenant).

import type { SupabaseClient } from "@supabase/supabase-js";
import { createFlow, createFlowVersion, getFlowById, getFlowVersion, listFlowVersions, publishFlowVersion } from "@/lib/flow/flow-store";
import { FlowStoreError, FLOW_STORE_ERROR_CODES } from "@/lib/flow/flow-store-errors";
import type { FlowDefinition } from "@/lib/flow/types";
import type { GateRule } from "@/lib/agent-compiler/runtime/guardrail-gate";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { CompiledBusinessAgentIR } from "@/lib/agent-compiler/ir";
import type { CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";
import {
  BUSINESS_AGENT_SLUG,
  type AgentIdentityRow,
  type AgentVersionRow,
  type AgentVersionSummary,
  type BindResult,
  type BusinessAgentRegistryStore,
  type CreateDraftVersionInput,
  type CreateDraftVersionResult,
  type PublishVersionResult,
  type ValidationStatus,
} from "@/lib/agent-compiler/registry/types";

interface BusinessAgentVersionRowDb {
  tenant_id: string;
  id: string;
  flow_id: string;
  flow_version_id: string;
  spec_json: BusinessAgentSpec;
  spec_checksum: string;
  ir_json: CompiledBusinessAgentIR;
  ir_checksum: string;
  gate_rules_json: GateRule[];
  flow_checksum: string;
  validation_status: ValidationStatus;
  validation_report: CompilerDiagnostic[];
}

export function createSupabaseBusinessAgentRegistryStore(supabase: SupabaseClient): BusinessAgentRegistryStore {
  async function nextVersionNumber(tenantId: string, flowId: string): Promise<number> {
    const { data, error } = await supabase
      .from("dulabs_flow_versions")
      .select("version_number")
      .eq("tenant_id", tenantId)
      .eq("flow_id", flowId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return ((data as { version_number: number } | null)?.version_number ?? 0) + 1;
  }

  async function readArtifacts(tenantId: string, flowVersionId: string): Promise<BusinessAgentVersionRowDb | null> {
    const { data, error } = await supabase
      .from("dulabs_business_agent_versions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("flow_version_id", flowVersionId)
      .maybeSingle();
    if (error) throw error;
    return (data as BusinessAgentVersionRowDb | null) ?? null;
  }

  async function assembleVersionRow(tenantId: string, flowVersionId: string): Promise<AgentVersionRow | null> {
    const [version, artifacts] = await Promise.all([
      getFlowVersion(supabase, tenantId, flowVersionId),
      readArtifacts(tenantId, flowVersionId),
    ]);
    if (!version || !artifacts) return null;
    return {
      tenantId,
      flowId: version.flow_id,
      flowVersionId: version.id,
      versionNumber: version.version_number,
      publishedAt: version.published_at,
      retiredAt: version.retired_at,
      spec: artifacts.spec_json,
      specChecksum: artifacts.spec_checksum,
      ir: artifacts.ir_json,
      irChecksum: artifacts.ir_checksum,
      gateRules: artifacts.gate_rules_json,
      flow: version.definition_json as unknown as FlowDefinition,
      flowChecksum: artifacts.flow_checksum,
      validationStatus: artifacts.validation_status,
      validationReport: artifacts.validation_report,
    };
  }

  return {
    async ensureAgentIdentity(tenantId, createdBy) {
      const { data: existing, error } = await supabase
        .from("dulabs_flows")
        .select("tenant_id, id, status, published_version_id")
        .eq("tenant_id", tenantId)
        .eq("slug", BUSINESS_AGENT_SLUG)
        .maybeSingle();
      if (error) throw error;
      if (existing) {
        const row = existing as { tenant_id: string; id: string; status: AgentIdentityRow["status"]; published_version_id: string | null };
        return { tenantId: row.tenant_id, flowId: row.id, status: row.status, publishedVersionId: row.published_version_id };
      }
      const created = await createFlow(supabase, {
        tenantId,
        slug: BUSINESS_AGENT_SLUG,
        name: "Business Agent",
        description: "Agente compilado por DuLabs Business Agent Compiler.",
        createdBy,
      });
      return { tenantId: created.tenant_id, flowId: created.id, status: created.status, publishedVersionId: created.published_version_id };
    },

    async createDraftVersion(input: CreateDraftVersionInput): Promise<CreateDraftVersionResult> {
      const identity = await this.ensureAgentIdentity(input.tenantId, input.createdBy);
      const versionNumber = await nextVersionNumber(input.tenantId, identity.flowId);

      let version;
      try {
        version = await createFlowVersion(supabase, {
          tenantId: input.tenantId,
          flowId: identity.flowId,
          versionNumber,
          definition: input.flow,
          createdBy: input.createdBy,
          publish: false,
        });
      } catch (err) {
        if (err instanceof FlowStoreError && err.code === FLOW_STORE_ERROR_CODES.EMBEDDED_SECRETS) {
          return { ok: false, reason: "embedded_secrets", detail: err.message };
        }
        return { ok: false, reason: "store_error", detail: err instanceof Error ? err.message : String(err) };
      }

      const { error: insertError } = await supabase.from("dulabs_business_agent_versions").insert({
        tenant_id: input.tenantId,
        flow_id: identity.flowId,
        flow_version_id: version.id,
        spec_json: input.spec,
        spec_checksum: input.specChecksum,
        ir_json: input.ir,
        ir_checksum: input.ir.checksum,
        gate_rules_json: input.gateRules,
        flow_checksum: input.flowChecksum,
        validation_status: input.validationStatus,
        validation_report: input.validationReport,
        compiled_by: input.createdBy ?? null,
      });
      if (insertError) return { ok: false, reason: "store_error", detail: insertError.message };

      return { ok: true, flowId: identity.flowId, flowVersionId: version.id, versionNumber };
    },

    async publishVersion(tenantId, flowId, flowVersionId): Promise<PublishVersionResult> {
      const artifacts = await readArtifacts(tenantId, flowVersionId);
      if (!artifacts) {
        return { ok: false, reason: "not_found", detail: "No existen artefactos de Business Agent para esta versión." };
      }
      if (artifacts.validation_status !== "validated") {
        return { ok: false, reason: "not_validated", detail: `validation_status=${artifacts.validation_status}; no se puede publicar.` };
      }

      const flow = await getFlowById(supabase, tenantId, flowId);
      const previousPublishedVersionId = flow?.published_version_id ?? null;

      try {
        await publishFlowVersion(supabase, tenantId, flowId, flowVersionId);
      } catch (err) {
        if (err instanceof FlowStoreError) {
          if (err.code === FLOW_STORE_ERROR_CODES.PUBLISH_VERSION_NOT_FOUND) return { ok: false, reason: "not_found", detail: err.message };
          if (err.code === FLOW_STORE_ERROR_CODES.PUBLISH_TENANT_MISMATCH) return { ok: false, reason: "tenant_mismatch", detail: err.message };
        }
        return { ok: false, reason: "store_error", detail: err instanceof Error ? err.message : String(err) };
      }

      // Best-effort: marca SUPERSEDED la versión previa (auditoría; no es la
      // fuente de verdad — el trigger de dulabs_flow_versions no protege
      // retired_at). Nunca retira la MISMA versión (publish idempotente).
      if (previousPublishedVersionId && previousPublishedVersionId !== flowVersionId) {
        await supabase
          .from("dulabs_flow_versions")
          .update({ retired_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("id", previousPublishedVersionId)
          .is("retired_at", null);
      }

      const publishedVersion = await getFlowVersion(supabase, tenantId, flowVersionId);
      return {
        ok: true,
        flowId,
        flowVersionId,
        publishedAt: publishedVersion?.published_at ?? new Date().toISOString(),
        supersededVersionId: previousPublishedVersionId !== flowVersionId ? previousPublishedVersionId : null,
      };
    },

    async bindWhatsAppNumber(tenantId, phoneNumberId, flowId): Promise<BindResult> {
      const flow = await getFlowById(supabase, tenantId, flowId);
      if (!flow) return { ok: false, reason: "tenant_mismatch", detail: "El flow no pertenece a este tenant." };
      if (flow.status !== "published" || !flow.published_version_id) {
        return { ok: false, reason: "flow_not_published", detail: `status=${flow.status}` };
      }

      const { data, error } = await supabase
        .from("dulabs_clientes_config")
        .update({ flow_activo: true, flow_id: flowId })
        .eq("phone_number_id", phoneNumberId)
        .eq("id_tenant", tenantId)
        .select("phone_number_id")
        .maybeSingle();
      if (error) return { ok: false, reason: "store_error", detail: error.message };
      if (!data) return { ok: false, reason: "number_not_found", detail: "El número no existe o no pertenece a este tenant." };
      return { ok: true };
    },

    async getVersion(tenantId, flowVersionId) {
      return assembleVersionRow(tenantId, flowVersionId);
    },

    async resolvePublishedVersion(tenantId, flowId) {
      const flow = await getFlowById(supabase, tenantId, flowId);
      if (!flow || flow.status !== "published" || !flow.published_version_id) return null;
      return assembleVersionRow(tenantId, flow.published_version_id);
    },

    async listVersions(tenantId, flowId): Promise<AgentVersionSummary[]> {
      const versions = await listFlowVersions(supabase, { tenantId, flowId });
      if (versions.length === 0) return [];
      const { data, error } = await supabase
        .from("dulabs_business_agent_versions")
        .select("flow_version_id, validation_status")
        .eq("tenant_id", tenantId)
        .in("flow_version_id", versions.map((v) => v.id));
      if (error) throw error;
      const statusByVersionId = new Map(
        (data as { flow_version_id: string; validation_status: ValidationStatus }[]).map((r) => [r.flow_version_id, r.validation_status]),
      );
      // Una dulabs_flow_versions sin fila de artefactos no es un Business Agent
      // (flow hand-built normal) -- no debería ocurrir bajo el flowId del
      // Business Agent (todas sus versiones se crean vía createDraftVersion),
      // pero se filtra explícitamente en vez de asumirlo (nunca inventar status).
      return versions
        .filter((v) => statusByVersionId.has(v.id))
        .map((v) => ({
          flowVersionId: v.id,
          versionNumber: v.version_number,
          publishedAt: v.published_at,
          retiredAt: v.retired_at,
          validationStatus: statusByVersionId.get(v.id)!,
        }));
    },
  };
}
