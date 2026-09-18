// DuLabs Business — Agent Compiler, Step 8A — fake en memoria del Registry.
//
// Implementa BusinessAgentRegistryStore SIN Supabase, para tests 100% offline
// (mismo patrón que lib/agent-compiler/catalog-repository.ts / Step 3).
// Reproduce las invariantes REALES del store Supabase (tenant scoping, 1:1
// versión-artefactos, publish fail-closed si no está validado, idempotencia)
// pero NO reproduce el row-lock transaccional de Postgres (`for update` del
// RPC dulabs_flow_publish_version) -- ese es el ÚNICO comportamiento que debe
// verificarse contra la infraestructura real, no aquí.

import { randomUUID } from "node:crypto";
import type {
  AgentIdentityRow,
  AgentVersionRow,
  BindResult,
  BusinessAgentRegistryStore,
  CreateDraftVersionInput,
  CreateDraftVersionResult,
  FlowRecordStatus,
  PublishVersionResult,
} from "@/lib/agent-compiler/registry/types";
import { BUSINESS_AGENT_SLUG } from "@/lib/agent-compiler/registry/types";

interface FlowRecord {
  tenantId: string;
  id: string;
  slug: string;
  status: FlowRecordStatus;
  publishedVersionId: string | null;
}

interface VersionRecord {
  tenantId: string;
  flowId: string;
  id: string;
  versionNumber: number;
  publishedAt: string | null;
  retiredAt: string | null;
}

interface ClienteBindingRecord {
  tenantId: string;
  flowActivo: boolean;
  flowId: string | null;
}

export interface InMemoryRegistryFixtures {
  /** Simula dulabs_clientes_config: phoneNumberId -> {tenantId, ...}. Pre-poblar para tests de binding/resolución. */
  clientes: Map<string, ClienteBindingRecord>;
}

