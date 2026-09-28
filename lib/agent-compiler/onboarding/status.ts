// DuLabs Business — Business Agent 2.0, FASE 6 — estado del agente y checklist de activación.
//
// Cada estado sale de HECHOS persistidos (borrador, publicación enlazada a la versión que sirve producción, números de
// WhatsApp, plan, lifecycle de FASE 1), nunca de lo que la pantalla cree:
//
//   NOT_STARTED  sin borrador ni agente previo
//   DRAFT        borrador guardado, aún sin verificar con los datos reales del negocio
//   INCOMPLETE   falta algo o hay errores (configuración o datos reales)
//   READY        listo para publicar (hay cambios sin publicar o nunca se publicó)
//   PUBLISHING   solo mientras corre la publicación (estado de la pantalla; la publicación es una sola transacción)
//   PUBLISHED    la última configuración está publicada; ningún número la atiende todavía
//   ACTIVE       publicada y atendiendo al menos un número
//   PAUSED       publicada y vinculada, pero los números están en pausa
//   ERROR        la versión publicada no se puede servir o el número lo atiende otro motor

import type { AgentLifecycleState } from "@/lib/agent-compiler/lifecycle/lifecycle";
import type { OnboardingStep } from "@/lib/agent-compiler/onboarding/issues";

export const ONBOARDING_STATUSES = ["NOT_STARTED", "DRAFT", "INCOMPLETE", "READY", "PUBLISHING", "PUBLISHED", "ACTIVE", "PAUSED", "ERROR"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export interface PublicationRecord {
  publishedVersion: number;
  flowVersionId: string;
  draftRevision: number;
  publishedAt: string;
}

export type NumberStatus = "active" | "paused" | "other_engine" | "other_agent" | "available" | "disconnected";

export interface WhatsAppNumberInfo {
  phoneNumberId: string;
  label: string;
  status: NumberStatus;
}

export interface StatusInput {
  hasDraft: boolean;
  hasPreviousAgent: boolean;
  draftRevision: number;
  structuralErrors: number;
  /** null = no se pudo evaluar con datos reales todavía. */
  readinessBlockers: number | null;
  publication: PublicationRecord | null;
  /** Versión que el registro sirve hoy en producción (published_version_id). */
  registryPublishedFlowVersionId: string | null;
  lifecycle: AgentLifecycleState | null;
}

export interface StatusResult {
  status: OnboardingStatus;
  /** La configuración guardada difiere de la publicada. */
  pendingChanges: boolean;
  /** La publicación enlazada es la que producción sirve y corresponde a este borrador. */
  publishedUpToDate: boolean;
}

export function deriveOnboardingStatus(i: StatusInput): StatusResult {
  const linked = Boolean(i.publication && i.registryPublishedFlowVersionId && i.publication.flowVersionId === i.registryPublishedFlowVersionId);
  const publishedUpToDate = linked && i.publication!.draftRevision === i.draftRevision;
  const pendingChanges = !publishedUpToDate;
  if (!i.hasDraft && !i.hasPreviousAgent && !i.publication) return { status: "NOT_STARTED", pendingChanges: false, publishedUpToDate: false };
  if (i.lifecycle === "ERROR") return { status: "ERROR", pendingChanges, publishedUpToDate };
  if (linked && i.lifecycle === "ACTIVE") return { status: "ACTIVE", pendingChanges, publishedUpToDate };
  if (linked && i.lifecycle === "PAUSED") return { status: "PAUSED", pendingChanges, publishedUpToDate };
  if (publishedUpToDate) return { status: "PUBLISHED", pendingChanges: false, publishedUpToDate };
  if (i.structuralErrors > 0 || (i.readinessBlockers ?? 0) > 0) return { status: "INCOMPLETE", pendingChanges, publishedUpToDate };
  if (i.readinessBlockers === null) return { status: "DRAFT", pendingChanges, publishedUpToDate };
  return { status: "READY", pendingChanges, publishedUpToDate };
}

export interface ChecklistItem {
  id: "configuracion" | "datos" | "publicado" | "plan" | "whatsapp" | "numero_libre" | "motor";
  ok: boolean;
  label: string;
  detail?: string;
  step: OnboardingStep;
}

export interface ChecklistInput {
  structuralErrors: number;
  readinessBlockers: number | null;
  firstReadinessMessage?: string;
  publishedUpToDate: boolean;
  hasActivePlan: boolean;
  numbers: WhatsAppNumberInfo[];
  /** FASE 8 — bloqueos del motor que atenderá la versión publicada (capacidades, IA, artefacto). */
  engineBlockers?: readonly string[];
}

/** "¿Se puede activar?" con razones. Activar solo se permite con TODO en verde (el servidor lo vuelve a exigir). */
export function buildChecklist(i: ChecklistInput): { items: ChecklistItem[]; readyToActivate: boolean } {
  const connected = i.numbers.filter((n) => n.status !== "disconnected");
  const usable = connected.filter((n) => n.status !== "other_engine");
  const items: ChecklistItem[] = [
    { id: "configuracion", ok: i.structuralErrors === 0, label: "Tu negocio está configurado", ...(i.structuralErrors > 0 ? { detail: `Faltan ${i.structuralErrors} ${i.structuralErrors === 1 ? "dato" : "datos"} por completar.` } : {}), step: "negocio" },
    {
      id: "datos",
      ok: i.readinessBlockers === 0,
      label: "Tus servicios, agenda e información están listos",
      ...(i.readinessBlockers === null ? { detail: "Aún no se verificó con tus datos." } : i.readinessBlockers > 0 ? { detail: i.firstReadinessMessage } : {}),
      step: "oferta",
    },
    { id: "publicado", ok: i.publishedUpToDate, label: "Tu agente está publicado con tus últimos cambios", ...(i.publishedUpToDate ? {} : { detail: "Publica para que tus cambios lleguen a WhatsApp." }), step: "activar" },
    { id: "plan", ok: i.hasActivePlan, label: "Tienes un plan activo", ...(i.hasActivePlan ? {} : { detail: "Sin plan, tu agente no puede responder en WhatsApp." }), step: "activar" },
    { id: "whatsapp", ok: connected.length > 0, label: "Tienes un número de WhatsApp conectado", ...(connected.length > 0 ? {} : { detail: i.numbers.length > 0 ? "Tu número está pendiente de conexión." : "Conecta tu número en Conexión." }), step: "activar" },
    {
      id: "numero_libre",
      ok: usable.length > 0,
      label: "Tu número puede atender con este agente",
      ...(connected.length > 0 && usable.length === 0 ? { detail: "Tu número lo atiende otro asistente. Desactívalo primero." } : {}),
      step: "activar",
    },
  ];
  if (i.engineBlockers) {
    items.push({ id: "motor", ok: i.engineBlockers.length === 0, label: "El motor puede ejecutar todo lo que activaste", ...(i.engineBlockers.length > 0 ? { detail: i.engineBlockers[0] } : {}), step: "activar" });
  }
  return { items, readyToActivate: items.every((x) => x.ok) };
}
