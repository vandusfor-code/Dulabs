// DuLabs Business — Business Agent 2.0, FASE 9 — detección de DERIVA de configuración (drift).
//
// La configuración de un agente vive en varias piezas que deben coincidir: el borrador guiado, la última publicación
// guiada, la versión que el registro sirve en producción (published_version_id), el artefacto activo del modelo de
// negocio (y la versión del registro a la que quedó ligado) y los números de WhatsApp. Esta función compara HECHOS ya
// leídos (nunca escribe ni "corrige" nada) y devuelve hallazgos con un mensaje para el negocio y un código para soporte.

import type { AgentLifecycleState } from "@/lib/agent-compiler/lifecycle/lifecycle";
import type { PublicationRecord, WhatsAppNumberInfo } from "@/lib/agent-compiler/onboarding/status";

export interface ArtifactLink {
  /** Versión del modelo de negocio activa (la que usa el motor conversacional). */
  activeVersion: number;
  /** Última versión publicada del modelo (activa < última = hay un rollback vigente). */
  latestVersion: number;
  /** Versión del registro a la que quedó ligado el artefacto activo (publicación guiada). null = sin vínculo. */
  flowVersionId: string | null;
}

export interface DriftFacts {
  /** Versión que el registro sirve HOY (dulabs_flows.published_version_id). */
  registryPublishedFlowVersionId: string | null;
  publication: PublicationRecord | null;
  artifact: ArtifactLink | null;
  draftRevision: number;
  lifecycle: AgentLifecycleState | null;
  numbers: WhatsAppNumberInfo[];
}

export type DriftCode = "ARTIFACT_NOT_SERVED" | "PUBLISHED_OUTSIDE_GUIDED_SETUP" | "ACTIVE_WITHOUT_NUMBER" | "ROLLBACK_ACTIVE" | "DRAFT_NOT_PUBLISHED";

export interface DriftFinding {
  code: DriftCode;
  severity: "warning" | "info";
  message: string;
}

export function detectConfigurationDrift(f: DriftFacts): DriftFinding[] {
  const out: DriftFinding[] = [];
  const served = f.registryPublishedFlowVersionId;
  if (f.artifact?.flowVersionId && served && f.artifact.flowVersionId !== served) {
    out.push({
      code: "ARTIFACT_NOT_SERVED",
      severity: "warning",
      message: "La versión que hoy atiende a tus clientes no es la que publicaste desde la configuración guiada. Vuelve a publicar para alinearlas.",
    });
  } else if (f.publication && served && f.publication.flowVersionId !== served) {
    out.push({
      code: "PUBLISHED_OUTSIDE_GUIDED_SETUP",
      severity: "warning",
      message: "Se publicó otra versión del agente fuera de la configuración guiada. Revisa los cambios antes de volver a publicar.",
    });
  }
  if (f.lifecycle === "ACTIVE" && !f.numbers.some((n) => n.status === "active" || n.status === "paused")) {
    out.push({ code: "ACTIVE_WITHOUT_NUMBER", severity: "warning", message: "El agente figura activo pero ningún número de WhatsApp lo tiene asignado." });
  }
  if (f.artifact && f.artifact.activeVersion < f.artifact.latestVersion) {
    out.push({ code: "ROLLBACK_ACTIVE", severity: "info", message: `Está activa la versión ${f.artifact.activeVersion} (restaurada); la más reciente es la ${f.artifact.latestVersion}.` });
  }
  if (f.publication && f.draftRevision > f.publication.draftRevision) {
    out.push({ code: "DRAFT_NOT_PUBLISHED", severity: "info", message: "Tienes cambios guardados que todavía no están publicados." });
  }
  return out;
}
