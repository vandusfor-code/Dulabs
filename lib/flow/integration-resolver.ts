/**
 * Resolución centralizada de integration + credential + tenant (Fase 4.1).
 * Credenciales solo en memoria dentro del boundary del Executor Framework.
 */

import { descifrarSecreto } from "@/lib/crypto";
import type { FlowCredentialRow, FlowIntegrationRow } from "@/lib/flow/flow-store-types";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectExecutionContext,
  type EffectExecutorKind,
  type EffectResultClassification,
} from "@/lib/flow/executor-types";
import type { ActionNodeConfig } from "@/lib/flow/types";
import { resolveActionCapabilitySpec } from "@/lib/flow/action-capabilities";

export interface IntegrationResolverStore {
  getIntegrationById(tenantId: string, integrationId: string): Promise<FlowIntegrationRow | null>;
  getIntegrationCredentials(
    tenantId: string,
    integrationId: string,
  ): Promise<FlowCredentialRow[]>;
}

export type IntegrationResolveOutcome =
  | { ok: true; context: EffectExecutionContext }
  | { ok: false; classification: EffectResultClassification; reason: string };

const INTERNAL_ACTION_TYPES = new Set([
  "crear_lead_enterprise",
  "crear_lead_campana",
  "agendar_cita_marketplace",
  "transferir_soporte",
  // Fase 0 (autorizado) — mismo trato que agendar_cita_marketplace: acciones
  // nativas sobre dulabs_especialistas/dulabs_citas_especialista, no
  // requieren integración externa. Las 3 pertenecen al mismo adaptador (ver
  // lib/especialistas-flow-adaptador.ts).
  "agendar_cita_especialista",
  "consultar_disponibilidad_especialista",
  "cancelar_cita_especialista",
  // BUG REAL encontrado (prueba real controlada post-publicación de v9,
  // sept. 2026): esta acción existe desde Blocker #3 (anterior a este
  // rediseño, ya presente también en v8) y NUNCA se agregó acá -- mismo
  // síntoma exacto que el hallazgo de abajo (SECURITY_REJECTED/
  // "integration_required" en TODO dispatch real vía el orchestrator,
  // invisible a los tests que llaman runFlowEngine directo). Encontrado al
  // correr una prueba real end-to-end contra el tenant real de Daniela:
  // CUALQUIER servicio real ("semipermanente", "pedicure") era rechazado
  // con "Ese servicio no lo manejamos por acá" antes de llegar siquiera a
  // resolverCandidatas().
  "validar_servicio_especialista",
  // Fase 1 (Blocker #4, autorizado) — misma razón que las anteriores.
  "consultar_citas_activas_especialista",
  // Fase 1 (Blocker #5, autorizado) — misma razón que las anteriores.
  "mover_cita_especialista",
  // Rediseño de agendamiento (autorizado) — misma razón que las anteriores.
  // BUG REAL encontrado (Objetivo 2, sept. 2026): estas 3 acciones nuevas
  // nunca se agregaron acá, así que TODO dispatch real a través del
  // orchestrator (IntegrationResolver.resolve) las rechazaba con
  // SECURITY_REJECTED/"integration_required" -- el rediseño de agendamiento
  // completo (act-validar-fecha, act-listar-horarios,
  // act-resolver-seleccion-horario/-inicial) nunca hubiera funcionado en
  // producción real, aunque los tests unitarios contra runFlowEngine
  // directo (sin pasar por el orchestrator) sí pasaban -- esos tests nunca
  // ejercitan este gate. Encontrado al escribir un test de integración real
  // end-to-end para preguntas laterales (primera vez que algo de la
  // suite pasa por atenderMensajeConFlowConFallback real con estas 3
  // acciones en el camino).
  "validar_fecha_especialista",
  "listar_horarios_disponibles_especialista",
  "resolver_seleccion_horario",
  // Cierre final Daniela (autorizado) — mismo trato exacto que las
  // anteriores: acciones nativas sobre datos ya sembrados en
  // state.variables (baseConocimiento), sin integración externa.
  // Registradas acá DESDE EL PRIMER COMMIT que las introduce (a diferencia
  // de las 3 de arriba, que se publicaron sin esto y causaron un bug real
  // en producción -- ver commit "fix(flow): registra
  // validar_servicio_especialista..." del mismo día).
  "listar_servicios_especialista",
  "resolver_seleccion_servicio",
]);

