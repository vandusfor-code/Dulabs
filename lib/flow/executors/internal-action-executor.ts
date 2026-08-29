/**
 * Internal Action Executor — operaciones nativas DuLabs (Fase 4.1 / 4.1.2).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNotAborted } from "@/lib/flow/executor-framework";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import type { ActivarPausaChatResult } from "@/lib/pausas-chat";
import type { GuardarLeadEnterpriseResult, LeadEnterprise } from "@/lib/enterprise-leads";
import {
  crearCita,
  sugerirHorariosLibres,
  verificarDisponibilidad,
  type Cita,
} from "@/lib/marketplace-citas";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";
import type { ActionNodeConfig } from "@/lib/flow/types";

export type { LeadEnterprise };

export interface InternalActionDeps {
  supabase: SupabaseClient;
  authorizer: InternalActionAuthorizer;
  guardarLeadEnterprise: (
    supabase: SupabaseClient,
    lead: LeadEnterprise,
  ) => Promise<GuardarLeadEnterpriseResult>;
  activarPausaChat: (
    supabase: SupabaseClient,
    phoneNumberId: string,
    telefonoCliente: string,
    duracionMs: number,
  ) => Promise<ActivarPausaChatResult>;
  verificarDisponibilidad: typeof verificarDisponibilidad;
  sugerirHorariosLibres: typeof sugerirHorariosLibres;
  crearCita: typeof crearCita;
  readPausaUntil: (
    supabase: SupabaseClient,
    phoneNumberId: string,
    telefonoCliente: string,
  ) => Promise<string | null>;
}

const OPERATION_CLASS: Partial<Record<string, InternalActionOperationClass>> = {
  consultar_disponibilidad: "READ",
  crear_lead_enterprise: "WRITE",
  crear_lead_campana: "WRITE",
  agendar_cita_marketplace: "CRITICAL",
  transferir_soporte: "CRITICAL",
};

function resolveInternalActionKey(action: ActionNodeConfig): string {
  if (action.actionType === "webhook_http") {
    return action.semanticTag ?? "webhook_http";
  }
  return action.actionType;
}

/** Params estáticos del nodo tienen prioridad sobre variables runtime del payload. */
function mergeParams(
  payload: Record<string, unknown>,
  params?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      out[key] = value;
    }
  }
  return out;
}

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function criticalEvidenceMissing(
  actionKey: string,
  data: Record<string, unknown>,
): string | null {
  if (actionKey === "agendar_cita_marketplace") {
    if (typeof data.appointmentId !== "number" && typeof data.appointmentId !== "string") {
      return "missing_appointmentId";
    }
    if (data.status !== "agendada") return "missing_confirmed_status";
    return null;
  }
  if (actionKey === "transferir_soporte") {
    if (typeof data.pausadoHasta !== "string") return "missing_pausadoHasta";
    return null;
  }
  if (actionKey === "crear_lead_enterprise" || actionKey === "crear_lead_campana") {
    if (typeof data.leadId !== "number" && typeof data.leadId !== "string") {
      return "missing_leadId";
    }
    return null;
  }
  return null;
}

export class InternalActionExecutor implements EffectExecutor {
  readonly kind = "action" as const;
  readonly version = "1.1.0";
  readonly capabilities = {
    supportsIntegration: false,
    supportsAsync: false,
    operationClasses: ["READ", "WRITE", "CRITICAL"] as InternalActionOperationClass[],
  };

  constructor(private readonly deps: InternalActionDeps) {}

