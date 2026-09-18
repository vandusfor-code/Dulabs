// DuLabs Business — Agent Compiler, Step 8A — Business Agent Registry (lógica).
//
// Orquestación PURA sobre el puerto BusinessAgentRegistryStore (inyección de
// dependencias): compone las operaciones de alto nivel (compilar->draft,
// publicar, vincular número, resolver) sin depender de Supabase directo. La
// lógica de negocio/invariantes vive aquí; el I/O vive en el adapter.
//
// Invariantes que este módulo GARANTIZA (independientes del adapter):
//   - Nunca se publica una versión con validationStatus !== "validated"
//     (fail-closed: sin excepción, sin override).
//   - tenantId siempre es un parámetro explícito del caller (nunca se lee de
//     spec/ir/flow) — ver createDraftVersion.

import type {
  AgentVersionRow,
  BindResult,
  BusinessAgentRegistryStore,
  CreateDraftVersionResult,
  PublishVersionResult,
} from "@/lib/agent-compiler/registry/types";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { buildGateRules } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { checksumOf } from "@/lib/agent-compiler/checksum";
import type { CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";

export interface RegistryDeps {
  store: BusinessAgentRegistryStore;
}

export type CompileAndDraftResult =
  | { ok: true; flowId: string; flowVersionId: string; versionNumber: number; validationStatus: "validated" | "failed"; diagnostics: CompilerDiagnostic[] }
  | { ok: false; reason: "compile_failed" | "flow_compile_failed" | "store_error"; diagnostics: CompilerDiagnostic[] };

/**
 * Pipeline completo: Spec (ya validado) -> IR -> FlowDefinition -> persistir
 * como versión DRAFT. Si compile o flow-compile fallan, NO se persiste nada
 * (mismo comportamiento que Steps 5/6: sin best-effort). Si el FlowDefinition
 * es válido pero NO cumple las reglas de publicación (validateFlowForPublish
 * — ej. falta camino a end), la versión SÍ se persiste (queda como Draft
 * inspeccionable/corregible) pero con validationStatus="failed", lo que
 * bloquea publishVersion.
 */
export async function compileAndCreateDraftVersion(
  deps: RegistryDeps,
  params: { tenantId: string; spec: BusinessAgentSpec; createdBy?: string },
): Promise<CompileAndDraftResult> {
  const compiled = compileBusinessAgent(params.spec, { tenantId: params.tenantId });
  if (!compiled.success) return { ok: false, reason: "compile_failed", diagnostics: compiled.diagnostics };

  // tenantId SIEMPRE del parámetro explícito del caller, nunca de la IR
  // (defensa en profundidad: aunque la IR ya lleve tenantId del compiler
  // Step 5, el Registry no confía en ese campo para su propio scoping).
  if (compiled.ir.tenantId !== params.tenantId) {
    return {
      ok: false,
      reason: "compile_failed",
      diagnostics: [{ code: "TENANT_MISMATCH", severity: "error", phase: "ir_generation", message: "El tenant de la IR no coincide con el tenant del Registry." }],
    };
  }

  const flowResult = compileIRToFlowDefinition(compiled.ir, { tenantId: params.tenantId });
  if (!flowResult.success) return { ok: false, reason: "flow_compile_failed", diagnostics: flowResult.diagnostics };

  const gateRules = buildGateRules(compiled.ir);
  const publishCheck = validateFlowForPublish(flowResult.flow);
  const validationStatus = publishCheck.valid ? "validated" : "failed";
  const validationReport: CompilerDiagnostic[] = publishCheck.valid
    ? []
    : publishCheck.errors.map((e) => ({ code: `FLOW_${e.code}`, severity: "error", phase: "ir_generation", message: e.message, path: e.path, source: e.nodeId ?? e.edgeId }));

  const created: CreateDraftVersionResult = await deps.store.createDraftVersion({
    tenantId: params.tenantId,
    spec: params.spec,
    specChecksum: checksumOf(params.spec),
    ir: compiled.ir,
    gateRules,
    flow: flowResult.flow,
    flowChecksum: flowResult.checksum,
    validationStatus,
    validationReport,
    createdBy: params.createdBy,
  });

  if (!created.ok) {
    return {
      ok: false,
      reason: "store_error",
      diagnostics: [{ code: "REGISTRY_STORE_ERROR", severity: "error", phase: "ir_generation", message: created.detail }],
    };
  }

  return {
    ok: true,
    flowId: created.flowId,
    flowVersionId: created.flowVersionId,
    versionNumber: created.versionNumber,
    validationStatus,
    diagnostics: validationReport,
  };
}

/** Publica una versión. Fail-closed: nunca publica algo no validado (el store lo re-verifica también). */
export async function publishBusinessAgentVersion(
  deps: RegistryDeps,
  params: { tenantId: string; flowId: string; flowVersionId: string },
): Promise<PublishVersionResult> {
  return deps.store.publishVersion(params.tenantId, params.flowId, params.flowVersionId);
}

/** Vincula un número de WhatsApp al agente publicado del tenant. */
export async function bindWhatsAppNumberToBusinessAgent(
  deps: RegistryDeps,
  params: { tenantId: string; phoneNumberId: string; flowId: string },
): Promise<BindResult> {
  return deps.store.bindWhatsAppNumber(params.tenantId, params.phoneNumberId, params.flowId);
}

/** Resuelve la versión activa (publicada+validada) de un flow, tenant-scoped. */
export async function resolvePublishedBusinessAgentVersion(
  deps: RegistryDeps,
  params: { tenantId: string; flowId: string },
): Promise<AgentVersionRow | null> {
  return deps.store.resolvePublishedVersion(params.tenantId, params.flowId);
}
