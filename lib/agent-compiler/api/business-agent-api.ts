// DuLabs Business — Agent Compiler, Bloque 12 — Authoring API (núcleo).
//
// Orquestación PURA/inyectable (sin NextRequest/Response, sin tocar Supabase
// directo) entre el frontend de autoservicio y el Registry (Step 8A). Cada
// función es 100% testeable offline con el fake en memoria
// (registry/testing/in-memory-registry-store.ts) -- las rutas HTTP
// (app/api/business-agent/*) son wrappers delgados: auth -> tenantId ->
// llaman acá -> mapean el resultado al envelope {success,data}/{success:false,error}.
//
// FRONTERA DE CONFIANZA (repetida a propósito en cada función que toca el
// Spec crudo del cliente):
//   - tenantId SIEMPRE es un parámetro explícito del caller (derivado del
//     usuario autenticado por requireFlowAccess), NUNCA leído del body.
//   - El cliente solo puede enviar las 8 secciones editables del Spec
//     (identity/personality/capabilities/catalog/policies/handoff/scheduling/
//     knowledge). `schemaVersion` y `metadata` los construye el servidor --
//     si el body los trae, se rechaza explícitamente (nunca se ignoran en
//     silencio, para no confundir al cliente sobre qué se guardó).
//   - `capabilities` son booleanos ancladas a CAPABILITY_BACKING (spec/capabilities.ts):
//     el cliente NUNCA puede nombrar una tool/acción arbitraria, solo
//     encender/apagar capacidades ya conectadas al Runtime real.
//   - El cliente NUNCA envía un FlowDefinition: siempre se deriva vía
//     compileBusinessAgent -> compileIRToFlowDefinition (Steps 5/6/7.1).
//   - detectarInyeccionTenant (spec/validate.ts) ya escanea el Spec ENSAMBLADO
//     completo, en profundidad, contra claves tipo tenant -- defensa en
//     profundidad más allá del guard de nivel superior de este archivo.

import { checksumOf } from "@/lib/agent-compiler/checksum";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { diagError, hasErrors, type CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";
import {
  compileAndCreateDraftVersion,
  publishBusinessAgentVersion,
  type RegistryDeps,
} from "@/lib/agent-compiler/registry/registry";
import type {
  AgentVersionRow,
  AgentVersionSummary,
  FlowRecordStatus,
  ValidationStatus,
} from "@/lib/agent-compiler/registry/types";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { CURRENT_SPEC_SCHEMA_VERSION, type BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";

// ---------------------------------------------------------------------------
// Guardas sobre el body crudo del cliente
// ---------------------------------------------------------------------------

const EDITABLE_SPEC_KEYS = [
  "identity",
  "personality",
  "capabilities",
  "catalog",
  "policies",
  "handoff",
  "scheduling",
  "knowledge",
] as const;

/** Claves que el cliente JAMÁS puede enviar -- gestionadas 100% por el servidor. */
const FORBIDDEN_TOP_LEVEL_KEYS = ["schemaVersion", "metadata", "tenantId", "tenant_id", "id_tenant", "tenant"];

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findForbiddenTopLevelKeys(raw: Record<string, unknown>): string[] {
  return FORBIDDEN_TOP_LEVEL_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(raw, k));
}

/** Solo las 8 secciones editables -- cualquier otra clave del body (flow, nodes, tenantId, etc.) nunca se lee. */
function pickEditableSections(raw: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const k of EDITABLE_SPEC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, k)) picked[k] = raw[k];
  }
  return picked;
}

function buildFullSpec(editable: Record<string, unknown>, meta: { specVersion: number; now: string; authorId?: string }): unknown {
  return {
    schemaVersion: CURRENT_SPEC_SCHEMA_VERSION,
    ...editable,
    metadata: { specVersion: meta.specVersion, status: "draft", createdAt: meta.now, updatedAt: meta.now, authorId: meta.authorId },
  };
}

export type BodyGuardResult = { ok: true; editable: Record<string, unknown> } | { ok: false; diagnostics: CompilerDiagnostic[] };

/** Guard reutilizado por create/update y por validate: forma + campos prohibidos. Nunca compila todavía. */
function guardRawBody(rawBody: unknown): BodyGuardResult {
  if (!isPlainObject(rawBody)) {
    return { ok: false, diagnostics: [diagError("REQUEST_INVALID_BODY", "validation", "El cuerpo de la petición debe ser un objeto JSON.")] };
  }
  const forbidden = findForbiddenTopLevelKeys(rawBody);
  if (forbidden.length > 0) {
    return {
      ok: false,
      diagnostics: [
        diagError(
          "REQUEST_FORBIDDEN_FIELD",
          "validation",
          `Los campos ${forbidden.join(", ")} son gestionados por el servidor y no pueden enviarse desde el cliente.`,
          { path: forbidden.join(",") },
        ),
      ],
    };
  }
  return { ok: true, editable: pickEditableSections(rawBody) };
}

