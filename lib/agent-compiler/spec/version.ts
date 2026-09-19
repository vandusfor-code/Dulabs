// DuLabs Business — Agent Compiler (Fase 1), Step 4.
//
// Versionado del BusinessAgentSpec. Un cambio de configuración NUNCA muta un
// Spec publicado: produce una NUEVA versión (draft) que puede coexistir con la
// publicada, para auditoría. La versión compilada se ligará (Steps posteriores)
// a una versión del Flow Engine existente (dulabs_flow_versions) — este módulo
// solo gestiona el linaje del Spec, sin persistencia.

import { CURRENT_SPEC_SCHEMA_VERSION, type BusinessAgentSpec, type SpecMetadata } from "@/lib/agent-compiler/spec/types";

/** Metadata inicial (v1, draft). */
export function nuevaSpecMetadata(now: string, authorId?: string): SpecMetadata {
  return { specVersion: 1, status: "draft", createdAt: now, updatedAt: now, authorId };
}

type SeccionesEditables = Omit<BusinessAgentSpec, "schemaVersion" | "metadata">;

/**
 * Crea una NUEVA versión del Spec aplicando `patch`. No muta el original
 * (deep clone): incrementa specVersion, vuelve a `draft` y actualiza updatedAt.
 * Así una edición nunca cambia silenciosamente una versión ya publicada.
 */
export function bumpSpec(spec: BusinessAgentSpec, patch: Partial<SeccionesEditables>, now: string): BusinessAgentSpec {
  const base = structuredClone(spec);
  return {
    ...base,
    ...patch,
    schemaVersion: CURRENT_SPEC_SCHEMA_VERSION,
    metadata: {
      ...base.metadata,
      specVersion: base.metadata.specVersion + 1,
      status: "draft",
      updatedAt: now,
      createdAt: base.metadata.createdAt,
    },
  };
}

/** Marca una versión como publicada (nueva copia inmutable; no toca el original). */
export function marcarPublicada(spec: BusinessAgentSpec, now: string): BusinessAgentSpec {
  const base = structuredClone(spec);
  return { ...base, metadata: { ...base.metadata, status: "published", updatedAt: now } };
}

/** Marca una versión como compilada (tras validación+simulación, en Steps posteriores). */
export function marcarCompilada(spec: BusinessAgentSpec, now: string): BusinessAgentSpec {
  const base = structuredClone(spec);
  return { ...base, metadata: { ...base.metadata, status: "compiled", updatedAt: now } };
}
