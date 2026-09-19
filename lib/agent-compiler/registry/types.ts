// DuLabs Business — Agent Compiler, Step 8A — Business Agent Registry.
//
// Puerto (interfaz) del Registry. La lógica de orquestación (store.ts) depende
// de esta abstracción, NO de Supabase directo, para poder probarse sin una
// base real (mismo patrón que lib/agent-compiler/catalog-repository.ts).
//
// Reutiliza sin cambios: dulabs_flows / dulabs_flow_versions (Agent Identity /
// Version), el RPC dulabs_flow_publish_version (publish/rollback atómico), y
// dulabs_clientes_config.flow_activo/.flow_id (WhatsApp binding + activation
// flag). La única persistencia NUEVA es dulabs_business_agent_versions (1:1
// con dulabs_flow_versions): Spec/IR/GateRules/checksums, que viven fuera del
// FlowDefinition por diseño (Fase 7.1).

import type { GateRule } from "@/lib/agent-compiler/runtime/guardrail-gate";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { CompiledBusinessAgentIR } from "@/lib/agent-compiler/ir";
import type { CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";
import type { FlowDefinition } from "@/lib/flow/types";

/** Slug fijo: un tenant tiene UN Business Agent (identidad estable = dulabs_flows). */
export const BUSINESS_AGENT_SLUG = "business-agent";

export type FlowRecordStatus = "draft" | "published" | "archived";
export type ValidationStatus = "pending" | "validated" | "failed";

/** Proyección mínima de dulabs_flows necesaria por el Registry. */
export interface AgentIdentityRow {
  tenantId: string;
  flowId: string;
  status: FlowRecordStatus;
  publishedVersionId: string | null;
}

/** Proyección de dulabs_flow_versions + dulabs_business_agent_versions (join 1:1). */
export interface AgentVersionRow {
  tenantId: string;
  flowId: string;
  flowVersionId: string;
  versionNumber: number;
  publishedAt: string | null;
  retiredAt: string | null;
  spec: BusinessAgentSpec;
  specChecksum: string;
  ir: CompiledBusinessAgentIR;
  irChecksum: string;
  gateRules: GateRule[];
  flow: FlowDefinition;
  flowChecksum: string;
  validationStatus: ValidationStatus;
  validationReport: CompilerDiagnostic[];
}

export interface CreateDraftVersionInput {
  tenantId: string;
  spec: BusinessAgentSpec;
  specChecksum: string;
  ir: CompiledBusinessAgentIR;
  gateRules: GateRule[];
  flow: FlowDefinition;
  flowChecksum: string;
  validationStatus: ValidationStatus;
  validationReport: CompilerDiagnostic[];
  createdBy?: string;
}

export type CreateDraftVersionResult =
  | { ok: true; flowId: string; flowVersionId: string; versionNumber: number }
  | { ok: false; reason: "embedded_secrets" | "store_error"; detail: string };

export type PublishVersionResult =
  | { ok: true; flowId: string; flowVersionId: string; publishedAt: string; supersededVersionId: string | null }
  | { ok: false; reason: "not_found" | "not_validated" | "tenant_mismatch" | "store_error"; detail: string };

export type BindResult =
  | { ok: true }
  | { ok: false; reason: "flow_not_published" | "tenant_mismatch" | "number_not_found" | "store_error"; detail: string };

/**
 * Bloque 12 (Authoring API) — proyección LIGERA de una versión (sin Spec/IR/
 * FlowDefinition completos) para listados/historial (ej. selector de rollback).
 * Para el detalle completo de una versión puntual, usar getVersion.
 */
export interface AgentVersionSummary {
  flowVersionId: string;
  versionNumber: number;
  publishedAt: string | null;
  retiredAt: string | null;
  validationStatus: ValidationStatus;
}

/**
 * Puerto de persistencia del Registry. TODAS las operaciones son
 * tenant-scoped: `tenantId` viene del contexto autenticado del servidor. Cada
 * implementación (Supabase o fake en memoria) debe aplicar el filtro/valor de
 * tenant en cada query — nunca confiar en un tenantId embebido en el payload.
 */
export interface BusinessAgentRegistryStore {
  /** Identidad del agente del tenant (dulabs_flows con slug fijo). Crea si no existe. */
  ensureAgentIdentity(tenantId: string, createdBy?: string): Promise<AgentIdentityRow>;

  /** Crea una nueva versión DRAFT (flow version + artefactos). No publica. */
  createDraftVersion(input: CreateDraftVersionInput): Promise<CreateDraftVersionResult>;

  /** Publica una versión ya validada. Marca la anterior como retirada (best-effort). */
  publishVersion(tenantId: string, flowId: string, flowVersionId: string): Promise<PublishVersionResult>;

  /** Vincula un número de WhatsApp (ya perteneciente al tenant) al agente publicado. */
  bindWhatsAppNumber(tenantId: string, phoneNumberId: string, flowId: string): Promise<BindResult>;

  /** Lee la versión completa (artefactos incluidos) por su id. */
  getVersion(tenantId: string, flowVersionId: string): Promise<AgentVersionRow | null>;

  /**
   * Resuelve, tenant-scoped, la versión PUBLICADA + VALIDADA de un flow.
   * `(tenantId, flowId)` deben provenir YA de una fuente confiable del
   * servidor (ej. dulabs_clientes_config.id_tenant/.flow_id, leído por el
   * caller antes de invocar esto — el Registry nunca vuelve a confiar en un
   * tenantId de otro origen). `null` si el flow no está publicado o si la
   * versión publicada no tiene artefactos de Business Agent (flow hand-built
   * normal, sin Gate — el caller debe seguir por el Flow Engine genérico).
   */
  resolvePublishedVersion(tenantId: string, flowId: string): Promise<AgentVersionRow | null>;

  /**
   * Bloque 12 (Authoring API) — historial de versiones (más reciente primero),
   * proyección ligera (sin Spec/IR/FlowDefinition). tenant-scoped.
   */
  listVersions(tenantId: string, flowId: string): Promise<AgentVersionSummary[]>;
}