// ---------------------------------------------------------------------------
// Proyección pública (nunca expone gateRules/FlowDefinition -- detalle
// interno del Compiler; el frontend de autoservicio no los necesita).
// ---------------------------------------------------------------------------

export interface AgentVersionPublic {
  flowVersionId: string;
  versionNumber: number;
  validationStatus: ValidationStatus;
  diagnostics: CompilerDiagnostic[];
  spec: BusinessAgentSpec;
  checksums: { spec: string; ir: string; flow: string };
  publishedAt: string | null;
  retiredAt: string | null;
}

function toAgentVersionPublic(row: AgentVersionRow): AgentVersionPublic {
  return {
    flowVersionId: row.flowVersionId,
    versionNumber: row.versionNumber,
    validationStatus: row.validationStatus,
    diagnostics: row.validationReport,
    spec: row.spec,
    checksums: { spec: row.specChecksum, ir: row.irChecksum, flow: row.flowChecksum },
    publishedAt: row.publishedAt,
    retiredAt: row.retiredAt,
  };
}

// ---------------------------------------------------------------------------
// Bloque 12C — validate (sin persistir). Función PURA: no toca el Registry.
// ---------------------------------------------------------------------------

export type ValidateSpecResult =
  | { ok: true; validationStatus: "validated" | "failed"; diagnostics: CompilerDiagnostic[]; checksums: { spec: string; ir: string; flow: string } }
  | { ok: false; reason: "invalid_body" | "compile_failed" | "flow_compile_failed"; diagnostics: CompilerDiagnostic[] };

export function validateDraftSpec(params: { tenantId: string; rawBody: unknown }): ValidateSpecResult {
  const guard = guardRawBody(params.rawBody);
  if (!guard.ok) return { ok: false, reason: "invalid_body", diagnostics: guard.diagnostics };

  // specVersion=1/now fijo: el checksum de validate-only nunca se persiste ni
  // se compara contra una versión real -- solo sirve para que el frontend
  // detecte si su edición actual cambió respecto al último validate que hizo.
  const spec = buildFullSpec(guard.editable, { specVersion: 1, now: "1970-01-01T00:00:00.000Z" });

  const compiled = compileBusinessAgent(spec, { tenantId: params.tenantId });
  if (!compiled.success) return { ok: false, reason: "compile_failed", diagnostics: compiled.diagnostics };

  const flowResult = compileIRToFlowDefinition(compiled.ir, { tenantId: params.tenantId });
  if (!flowResult.success) return { ok: false, reason: "flow_compile_failed", diagnostics: [...compiled.diagnostics, ...flowResult.diagnostics] };

  const publishCheck = validateFlowForPublish(flowResult.flow);
  const validationStatus: "validated" | "failed" = publishCheck.valid ? "validated" : "failed";
  const publishDiagnostics: CompilerDiagnostic[] = publishCheck.valid
    ? []
    : publishCheck.errors.map((e) => diagError(`FLOW_${e.code}`, "ir_generation", e.message, { path: e.path, source: e.nodeId ?? e.edgeId ?? undefined }));

  const diagnostics = [...compiled.diagnostics, ...publishDiagnostics];
  // Invariante explícita (spec §BLOQUE 12C): un error real SIEMPRE gana sobre
  // "parece válido" -- aunque compiled/flowResult ya "success", si hay algún
  // diagnóstico de severidad error/block entre los acumulados, nunca se
  // reporta validationStatus="validated" con warnings silenciados.
  if (validationStatus === "validated" && hasErrors(diagnostics)) {
    return { ok: true, validationStatus: "failed", diagnostics, checksums: { spec: checksumOf(spec), ir: compiled.ir.checksum, flow: flowResult.checksum } };
  }

  return { ok: true, validationStatus, diagnostics, checksums: { spec: checksumOf(spec), ir: compiled.ir.checksum, flow: flowResult.checksum } };
}

// ---------------------------------------------------------------------------
// Bloque 12A/12B — create/update draft (siempre crea una versión NUEVA;
// nunca muta una publicada -- createDraftVersion del Registry ya lo garantiza
// estructuralmente, ver dulabs_business_agent_versions_guard_immutable).
// ---------------------------------------------------------------------------

export type CreateDraftResult =
  | { ok: true; version: AgentVersionPublic }
  | { ok: false; reason: "invalid_body" | "stale_version" | "compile_failed" | "flow_compile_failed" | "store_error"; message: string; diagnostics: CompilerDiagnostic[] };