const INTERNAL_WEBHOOK_TAGS = new Set(["consultar_disponibilidad"]);

function isInternalAction(action?: ActionNodeConfig): boolean {
  if (!action) return false;
  if (INTERNAL_ACTION_TYPES.has(action.actionType)) return true;
  if (action.actionType === "webhook_http") {
    const tag = "semanticTag" in action ? action.semanticTag : undefined;
    return Boolean(tag && INTERNAL_WEBHOOK_TAGS.has(tag));
  }
  return false;
}

function requiredCapabilityForAction(action?: ActionNodeConfig): string | undefined {
  if (!action) return undefined;
  const spec = resolveActionCapabilitySpec(action);
  if (spec.semanticTag) return spec.semanticTag;
  return action.actionType;
}

export class IntegrationResolver {
  constructor(private readonly store: IntegrationResolverStore) {}

  async resolve(input: {
    tenantId: string;
    integrationId?: string;
    action?: ActionNodeConfig;
    kind?: EffectExecutorKind;
  }): Promise<IntegrationResolveOutcome> {
    if (input.kind === "ai") {
      return {
        ok: true,
        context: { tenantId: input.tenantId, internal: true },
      };
    }

    // Fase 0 (autorizado) — envío de WhatsApp nativo: usa el token Meta del
    // propio tenant (resuelto por SendMessageExecutor vía ClienteConfig), no
    // una integración externa configurada en dulabs_flow_integrations. Sin
    // este bypass, TODO nodo "message" de CUALQUIER flow (no solo el
    // adaptador de especialistas) fallaba siempre con integration_required
    // antes de llegar al executor.
    if (input.kind === "send_message") {
      return {
        ok: true,
        context: { tenantId: input.tenantId, internal: true },
      };
    }

    if (isInternalAction(input.action)) {
      return {
        ok: true,
        context: {
          tenantId: input.tenantId,
          internal: true,
        },
      };
    }

    if (!input.integrationId) {
      return {
        ok: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
        reason: "integration_required",
      };
    }

    const integration = await this.store.getIntegrationById(input.tenantId, input.integrationId);
    if (!integration) {
      return {
        ok: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
        reason: "integration_not_found",
      };
    }

    if (integration.tenant_id !== input.tenantId) {
      return {
        ok: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
        reason: "tenant_mismatch",
      };
    }

    if (integration.status !== "approved") {
      return {
        ok: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
        reason: "integration_not_approved",
      };
    }

    const requiredCapability = requiredCapabilityForAction(input.action);
    if (requiredCapability && integration.capability !== requiredCapability) {
      return {
        ok: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
        reason: "capability_mismatch",
      };
    }

    const credentialRows = await this.store.getIntegrationCredentials(
      input.tenantId,
      input.integrationId,
    );

    if (credentialRows.length === 0) {
      return {
        ok: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR,
        reason: "credential_missing",
      };
    }

    const credentials: Record<string, string> = {};
    for (const row of credentialRows) {
      credentials[row.credential_key] = descifrarSecreto(row.encrypted_value);
    }

    return {
      ok: true,
      context: {
        tenantId: input.tenantId,
        internal: false,
        integrationId: integration.id,
        capability: integration.capability,
        credentials,
      },
    };
  }
}

/** Resolver que rechaza integraciones externas (tests de acciones internas). */
export function createInternalOnlyIntegrationResolver(): IntegrationResolver {
  const store: IntegrationResolverStore = {
    getIntegrationById: async () => null,
    getIntegrationCredentials: async () => [],
  };
  return new IntegrationResolver(store);
}