  async dispatch(
    request: EffectDispatchRequest,
    context: EffectExecutionContext,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    assertNotAborted(signal);

    if (!context.internal) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
        error: "external_action_not_routed",
      };
    }

    const action = request.action;
    if (!action) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "action_config_required",
      };
    }

    const actionKey = resolveInternalActionKey(action);
    const params = mergeParams(request.payload, "params" in action ? action.params : undefined);

    switch (actionKey) {
      case "consultar_disponibilidad":
        return this.consultarDisponibilidad(request, params, signal);
      case "crear_lead_enterprise":
      case "crear_lead_campana":
        return this.crearLead(request, params, actionKey, signal);
      case "agendar_cita_marketplace":
        return this.agendarCita(request, params, signal);
      case "transferir_soporte":
        return this.transferirSoporte(request, action, signal);
      default:
        return {
          success: false,
          classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
          error: `internal_action_not_supported:${actionKey}`,
        };
    }
  }

  private tenantRejected(): EffectDispatchResult {
    return {
      success: false,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
      error: "tenant_resource_mismatch",
    };
  }

  private async consultarDisponibilidad(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const activacionId = num(params.activacionId, 0);
    const fecha = params.fecha;
    const hora = params.hora;
    const duracionMin = num(params.duracionMin, 30);
    const recursosDisponibles = num(params.recursosDisponibles, 1);

    if (!activacionId || !fecha || !hora) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_availability_params",
      };
    }

    assertNotAborted(signal);

    const owned = await this.deps.authorizer.assertActivacionOwnedByTenant(
      request.tenantId,
      activacionId,
    );
    if (!owned) return this.tenantRejected();

    assertNotAborted(signal);

    const available = await this.deps.verificarDisponibilidad(this.deps.supabase, {
      activacionId,
      fecha,
      hora,
      duracionMin,
      recursosDisponibles,
    });

    assertNotAborted(signal);

    const slots = available
      ? [hora.slice(0, 5)]
      : await this.deps.sugerirHorariosLibres(this.deps.supabase, {
          activacionId,
          fecha,
          horaDeseada: hora,
          duracionMin,
          recursosDisponibles,
        });

    const data = {
      available,
      slots,
      date: fecha,
      resource: String(activacionId),
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.consultar_disponibilidad },
    };
  }

  private async crearLead(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    actionKey: string,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const lead: LeadEnterprise = {
      nombre: params.nombre ?? "",
      empresa: params.empresa ?? "",
      correo: params.correo ?? "",
      telefono: params.telefono,
      necesidad: params.necesidad ?? "",
      detalle: params.detalle,
    };

    if (!lead.nombre || !lead.correo) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_lead_fields",
      };
    }

    assertNotAborted(signal);

    const saved = await this.deps.guardarLeadEnterprise(this.deps.supabase, lead);
    if (!saved.success) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS,
        error: "lead_not_persisted",
      };
    }

    const data: Record<string, unknown> = {
      leadId: saved.leadId,
      effectId: request.effectId,
      actionType: actionKey,
    };

    const evidenceError = criticalEvidenceMissing(actionKey, data);
    if (evidenceError) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS,
        error: evidenceError,
      };
    }

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      externalReference: `lead:${saved.leadId}`,
      metadata: { operationClass: OPERATION_CLASS[actionKey] },
    };
  }

  private async agendarCita(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const activacionId = num(params.activacionId, 0);
    const fecha = params.fecha;
    const hora = params.hora;
    const duracionMin = num(params.duracionMin, 30);
    const recursosDisponibles = num(params.recursosDisponibles, 1);
    const phoneNumberId = request.conversation?.phoneNumberId ?? params.phoneNumberId ?? "";
    const numeroCliente = request.conversation?.telefonoCliente ?? params.numeroCliente ?? "";

    if (!activacionId || !fecha || !hora || !phoneNumberId || !numeroCliente) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_appointment_params",
      };
    }

    assertNotAborted(signal);

    const activacionOwned = await this.deps.authorizer.assertActivacionOwnedByTenant(
      request.tenantId,
      activacionId,
    );
    if (!activacionOwned) return this.tenantRejected();

    const phoneOwned = await this.deps.authorizer.assertPhoneNumberOwnedByTenant(
      request.tenantId,
      phoneNumberId,
    );
    if (!phoneOwned) return this.tenantRejected();

    assertNotAborted(signal);

    const cita: Cita | null = await this.deps.crearCita(this.deps.supabase, {
      activacionId,
      phoneNumberId,
      numeroCliente,
      nombreCliente: params.nombreCliente ?? null,
      fecha,
      hora,
      duracionMin,
      servicio: params.servicio ?? null,
      recursosDisponibles,
    });

    if (!cita) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS,
        error: "appointment_not_created",
      };
    }

    const data = {
      appointmentId: cita.id,
      reservationId: cita.id,
      status: cita.estado,
      date: cita.fecha,
      time: cita.hora_inicio,
      effectId: request.effectId,
    };

    const evidenceError = criticalEvidenceMissing("agendar_cita_marketplace", data);
    if (evidenceError) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS,
        error: evidenceError,
      };
    }

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data as unknown as Record<string, unknown>,
      externalReference: `appointment:${cita.id}`,
      metadata: { operationClass: OPERATION_CLASS.agendar_cita_marketplace },
    };
  }

  private async transferirSoporte(
    request: EffectDispatchRequest,
    action: ActionNodeConfig,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const conversation = request.conversation;
    if (!conversation) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "conversation_required",
      };
    }

    assertNotAborted(signal);

    const phoneOwned = await this.deps.authorizer.assertPhoneNumberOwnedByTenant(
      request.tenantId,
      conversation.phoneNumberId,
    );
    if (!phoneOwned) return this.tenantRejected();

    const pauseHours =
      action.actionType === "transferir_soporte" ? (action.pauseDurationHours ?? 24) : 24;
    const duracionMs = pauseHours * 60 * 60 * 1000;

    const pauseResult = await this.deps.activarPausaChat(
      this.deps.supabase,
      conversation.phoneNumberId,
      conversation.telefonoCliente,
      duracionMs,
    );

    if (!pauseResult.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS,
        error: "pause_activation_failed",
      };
    }

    assertNotAborted(signal);

    const pausadoHasta = await this.deps.readPausaUntil(
      this.deps.supabase,
      conversation.phoneNumberId,
      conversation.telefonoCliente,
    );

    if (!pausadoHasta) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS,
        error: "evidence_missing",
      };
    }

    const data = {
      transferred: true,
      pausadoHasta,
      pauseDurationHours: pauseHours,
      effectId: request.effectId,
    };

    const evidenceError = criticalEvidenceMissing("transferir_soporte", data);
    if (evidenceError) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS,
        error: evidenceError,
      };
    }

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.transferir_soporte },
    };
  }
}