/**
 * `baseVersionNumber`: la versión desde la que el cliente partió su edición.
 * Control de concurrencia optimista (spec §BLOQUE 12B "stale version"): si ya
 * existe al menos una versión y `baseVersionNumber` no coincide con la más
 * reciente, se rechaza (otra pestaña/usuario ya avanzó) -- nunca se
 * sobrescribe en silencio. Para el primer draft de un tenant (sin versiones
 * previas) el chequeo no aplica.
 */
export async function createOrUpdateDraft(
  deps: RegistryDeps,
  params: { tenantId: string; userId?: string; rawBody: unknown; baseVersionNumber?: number },
): Promise<CreateDraftResult> {
  const guard = guardRawBody(params.rawBody);
  if (!guard.ok) return { ok: false, reason: "invalid_body", message: "El cuerpo de la petición es inválido.", diagnostics: guard.diagnostics };

  const identity = await deps.store.ensureAgentIdentity(params.tenantId, params.userId);
  const versions = await deps.store.listVersions(params.tenantId, identity.flowId);
  const latest = versions[0] ?? null;

  if (latest && params.baseVersionNumber !== latest.versionNumber) {
    const message =
      params.baseVersionNumber === undefined
        ? `Ya existe una versión previa (v${latest.versionNumber}) -- falta 'baseVersionNumber' indicando desde cuál partió esta edición.`
        : `La versión más reciente es v${latest.versionNumber}, pero esta edición partió de v${params.baseVersionNumber}. Alguien más (u otra pestaña) guardó cambios primero -- recarga antes de guardar.`;
    return { ok: false, reason: "stale_version", message, diagnostics: [] };
  }

  const now = new Date().toISOString();
  const nextSpecVersion = (latest?.versionNumber ?? 0) + 1;
  const spec = buildFullSpec(guard.editable, { specVersion: nextSpecVersion, now, authorId: params.userId }) as BusinessAgentSpec;

  const compiled = await compileAndCreateDraftVersion(deps, { tenantId: params.tenantId, spec, createdBy: params.userId });
  if (!compiled.ok) {
    const reason = compiled.reason === "store_error" ? "store_error" : compiled.reason === "flow_compile_failed" ? "flow_compile_failed" : "compile_failed";
    return { ok: false, reason, message: "La configuración no pudo compilarse -- revisa los diagnósticos.", diagnostics: compiled.diagnostics };
  }

  // Se relee la fila recién creada como fuente única de verdad de la
  // respuesta (checksums/spec exactamente como quedaron persistidos), en vez
  // de recomputar en paralelo (evita que la respuesta pueda divergir de lo
  // realmente guardado).
  const row = await deps.store.getVersion(params.tenantId, compiled.flowVersionId);
  if (!row) {
    return { ok: false, reason: "store_error", message: "La versión se creó pero no pudo releerse.", diagnostics: compiled.diagnostics };
  }
  return { ok: true, version: toAgentVersionPublic(row) };
}

// ---------------------------------------------------------------------------
// Bloque 12D — publish. flowId SIEMPRE se deriva de ensureAgentIdentity(tenantId)
// -- el cliente nunca puede apuntar a un flow que no sea el suyo.
// ---------------------------------------------------------------------------

export type PublishResult =
  | { ok: true; flowId: string; flowVersionId: string; publishedAt: string; supersededVersionId: string | null }
  | { ok: false; reason: "not_found" | "not_validated" | "tenant_mismatch" | "checksum_mismatch" | "store_error"; message: string };

export async function publishDraftVersion(
  deps: RegistryDeps,
  params: { tenantId: string; flowVersionId: string; expectedChecksum?: string },
): Promise<PublishResult> {
  const identity = await deps.store.ensureAgentIdentity(params.tenantId);

  if (params.expectedChecksum !== undefined) {
    const version = await deps.store.getVersion(params.tenantId, params.flowVersionId);
    if (!version || version.flowId !== identity.flowId) {
      return { ok: false, reason: "not_found", message: "Versión no encontrada." };
    }
    if (version.flowChecksum !== params.expectedChecksum) {
      return { ok: false, reason: "checksum_mismatch", message: "El checksum enviado no coincide con la versión actual -- la configuración cambió; recarga antes de publicar." };
    }
  }

  const result = await publishBusinessAgentVersion(deps, { tenantId: params.tenantId, flowId: identity.flowId, flowVersionId: params.flowVersionId });
  if (!result.ok) return { ok: false, reason: result.reason, message: safeMessageForPublishReason(result.reason) };
  return { ok: true, flowId: result.flowId, flowVersionId: result.flowVersionId, publishedAt: result.publishedAt, supersededVersionId: result.supersededVersionId };
}

