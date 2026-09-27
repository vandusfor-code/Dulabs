// DuLabs Business — Business Agent 2.0, FASE 5 — artefacto publicado (Compiled Agent Artifact).
//
// Lo ÚNICO que consume el runtime conversacional: la state machine (requisitos, preguntas, contexto de entendimiento)
// y el Action Engine (acciones habilitadas y su configuración por paso, agenda, servicios). Inmutable (congelado en
// memoria; append-only en Postgres) y verificable (checksum SHA-256 canónico). El runtime no revalida el modelo por
// mensaje: el artefacto ya es el resultado validado.

import { checksumOf } from "@/lib/agent-compiler/checksum";
import type { AgentRequirements } from "@/lib/agent-compiler/conversation/requirements";
import type { SlotDefinition } from "@/lib/agent-compiler/understanding/slots";
import type { UbmCapabilityId } from "@/lib/agent-compiler/business-model/capabilities";
import type { BusinessHours } from "@/lib/agent-compiler/spec/types";
import type { LegacyNoteCode } from "@/lib/agent-compiler/business-model/legacy-adapter";
import type { BusinessContextInput } from "@/lib/agent-compiler/understanding/context";

export const ARTIFACT_SCHEMA_VERSION = "business-agent.artifact/1.0.0" as const;
/** Versión del compilador UBM → artefacto. Un artefacto de otra versión se recompila desde su modelo inmutable. */
export const ARTIFACT_COMPILER_VERSION = "5.0.0" as const;

export interface ArtifactActionEntry {
  capability: UbmCapabilityId;
  /** Configuración estática por paso del handler (acción del executor → config), p. ej. listar citas → cancelar. */
  steps: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface ArtifactBooking {
  provider: "nylas" | "internal";
  requiresService: boolean;
  slotDurationMinutes: number;
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number | null;
  cancellation: { allowed: boolean; minimumNoticeHours: number };
  rescheduling: { allowed: boolean };
  /** En la forma que leen los handlers de agenda (week[0 = domingo]). null = agenda interna (horarios de especialistas). */
  businessHours: BusinessHours | null;
}

export interface CompiledAgentArtifact {
  artifactSchema: typeof ARTIFACT_SCHEMA_VERSION;
  compilerVersion: string;
  source: "business_model" | "legacy_spec";
  businessModelSchema: string;
  tenantId: string;
  agentId: string;
  /** Versión publicada (ref textual para trazas / estado y número publicado; null en legacy). No entra al checksum. */
  version: { ref: string; publishedVersion: number | null };
  identity: { name: string; language: string; currency: string; timezone: string; category: string | null };
  capabilities: ReadonlyArray<{ id: UbmCapabilityId; version: string; enabled: boolean; actions: readonly string[]; dependsOn: readonly UbmCapabilityId[] }>;
  /** Acciones HABILITADAS (autorización del Action Engine). Una acción que no está aquí no se ejecuta. */
  actions: Readonly<Record<string, ArtifactActionEntry>>;
  booking: ArtifactBooking | null;
  catalogAuthority: "business_tables" | "model";
  /** Servicios activos del modelo (vacío con catálogo en tablas). */
  services: ReadonlyArray<{ id: string; name: string; durationMinutes: number; bookable: boolean }>;
  requirements: AgentRequirements;
  understanding: { businessName: string; businessSlots: readonly SlotDefinition[] };
  /** Pregunta configurada por slot. */
  questions: Readonly<Record<string, string>>;
  handoff: { enabled: boolean; pauseHours: number; message: string };
  knowledge: { enabled: boolean; onNoAnswer: "message" | "handoff"; noAnswerMessage: string };
  policies: { offerHandoff: boolean };
  notes: ReadonlyArray<{ code: LegacyNoteCode; path: string }>;
  /**
   * Huella de lo que afecta a una EJECUCIÓN (acciones y su config, agenda, servicios, requisitos, zona). Una solicitud de
   * acción construida con otra huella es de otra versión del negocio: no se ejecuta sin re-proponerse.
   */
  executionFingerprint: string;
  checksum: string;
}

export type ArtifactContent = Omit<CompiledAgentArtifact, "checksum" | "executionFingerprint" | "version">;

export function executionFingerprintOf(a: Pick<CompiledAgentArtifact, "actions" | "booking" | "services" | "requirements" | "identity">): string {
  return checksumOf({ actions: a.actions, booking: a.booking, services: a.services, requirements: a.requirements, timezone: a.identity.timezone }).slice(0, 32);
}

export function artifactChecksumOf(a: Omit<CompiledAgentArtifact, "checksum" | "version">): string {
  return checksumOf(a);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export type ArtifactIntegrity = { ok: true; artifact: CompiledAgentArtifact } | { ok: false; issue: "not_an_artifact" | "schema_mismatch" | "compiler_mismatch" | "checksum_mismatch" | "scope_mismatch" };

/** Verifica un artefacto leído de la base: forma, versión del compilador, checksum y alcance (tenant/agente). */
export function verifyArtifact(value: unknown, expected: { tenantId: string; agentId: string }): ArtifactIntegrity {
  if (!value || typeof value !== "object") return { ok: false, issue: "not_an_artifact" };
  const a = value as CompiledAgentArtifact;
  if (a.artifactSchema !== ARTIFACT_SCHEMA_VERSION) return { ok: false, issue: "schema_mismatch" };
  if (a.compilerVersion !== ARTIFACT_COMPILER_VERSION) return { ok: false, issue: "compiler_mismatch" };
  if (a.tenantId !== expected.tenantId || a.agentId !== expected.agentId) return { ok: false, issue: "scope_mismatch" };
  const { checksum, version: _v, ...rest } = a;
  void _v;
  if (typeof checksum !== "string" || artifactChecksumOf(rest) !== checksum) return { ok: false, issue: "checksum_mismatch" };
  if (a.executionFingerprint !== executionFingerprintOf(a)) return { ok: false, issue: "checksum_mismatch" };
  return { ok: true, artifact: deepFreeze(a) };
}

/** Requisitos del artefacto con su huella de ejecución (la state machine construye las solicitudes con ella). */
export function artifactRequirements(artifact: CompiledAgentArtifact): AgentRequirements {
  return { ...artifact.requirements, artifactRef: artifact.executionFingerprint };
}

/** Contexto del negocio para el Understanding Engine (FASE 2), desde el artefacto: nombre, zona y slots del negocio. */
export function businessContextFromArtifact(artifact: CompiledAgentArtifact): BusinessContextInput {
  return {
    tenantId: artifact.tenantId,
    agentId: artifact.agentId,
    businessName: artifact.understanding.businessName,
    businessTimezone: artifact.identity.timezone,
    businessSlots: [...artifact.understanding.businessSlots],
  };
}
