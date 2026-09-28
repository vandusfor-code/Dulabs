// DuLabs Business — Business Agent 2.0, FASE 5 — publicación y carga del artefacto (independiente del almacenamiento).
//
//   publishBusinessModel: modelo → validación (fail-closed) → compilación con la versión SIGUIENTE → store.publish
//                         (atómico en Postgres: candado + control optimista + modelo/artefacto/puntero en 1 transacción)
//   loadActiveArtifact:   store → verificación de integridad (forma, checksum, tenant/agente) → artefacto congelado.
//                         Un artefacto de otra versión del compilador se RECOMPILA desde su modelo inmutable; si ya no
//                         valida, falla cerrado. Un artefacto corrupto o de otro tenant NUNCA cae a otra fuente.

import { checksumOf } from "@/lib/agent-compiler/checksum";
import { compileBusinessModel } from "@/lib/agent-compiler/business-model/compile";
import { verifyArtifact, type CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import type { ModelError } from "@/lib/agent-compiler/business-model/validate";

export interface StoredArtifactRow {
  publishedVersion: number;
  artifact: unknown;
  artifactChecksum: string;
  model: unknown;
}

export interface BusinessModelStore {
  publish(input: {
    tenantId: string;
    agentId: string;
    expectedVersion: number;
    model: unknown;
    modelChecksum: string;
    artifact: CompiledAgentArtifact;
  }): Promise<{ outcome: "published" | "conflict" | "invalid"; publishedVersion: number | null }>;
  loadActive(tenantId: string, agentId: string): Promise<StoredArtifactRow | null>;
  activate(tenantId: string, agentId: string, version: number): Promise<boolean>;
  /**
   * FASE 6 — versión del registro (flow_version_id) enlazada al artefacto ACTIVO (null = sin enlace). Si el store la
   * implementa, el runtime solo usa el artefacto cuando corresponde a la versión que producción sirve.
   */
  activeFlowVersionLink?(tenantId: string, agentId: string): Promise<string | null>;
}

export const publishedVersionRef = (n: number) => `ubm-v${n}`;

export type PublishResult =
  | { ok: true; publishedVersion: number; artifact: CompiledAgentArtifact }
  | { ok: false; code: "PUBLICATION_REJECTED"; errors: ModelError[] }
  | { ok: false; code: "VERSION_CONFLICT"; currentVersion: number | null }
  | { ok: false; code: "PERSISTENCE_REJECTED" };

/**
 * Publica una versión nueva. `expectedVersion` = versión vigente que vio quien edita (0 si no hay ninguna): si otro
 * publicó entre tanto, VERSION_CONFLICT (no se pisa).
 */
export async function publishBusinessModel(store: BusinessModelStore, input: { tenantId: string; agentId: string; expectedVersion: number; model: unknown }): Promise<PublishResult> {
  const next = input.expectedVersion + 1;
  const compiled = compileBusinessModel(input.model, { tenantId: input.tenantId, agentId: input.agentId, versionRef: publishedVersionRef(next), publishedVersion: next });
  if (!compiled.ok) return compiled;
  const r = await store.publish({ tenantId: input.tenantId, agentId: input.agentId, expectedVersion: input.expectedVersion, model: input.model, modelChecksum: checksumOf(input.model), artifact: compiled.artifact });
  if (r.outcome === "conflict") return { ok: false, code: "VERSION_CONFLICT", currentVersion: r.publishedVersion };
  if (r.outcome !== "published" || r.publishedVersion !== next) return { ok: false, code: "PERSISTENCE_REJECTED" };
  return { ok: true, publishedVersion: next, artifact: compiled.artifact };
}

export type LoadResult =
  | { kind: "none" }
  | { kind: "ok"; artifact: CompiledAgentArtifact; recompiled: boolean; cached: boolean }
  | { kind: "error"; issue: "checksum_mismatch" | "scope_mismatch" | "not_an_artifact" | "recompile_rejected" | "store_unavailable" };

const CACHE_MAX = 200;
const cache = new Map<string, CompiledAgentArtifact>();

function remember(key: string, artifact: CompiledAgentArtifact): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, artifact);
}

/** Artefacto activo de (tenant, agente). El runtime no re-valida el modelo por mensaje: cachea por versión + checksum. */
export async function loadActiveArtifact(store: BusinessModelStore, scope: { tenantId: string; agentId: string }): Promise<LoadResult> {
  let row: StoredArtifactRow | null;
  try {
    row = await store.loadActive(scope.tenantId, scope.agentId);
  } catch {
    return { kind: "error", issue: "store_unavailable" };
  }
  if (!row) return { kind: "none" };
  const key = `${scope.tenantId}:${scope.agentId}:${row.publishedVersion}:${row.artifactChecksum}`;
  const hit = cache.get(key);
  if (hit) return { kind: "ok", artifact: hit, recompiled: false, cached: true };

  const v = verifyArtifact(row.artifact, scope);
  if (v.ok) {
    if (v.artifact.version.publishedVersion !== row.publishedVersion || v.artifact.checksum !== row.artifactChecksum) return { kind: "error", issue: "checksum_mismatch" };
    remember(key, v.artifact);
    return { kind: "ok", artifact: v.artifact, recompiled: false, cached: false };
  }
  if (v.issue === "compiler_mismatch" || v.issue === "schema_mismatch") {
    // Otro compilador: se recompila el MISMO modelo inmutable. Si ya no es publicable, no se sirve (fail-closed).
    const r = compileBusinessModel(row.model, { tenantId: scope.tenantId, agentId: scope.agentId, versionRef: publishedVersionRef(row.publishedVersion), publishedVersion: row.publishedVersion });
    if (!r.ok) return { kind: "error", issue: "recompile_rejected" };
    remember(key, r.artifact);
    return { kind: "ok", artifact: r.artifact, recompiled: true, cached: false };
  }
  return { kind: "error", issue: v.issue };
}

/** Solo tests. */
export function clearArtifactCache(): void {
  cache.clear();
}
