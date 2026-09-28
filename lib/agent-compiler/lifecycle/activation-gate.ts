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
  | "ENGINE_CONFLICT"
  | "ENGINE_NOT_READY";

export interface ActivationBlocker {
  code: ActivationBlockerCode;
  category: BusinessAgentErrorCategory;
  /** QUÉ falta (texto para el negocio). */
  message: string;
  /** FASE 10 — POR QUÉ importa y CÓMO solucionarlo (texto para el negocio; lo llena `explainActivationBlocker`). */
  why?: string;
  fix?: string;
  /** Código del motivo concreto (readiness / motor), p. ej. WHATSAPP_CREDENTIAL_MISSING. */
  detailCode?: string;
  /** Paso del configurador donde se arregla un bloqueo de readiness (ids del Wizard FASE 1). */
  readinessStep?: string;
}

/**
 * FASE 10 — explicación humana ÚNICA de cada bloqueo (backend decide y explica; la pantalla solo muestra). Nunca
 * jerga técnica: qué falta (message), por qué importa (why) y cómo solucionarlo (fix).
 */
const EXPLAIN: Readonly<Record<string, { why: string; fix: string }>> = {
  NUMBER_NOT_FOUND: { why: "Ese número no aparece conectado a tu cuenta de DuLabs.", fix: "Elige uno de tus números conectados o conecta tu WhatsApp primero." },
  NOT_PUBLISHED: { why: "Tu WhatsApp responde con la versión publicada de tu agente, y todavía no hay una.", fix: "Publica tu configuración y luego actívala." },
  AGENT_INVALID: { why: "La versión publicada no pasó la verificación de seguridad, así que no la usamos para responder.", fix: "Publica de nuevo tu configuración. Si vuelve a pasar, escríbenos con el código de soporte." },
  READINESS_BLOCKED: { why: "Tu agente ofrecería algo que todavía no puede cumplir con los datos o conexiones actuales de tu negocio.", fix: "Completa lo que se indica en el paso marcado y vuelve a publicar." },
  BILLING_REQUIRED: { why: "Sin un plan activo tu agente no puede enviar mensajes por WhatsApp.", fix: "Activa o renueva tu plan en Facturación." },
  ENGINE_CONFLICT: { why: "Un número de WhatsApp solo puede tener un agente, y este ya lo atiende otro.", fix: "Desactiva el otro agente en ese número o elige un número distinto." },
  ENGINE_NOT_READY: { why: "Tu agente tiene activada una función que todavía no está disponible con la configuración actual.", fix: "Apaga esa función o escríbenos para habilitarla en tu negocio." },
  // Motivos concretos del motor (evaluateEngineReadiness):
  ENGINE_CAPABILITY_UNSUPPORTED: { why: "Tu agente tiene activada una función que todavía no está disponible con la configuración actual.", fix: "Apaga esa función o escríbenos para habilitarla en tu negocio." },
  AI_CREDENTIAL_MISSING: { why: "El servicio de inteligencia artificial de DuLabs no está disponible en este momento.", fix: "No tienes que cambiar nada: es de nuestro lado. Inténtalo más tarde o escríbenos con el código de soporte." },
  ARTIFACT_INVALID: { why: "No pudimos preparar tu versión publicada para responder mensajes.", fix: "Publica de nuevo tu configuración. Si vuelve a pasar, escríbenos con el código de soporte." },
  WHATSAPP_CREDENTIAL_MISSING: { why: "Sin el permiso de Meta, tu agente no puede enviar respuestas por WhatsApp.", fix: "Vuelve a conectar tu WhatsApp desde Integraciones." },
  CALENDAR_CREDENTIAL_MISSING: { why: "Tu agente agenda con calendario y esa conexión no está disponible en DuLabs en este momento.", fix: "Es de nuestro lado: escríbenos con el código de soporte, o cambia tu agenda a «con los horarios de tu equipo»." },
};

export function explainActivationBlocker(b: ActivationBlocker): ActivationBlocker {
  const e = (b.detailCode && EXPLAIN[b.detailCode]) || EXPLAIN[b.code];
  return e ? { ...b, why: b.why ?? e.why, fix: b.fix ?? e.fix } : b;
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
  /**
   * FASE 8 — ¿el MOTOR que atenderá la versión publicada puede ejecutarla? (capacidades soportadas por ese motor,
   * credencial de IA, artefacto compilable). Devuelve los bloqueos en lenguaje humano. Ausente = no se evalúa.
   */
  engineReadiness?(tenantId: string, version: AgentVersionRow): Promise<Array<string | { code: string; message: string }>>;
}

export async function evaluateBusinessAgentActivation(
  deps: ActivationGateDeps,
  input: { tenantId: string; flowId: string; phoneNumberId: string },
): Promise<ActivationDecision> {
  const versiones = await deps.store.listVersions(input.tenantId, input.flowId);
  if (versiones.length === 0) return { kind: "not_business_agent" };

  // Primero el número: si no es del tenant no se evalúa (ni se revela) nada más.
  if (!(await deps.numberBelongsToTenant(input.tenantId, input.phoneNumberId))) {
    return { kind: "blocked", blockers: [explainActivationBlocker({ code: "NUMBER_NOT_FOUND", category: "TENANT_ERROR", message: "Número no encontrado." })] };
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
      for (const b of readiness.blockers) blockers.push({ code: "READINESS_BLOCKED", category: "BUSINESS_RULE_ERROR", message: b.message, detailCode: b.code, ...(b.step ? { readinessStep: b.step } : {}) });
    }
    if (deps.engineReadiness) {
      for (const r of await deps.engineReadiness(input.tenantId, version)) {
        blockers.push(typeof r === "string" ? { code: "ENGINE_NOT_READY", category: "BUSINESS_RULE_ERROR", message: r } : { code: "ENGINE_NOT_READY", category: "BUSINESS_RULE_ERROR", message: r.message, detailCode: r.code });
      }
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

  if (blockers.length > 0) return { kind: "blocked", blockers: blockers.map(explainActivationBlocker) };
  return { kind: "allowed", flowVersionId: version!.flowVersionId };
}