function safeMessageForPublishReason(reason: "not_found" | "not_validated" | "tenant_mismatch" | "store_error"): string {
  switch (reason) {
    case "not_found":
      return "Versión no encontrada.";
    case "not_validated":
      return "Esta versión no pasó la validación de publicación -- corrige los errores antes de publicar.";
    case "tenant_mismatch":
      return "Versión no encontrada."; // mismo criterio que /api/flows/*: no revelar existencia cross-tenant
    case "store_error":
      return "No se pudo publicar la versión.";
  }
}

// ---------------------------------------------------------------------------
// Bloque 12F — rollback. MISMO mecanismo que publish (re-apuntar
// published_version_id a una versión ANTERIOR ya validada) -- sin copiar ni
// recrear nada. Requiere confirmación explícita del cliente (confirm:true).
// ---------------------------------------------------------------------------

export type RollbackResult =
  | { ok: true; flowId: string; flowVersionId: string; publishedAt: string; supersededVersionId: string | null; alreadyPublished: boolean }
  | { ok: false; reason: "confirmation_required" | "not_found" | "not_validated" | "tenant_mismatch" | "store_error"; message: string };

export async function rollbackToVersion(deps: RegistryDeps, params: { tenantId: string; flowVersionId: string; confirm: boolean }): Promise<RollbackResult> {
  if (!params.confirm) {
    return { ok: false, reason: "confirmation_required", message: "El rollback requiere confirmación explícita ('confirm': true)." };
  }
  const identity = await deps.store.ensureAgentIdentity(params.tenantId);
  const alreadyPublished = identity.publishedVersionId === params.flowVersionId;

  const result = await publishBusinessAgentVersion(deps, { tenantId: params.tenantId, flowId: identity.flowId, flowVersionId: params.flowVersionId });
  if (!result.ok) return { ok: false, reason: result.reason, message: safeMessageForPublishReason(result.reason) };
  return { ok: true, flowId: result.flowId, flowVersionId: result.flowVersionId, publishedAt: result.publishedAt, supersededVersionId: result.supersededVersionId, alreadyPublished };
}

// ---------------------------------------------------------------------------
// Bloque 12E — estado actual (draft/published/historial), y detalle de una
// versión puntual. Sin `ok:false`: ensureAgentIdentity siempre crea-si-falta;
// un error real de infraestructura se propaga como excepción (lo captura la
// ruta HTTP -- fail-closed, nunca un 200 con datos inventados).
// ---------------------------------------------------------------------------

export interface AgentSummaryPublic {
  flowId: string;
  status: FlowRecordStatus;
  draft: AgentVersionPublic | null;
  published: AgentVersionPublic | null;
  recentVersions: AgentVersionSummary[];
}

export async function getCurrentAgent(deps: RegistryDeps, params: { tenantId: string; userId?: string }): Promise<AgentSummaryPublic> {
  const identity = await deps.store.ensureAgentIdentity(params.tenantId, params.userId);
  const versions = await deps.store.listVersions(params.tenantId, identity.flowId);
  const latest = versions[0] ?? null;

  const publishedSummary = identity.publishedVersionId ? (versions.find((v) => v.flowVersionId === identity.publishedVersionId) ?? null) : null;
  // "draft" = la versión más reciente, SOLO si es distinta de la publicada
  // (si la más reciente YA es la publicada, no hay nada pendiente de publicar).
  const draftSummary = latest && latest.flowVersionId !== identity.publishedVersionId ? latest : null;

  const [draftRow, publishedRow] = await Promise.all([
    draftSummary ? deps.store.getVersion(params.tenantId, draftSummary.flowVersionId) : Promise.resolve(null),
    publishedSummary ? deps.store.getVersion(params.tenantId, publishedSummary.flowVersionId) : Promise.resolve(null),
  ]);

  return {
    flowId: identity.flowId,
    status: identity.status,
    draft: draftRow ? toAgentVersionPublic(draftRow) : null,
    published: publishedRow ? toAgentVersionPublic(publishedRow) : null,
    recentVersions: versions,
  };
}

export async function listAgentVersions(deps: RegistryDeps, params: { tenantId: string }): Promise<AgentVersionSummary[]> {
  const identity = await deps.store.ensureAgentIdentity(params.tenantId);
  return deps.store.listVersions(params.tenantId, identity.flowId);
}

/** null = no existe o no pertenece a este tenant -- el caller HTTP debe devolver 404 genérico (nunca 403, mismo criterio que /api/flows/*). */
export async function getAgentVersionDetail(deps: RegistryDeps, params: { tenantId: string; flowVersionId: string }): Promise<AgentVersionPublic | null> {
  const identity = await deps.store.ensureAgentIdentity(params.tenantId);
  const row = await deps.store.getVersion(params.tenantId, params.flowVersionId);
  if (!row || row.flowId !== identity.flowId) return null;
  return toAgentVersionPublic(row);
}
