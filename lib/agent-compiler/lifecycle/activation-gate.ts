// DuLabs Business — Business Agent 2.0, FASE 1 — gate de activación (server-side).
//
// Activar = vincular el agente PUBLICADO a un número de WhatsApp (dulabs_clientes_config.flow_activo/flow_id).
// Antes de FASE 1 la única verificación era "el flow está publicado": un agente podía activarse con la
// configuración rota (calendario desconectado desde la publicación, políticas sin camino al runtime), sin plan
// (el runtime lo dejaba mudo por el cupo en 0) o en un número que atiende OTRO motor (el agente conversacional
// gana siempre en el webhook, así que la activación era un no-op silencioso).
//
// Este gate es la base de la máquina de estados de FASE 3: decide con los MISMOS hechos que usa el runtime y la
// publicación (resolver, readiness), no con lo que muestre la UI.
//
// Solo aplica a flows que SON Business Agent (tienen versiones en el Registry). Un flow de Flow Studio sigue el
// camino de siempre (`not_business_agent`).

import { checksumOf } from "@/lib/agent-compiler/checksum";
import type { BusinessAgentRegistryStore, AgentVersionRow } from "@/lib/agent-compiler/registry/types";
import type { ReadinessReport } from "@/lib/business-agent-readiness";
import type { BusinessAgentErrorCategory } from "@/lib/agent-compiler/contracts/errors";

export type ActivationBlockerCode =
  | "NUMBER_NOT_FOUND"
  | "NOT_PUBLISHED"
  | "AGENT_INVALID"
  | "READINESS_BLOCKED"
  | "BILLING_REQUIRED"
  | "ENGINE_CONFLICT";

export interface ActivationBlocker {
  code: ActivationBlockerCode;
  category: BusinessAgentErrorCategory;
  message: string;
}

export type ActivationDecision =
  | { kind: "not_business_agent" }
  | { kind: "allowed"; flowVersionId: string }
  | { kind: "blocked"; blockers: ActivationBlocker[] };

export interface ActivationGateDeps {
  store: Pick<BusinessAgentRegistryStore, "listVersions" | "resolvePublishedVersion">;
  /** El número existe y pertenece al tenant (nunca se revela si es de otro). */
  numberBelongsToTenant(tenantId: string, phoneNumberId: string): Promise<boolean>;
  /** Readiness de la versión publicada con los hechos reales del tenant (mismas reglas que el gate de publicación). */
  evaluateReadiness(tenantId: string, version: AgentVersionRow): Promise<ReadinessReport>;
  /** El tenant tiene una suscripción activa (sin plan el runtime no responde: cupo de IA en 0). */
  hasActivePlan(tenantId: string): Promise<boolean>;
  /** Otro motor que atiende ANTES que Business Agent en el webhook tiene este número (null = ninguno). */
  otherEngineOnNumber(phoneNumberId: string): Promise<"agente_conversacional" | null>;
}

export async function evaluateBusinessAgentActivation(
  deps: ActivationGateDeps,
  input: { tenantId: string; flowId: string; phoneNumberId: string },
): Promise<ActivationDecision> {
  const versiones = await deps.store.listVersions(input.tenantId, input.flowId);
  if (versiones.length === 0) return { kind: "not_business_agent" };

  // Primero el número: si no es del tenant no se evalúa (ni se revela) nada más.
  if (!(await deps.numberBelongsToTenant(input.tenantId, input.phoneNumberId))) {
    return { kind: "blocked", blockers: [{ code: "NUMBER_NOT_FOUND", category: "TENANT_ERROR", message: "Número no encontrado." }] };
  }

  const blockers: ActivationBlocker[] = [];
  const version = await deps.store.resolvePublishedVersion(input.tenantId, input.flowId);
  if (!version) {
    blockers.push({ code: "NOT_PUBLISHED", category: "BUSINESS_RULE_ERROR", message: "Publica tu agente antes de activarlo en un número." });
  } else if (version.tenantId !== input.tenantId || version.validationStatus !== "validated" || checksumOf(version.flow) !== version.flowChecksum) {
    blockers.push({ code: "AGENT_INVALID", category: "INTERNAL_ERROR", message: "La versión publicada no se puede servir con seguridad. Vuelve a publicar tu agente." });
  } else {
    const readiness = await deps.evaluateReadiness(input.tenantId, version);
    if (!readiness.ready) {
      for (const b of readiness.blockers) blockers.push({ code: "READINESS_BLOCKED", category: "BUSINESS_RULE_ERROR", message: b.message });
    }
  }

  if (!(await deps.hasActivePlan(input.tenantId))) {
    blockers.push({ code: "BILLING_REQUIRED", category: "BUSINESS_RULE_ERROR", message: "Necesitas un plan activo para que tu agente responda en WhatsApp." });
  }

  const otro = await deps.otherEngineOnNumber(input.phoneNumberId);
  if (otro) {
    blockers.push({
      code: "ENGINE_CONFLICT",
      category: "BUSINESS_RULE_ERROR",
      message: "Este número lo atiende el Agente conversacional: mientras esté configurado, el Business Agent no respondería. Desactívalo primero.",
    });
  }

  if (blockers.length > 0) return { kind: "blocked", blockers };
  return { kind: "allowed", flowVersionId: version!.flowVersionId };
}
