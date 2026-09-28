// DuLabs Business — Business Agent 2.0, FASE 6 — puertos de persistencia del onboarding (sin I/O aquí).
//
// La semántica (revisión optimista del borrador, publicación atómica registro + UBM + enlace) la garantiza Postgres
// (migración 20261126000000); las implementaciones en memoria de los tests la reproducen.

import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import type { PublicationRecord } from "@/lib/agent-compiler/onboarding/status";

export interface StoredDraft {
  draft: unknown;
  revision: number;
  updatedAt: string;
}

export interface OnboardingDraftStore {
  load(tenantId: string, agentId: string): Promise<StoredDraft | null>;
  /** Guarda si la revisión vigente es `expectedRevision` (0 = no existe). Si no, conflict (otra pestaña/sesión). */
  save(input: { tenantId: string; agentId: string; expectedRevision: number; draft: unknown; userId?: string }): Promise<{ outcome: "saved" | "conflict"; revision: number }>;
  lastPublication(tenantId: string, agentId: string): Promise<PublicationRecord | null>;
  /** Última versión del Universal Business Model publicada (0 = ninguna). */
  latestModelVersion(tenantId: string, agentId: string): Promise<number>;
}

export interface PublishOnboardingInput {
  tenantId: string;
  agentId: string;
  flowVersionId: string;
  expectedRevision: number;
  expectedModelVersion: number;
  model: unknown;
  modelChecksum: string;
  artifact: CompiledAgentArtifact;
}

export type PublishOnboardingOutcome = { outcome: "published"; publishedVersion: number } | { outcome: "draft_conflict" | "version_conflict" | "invalid"; publishedVersion: null };

/** Publicación ATÓMICA: versión del registro + modelo + artefacto + versión activa + enlace, todo o nada. */
export interface OnboardingPublisher {
  publish(input: PublishOnboardingInput): Promise<PublishOnboardingOutcome>;
}