export function createInMemoryBusinessAgentRegistryStore(fixtures?: Partial<InMemoryRegistryFixtures>): BusinessAgentRegistryStore & {
  /** Solo test: inspección directa del estado interno. */
  _debug: { flows: FlowRecord[]; versions: VersionRecord[] };
} {
  const flows = new Map<string, FlowRecord>(); // key: tenantId|id
  const flowsBySlug = new Map<string, FlowRecord>(); // key: tenantId|slug
  const versions = new Map<string, VersionRecord>(); // key: tenantId|id
  const artifacts = new Map<string, CreateDraftVersionInput & { flowId: string; flowVersionId: string }>(); // key: tenantId|flowVersionId
  const clientes = fixtures?.clientes ?? new Map<string, ClienteBindingRecord>();

  function flowKey(tenantId: string, id: string) {
    return `${tenantId}|${id}`;
  }

  return {
    _debug: {
      get flows() {
        return [...flows.values()];
      },
      get versions() {
        return [...versions.values()];
      },
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma fija por el puerto; el fake no audita autor.
    async ensureAgentIdentity(tenantId, createdBy): Promise<AgentIdentityRow> {
      const slugKey = flowKey(tenantId, BUSINESS_AGENT_SLUG);
      const existing = flowsBySlug.get(slugKey);
      if (existing) {
        return { tenantId, flowId: existing.id, status: existing.status, publishedVersionId: existing.publishedVersionId };
      }
      const id = randomUUID();
      const record: FlowRecord = { tenantId, id, slug: BUSINESS_AGENT_SLUG, status: "draft", publishedVersionId: null };
      flows.set(flowKey(tenantId, id), record);
      flowsBySlug.set(slugKey, record);
      return { tenantId, flowId: id, status: "draft", publishedVersionId: null };
    },

    async createDraftVersion(input: CreateDraftVersionInput): Promise<CreateDraftVersionResult> {
      const identity = await this.ensureAgentIdentity(input.tenantId, input.createdBy);
      const existingVersions = [...versions.values()].filter((v) => v.tenantId === input.tenantId && v.flowId === identity.flowId);
      const versionNumber = existingVersions.length > 0 ? Math.max(...existingVersions.map((v) => v.versionNumber)) + 1 : 1;
      const versionId = randomUUID();

      versions.set(flowKey(input.tenantId, versionId), {
        tenantId: input.tenantId,
        flowId: identity.flowId,
        id: versionId,
        versionNumber,
        publishedAt: null,
        retiredAt: null,
      });
      artifacts.set(flowKey(input.tenantId, versionId), { ...input, flowId: identity.flowId, flowVersionId: versionId });

      return { ok: true, flowId: identity.flowId, flowVersionId: versionId, versionNumber };
    },

    async publishVersion(tenantId, flowId, flowVersionId): Promise<PublishVersionResult> {
      const art = artifacts.get(flowKey(tenantId, flowVersionId));
      if (!art) return { ok: false, reason: "not_found", detail: "Sin artefactos de Business Agent para esta versión." };
      if (art.flowId !== flowId) return { ok: false, reason: "tenant_mismatch", detail: "La versión no pertenece a este flow." };
      if (art.validationStatus !== "validated") {
        return { ok: false, reason: "not_validated", detail: `validation_status=${art.validationStatus}` };
      }

      const flow = flows.get(flowKey(tenantId, flowId));
      if (!flow) return { ok: false, reason: "not_found", detail: "Flow no encontrado." };

      const version = versions.get(flowKey(tenantId, flowVersionId))!;
      const previousPublishedVersionId = flow.publishedVersionId;
      const now = new Date().toISOString();

      if (version.publishedAt === null) version.publishedAt = now;
      flow.status = "published";
      flow.publishedVersionId = flowVersionId;

      if (previousPublishedVersionId && previousPublishedVersionId !== flowVersionId) {
        const prev = versions.get(flowKey(tenantId, previousPublishedVersionId));
        if (prev && prev.retiredAt === null) prev.retiredAt = now;
      }

      return {
        ok: true,
        flowId,
        flowVersionId,
        publishedAt: version.publishedAt,
        supersededVersionId: previousPublishedVersionId !== flowVersionId ? previousPublishedVersionId : null,
      };
    },

    async bindWhatsAppNumber(tenantId, phoneNumberId, flowId): Promise<BindResult> {
      const flow = flows.get(flowKey(tenantId, flowId));
      if (!flow) return { ok: false, reason: "tenant_mismatch", detail: "El flow no pertenece a este tenant." };
      if (flow.status !== "published" || !flow.publishedVersionId) {
        return { ok: false, reason: "flow_not_published", detail: `status=${flow.status}` };
      }
      const cliente = clientes.get(phoneNumberId);
      if (!cliente || cliente.tenantId !== tenantId) {
        return { ok: false, reason: "number_not_found", detail: "Número inexistente o de otro tenant." };
      }
      cliente.flowActivo = true;
      cliente.flowId = flowId;
      return { ok: true };
    },

    async getVersion(tenantId, flowVersionId): Promise<AgentVersionRow | null> {
      const version = versions.get(flowKey(tenantId, flowVersionId));
      const art = artifacts.get(flowKey(tenantId, flowVersionId));
      if (!version || !art) return null;
      return {
        tenantId,
        flowId: version.flowId,
        flowVersionId: version.id,
        versionNumber: version.versionNumber,
        publishedAt: version.publishedAt,
        retiredAt: version.retiredAt,
        spec: art.spec,
        specChecksum: art.specChecksum,
        ir: art.ir,
        irChecksum: art.ir.checksum,
        gateRules: art.gateRules,
        flow: art.flow,
        flowChecksum: art.flowChecksum,
        validationStatus: art.validationStatus,
        validationReport: art.validationReport,
      };
    },

    async resolvePublishedVersion(tenantId, flowId): Promise<AgentVersionRow | null> {
      const flow = flows.get(flowKey(tenantId, flowId));
      if (!flow || flow.status !== "published" || !flow.publishedVersionId) return null;
      return this.getVersion(tenantId, flow.publishedVersionId);
    },
  };
}
