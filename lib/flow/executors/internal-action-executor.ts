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
  consultarDisponibilidadEspecialista,
  validarServicioEspecialista,
  agendarCitaEspecialista,
  cancelarCitaEspecialista,
  consultarCitasActivasEspecialista,
  moverCitaEspecialista,
  listarHorariosDisponiblesEspecialista,
  resolverSeleccionHorario,
  formatearListaHorarios,
  categoriaMenuDesdeBotonId,
  parseServiciosDesdeBaseConocimiento,
  formatearListaServicios,
  resolverSeleccionServicio,
  formatearPrecioCop,
} from "@/lib/especialistas-flow-adaptador";
import { parseFechaColombia } from "@/lib/parse-fecha-colombia";
import { esMencionPestanas } from "@/lib/flow-pestanas-hatch";
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
  // Fase 0 — adaptador de citas por especialista (dulabs_especialistas /
  // dulabs_citas_especialista), NO marketplace. Ver
  // lib/especialistas-flow-adaptador.ts.
  consultarDisponibilidadEspecialista: typeof consultarDisponibilidadEspecialista;
  validarServicioEspecialista: typeof validarServicioEspecialista;
  agendarCitaEspecialista: typeof agendarCitaEspecialista;
  cancelarCitaEspecialista: typeof cancelarCitaEspecialista;
  // Fase 1 (Blocker #4).
  consultarCitasActivasEspecialista: typeof consultarCitasActivasEspecialista;
  // Fase 1 (Blocker #5).
  moverCitaEspecialista: typeof moverCitaEspecialista;
  // Rediseño de agendamiento (autorizado).
  listarHorariosDisponiblesEspecialista: typeof listarHorariosDisponiblesEspecialista;
}

const OPERATION_CLASS: Partial<Record<string, InternalActionOperationClass>> = {
  consultar_disponibilidad: "READ",
  crear_lead_enterprise: "WRITE",
  crear_lead_campana: "WRITE",
  agendar_cita_marketplace: "CRITICAL",
  transferir_soporte: "CRITICAL",
  consultar_disponibilidad_especialista: "READ",
  validar_servicio_especialista: "READ",
  agendar_cita_especialista: "CRITICAL",
  cancelar_cita_especialista: "CRITICAL",
  consultar_citas_activas_especialista: "READ",
  mover_cita_especialista: "CRITICAL",
  validar_fecha_especialista: "READ",
  listar_horarios_disponibles_especialista: "READ",
  resolver_seleccion_horario: "READ",
  listar_servicios_especialista: "READ",
  resolver_seleccion_servicio: "READ",
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
  if (actionKey === "agendar_cita_especialista") {
    if (typeof data.citaId !== "number" && typeof data.citaId !== "string") {
      return "missing_citaId";
    }
    // "pendiente" (Nicol/pestañas, requiere aprobación) es un resultado REAL
    // igual que "confirmada" -- ambos son una fila real insertada en
    // dulabs_citas_especialista. Ver comentario en action-capabilities.ts.
    if (data.status !== "confirmada" && data.status !== "pendiente") {
      return "missing_confirmed_or_pending_status";
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
      case "consultar_disponibilidad_especialista":
        return this.consultarDisponibilidadEspecialistaAction(request, params, signal);
      case "validar_servicio_especialista":
        return this.validarServicioEspecialistaAction(request, params, signal);
      case "agendar_cita_especialista":
        return this.agendarCitaEspecialistaAction(request, params, signal);
      case "cancelar_cita_especialista":
        return this.cancelarCitaEspecialistaAction(request, params, signal);
      case "consultar_citas_activas_especialista":
        return this.consultarCitasActivasEspecialistaAction(request, params, signal);
      case "mover_cita_especialista":
        return this.moverCitaEspecialistaAction(request, params, signal);
      case "validar_fecha_especialista":
        return this.validarFechaEspecialistaAction(request, params);
      case "listar_horarios_disponibles_especialista":
        return this.listarHorariosDisponiblesEspecialistaAction(request, params, signal);
      case "resolver_seleccion_horario":
        return this.resolverSeleccionHorarioAction(request, params);
      case "listar_servicios_especialista":
        return this.listarServiciosEspecialistaAction(request, params);
      case "resolver_seleccion_servicio":
        return this.resolverSeleccionServicioAction(request, params);
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

  // --- Fase 0: adaptador de citas por especialista (Daniela) --------------

  private async validarServicioEspecialistaAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const phoneNumberId = request.conversation?.phoneNumberId ?? params.phoneNumberId ?? "";
    // Objetivo 1 (rediseño, autorizado) — q-categoria-servicio comparte UN
    // solo variableKey (categoriaSeleccionada) para botón Y texto libre
    // (mismo mecanismo nativo de un nodo "buttons"). Si la clienta escribió
    // texto en vez de tocar un botón, ese texto SÍ es el intento de
    // servicio (edge e-categoria-texto -> directo acá, sin pasar por
    // q-servicio) -- por eso, sin `servicio` propio, se usa
    // categoriaSeleccionada como el texto del servicio. Nunca ambiguo con
    // un id real de botón: categoriaMenuDesdeBotonId exige coincidencia
    // EXACTA con los 3 ids conocidos, así que texto libre real jamás se
    // confunde con una categoría ya elegida.
    const servicio = params.servicio ?? params.categoriaSeleccionada ?? "";

    if (!phoneNumberId || !servicio) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_service_params",
      };
    }

    assertNotAborted(signal);
    const owned = await this.deps.authorizer.assertPhoneNumberOwnedByTenant(request.tenantId, phoneNumberId);
    if (!owned) return this.tenantRejected();
    assertNotAborted(signal);

    // Si la clienta ya tocó un botón de categoría real, categoriaSeleccionada
    // llega con el id ESTABLE del botón, nunca con el texto visible.
    // categoriaMenuDesdeBotonId ignora silenciosamente cualquier valor que
    // no sea uno de los 3 ids reales -- si no hubo categoría (servicio ya
    // venía del primer mensaje, o llegó como texto libre acá mismo), sigue
    // validando sin restricción, igual que antes de este cambio.
    const categoriaEsperada = categoriaMenuDesdeBotonId(params.categoriaSeleccionada) ?? undefined;

    const resultado = await this.deps.validarServicioEspecialista(this.deps.supabase, {
      phoneNumberId,
      servicio,
      categoriaEsperada,
    });

    assertNotAborted(signal);

    if (!resultado.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.motivo,
        data: { detalle: resultado.detalle },
      };
    }

    // Objetivo 1 (rediseño, autorizado) — escribe `servicio` de vuelta
    // siempre, incluida la ruta de texto libre en q-categoria-servicio
    // (donde `servicio` nunca pasó por su propio nodo pregunta, ver arriba
    // el fallback params.servicio ?? params.categoriaSeleccionada). Sin
    // esto, act-listar-horarios y la propuesta final ({{servicio}}) se
    // quedarían con la variable vacía por ese camino -- hallazgo real
    // encontrado por el test C de daniela-menu-servicios-spa.test.ts.
    const data = { servicio, servicioReconocido: true, effectId: request.effectId };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.validar_servicio_especialista },
    };
  }

  private async consultarDisponibilidadEspecialistaAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const phoneNumberId = request.conversation?.phoneNumberId ?? params.phoneNumberId ?? "";
    // Rediseño de agendamiento (autorizado) — reagendar identifica el
    // servicio de la cita objetivo como `citaObjetivoServicio` (ver
    // daniela-reagendar-cita.flow.ts); `fecha` ya llega validada por
    // act-validar-nueva-fecha bajo ESE mismo nombre (escribe tanto `fecha`
    // como `nuevaFecha`), así que acá no hace falta un segundo alias.
    const servicio = params.servicio ?? params.citaObjetivoServicio ?? "";
    const fecha = params.fecha ?? "";
    const duracionMinInput = params.duracionMin ? num(params.duracionMin, 0) : undefined;

    if (!phoneNumberId || !servicio || !fecha) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_availability_params",
      };
    }

    assertNotAborted(signal);
    const owned = await this.deps.authorizer.assertPhoneNumberOwnedByTenant(request.tenantId, phoneNumberId);
    if (!owned) return this.tenantRejected();
    assertNotAborted(signal);

    const resultado = await this.deps.consultarDisponibilidadEspecialista(this.deps.supabase, {
      phoneNumberId,
      servicio,
      fecha,
      duracionMinInput,
    });

    assertNotAborted(signal);

    if (!resultado.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.motivo,
        data: { detalle: resultado.detalle },
      };
    }

    const data = {
      disponible: resultado.hayHueco,
      especialista: resultado.especialistaResuelto,
      duracionMin: resultado.duracionMin,
      horariosTomados: resultado.horariosTomados,
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.consultar_disponibilidad_especialista },
    };
  }

  private async agendarCitaEspecialistaAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const phoneNumberId = request.conversation?.phoneNumberId ?? params.phoneNumberId ?? "";
    const telefonoCliente = request.conversation?.telefonoCliente ?? params.telefonoCliente ?? "";
    const servicio = params.servicio ?? "";
    const fecha = params.fecha ?? "";
    const hora = params.hora ?? "";
    const nombreCliente = params.nombreCliente ?? "";
    // Fase 2b (bug crítico real, defense-in-depth) — se transporta tal cual
    // llegue en params (el grafo de Flow lo fija estático en "true" en el
    // nodo act-agendar, alcanzable solo tras la clasificación 'confirma');
    // la verificación real ocurre en el adaptador
    // (especialistas-flow-adaptador.ts::agendarCitaEspecialista), no acá.
    const confirmado = params.confirmado === "true";
    const duracionMinInput = params.duracionMin ? num(params.duracionMin, 0) : undefined;

    if (!phoneNumberId || !telefonoCliente || !servicio || !fecha || !hora || !nombreCliente) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_appointment_params",
      };
    }

    assertNotAborted(signal);
    const owned = await this.deps.authorizer.assertPhoneNumberOwnedByTenant(request.tenantId, phoneNumberId);
    if (!owned) return this.tenantRejected();
    assertNotAborted(signal);

    const resultado = await this.deps.agendarCitaEspecialista(this.deps.supabase, {
      phoneNumberId,
      telefonoCliente,
      servicio,
      fecha,
      hora,
      nombreCliente,
      confirmado,
      duracionMinInput,
    });

    assertNotAborted(signal);

    if (!resultado.ok) {
      if (resultado.motivo === "ocupado") {
        return {
          success: false,
          classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
          error: "ocupado",
          data: { ocupado: true, horariosTomados: resultado.horariosTomados },
        };
      }
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.motivo,
        data: { detalle: resultado.detalle },
      };
    }

    const data: Record<string, unknown> = {
      citaId: resultado.cita.id,
      status: resultado.estado,
      especialista: resultado.especialista.nombre,
      servicio: resultado.cita.servicio,
      inicio: resultado.cita.inicio,
      fin: resultado.cita.fin,
      effectId: request.effectId,
    };

    const evidenceError = criticalEvidenceMissing("agendar_cita_especialista", data);
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
      externalReference: `cita_especialista:${resultado.cita.id}`,
      metadata: { operationClass: OPERATION_CLASS.agendar_cita_especialista },
    };
  }

  private async cancelarCitaEspecialistaAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const phoneNumberId = request.conversation?.phoneNumberId ?? params.phoneNumberId ?? "";
    const telefonoCliente = request.conversation?.telefonoCliente ?? params.telefonoCliente ?? "";
    const confirmado = params.confirmado === "true";

    if (!phoneNumberId || !telefonoCliente) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_cancel_params",
      };
    }

    // Fase 1 (Blocker #4) — citaId es OPCIONAL: sin él, cancela la cita
    // activa más próxima (comportamiento sin cambios). Con él (cuando la
    // clienta tenía varias citas y ya identificó cuál), cancela ESA
    // puntualmente -- ver citaPorIdYCliente en el adaptador para la
    // verificación real de que esa cita es de esta clienta.
    //
    // Rediseño de agendamiento (autorizado) — también acepta `citaObjetivoId`
    // (el nombre real de la variable que ya deja ai-identificar-unica/
    // ai-identificar-seleccionada en este mismo flow): antes, el nodo
    // ai-proponer-cancelar (propose_action, eliminado) hacía este mismo
    // mapeo trivial vía una llamada a Claude sin ninguna interpretación
    // real -- mismo criterio exacto que ya se aplicó en agendar (ver
    // daniela-agendar-cita.flow.ts). `citaId` explícito sigue teniendo
    // prioridad si algún día ambos coexistieran.
    const citaIdRaw = params.citaId ?? params.citaObjetivoId;
    let citaId: number | undefined;
    if (citaIdRaw !== undefined) {
      citaId = Number(citaIdRaw);
      if (!Number.isFinite(citaId)) {
        return {
          success: false,
          classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
          error: "invalid_cita_id",
        };
      }
    }

    assertNotAborted(signal);
    const owned = await this.deps.authorizer.assertPhoneNumberOwnedByTenant(request.tenantId, phoneNumberId);
    if (!owned) return this.tenantRejected();
    assertNotAborted(signal);

    const resultado = await this.deps.cancelarCitaEspecialista(this.deps.supabase, {
      phoneNumberId,
      telefonoCliente,
      confirmado,
      citaId,
    });

    assertNotAborted(signal);

    if (!resultado.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.motivo,
        data: { detalle: resultado.detalle },
      };
    }

    const data = {
      citaId: resultado.cita.id,
      cancelada: true,
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.cancelar_cita_especialista },
    };
  }

  /**
   * Fase 1 (Blocker #4) — lista TODAS las citas activas reales de esta
   * clienta (no solo la más próxima). Solo lectura, nunca cancela ni
   * modifica nada.
   */
  private async consultarCitasActivasEspecialistaAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const phoneNumberId = request.conversation?.phoneNumberId ?? params.phoneNumberId ?? "";
    const telefonoCliente = request.conversation?.telefonoCliente ?? params.telefonoCliente ?? "";

    if (!phoneNumberId || !telefonoCliente) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_query_params",
      };
    }

    assertNotAborted(signal);
    const owned = await this.deps.authorizer.assertPhoneNumberOwnedByTenant(request.tenantId, phoneNumberId);
    if (!owned) return this.tenantRejected();
    assertNotAborted(signal);

    const resultado = await this.deps.consultarCitasActivasEspecialista(this.deps.supabase, {
      phoneNumberId,
      telefonoCliente,
    });

    assertNotAborted(signal);

    const data = {
      cantidadCitas: resultado.cantidad,
      citasActivas: resultado.citas.map((c) => ({ id: c.id, servicio: c.servicio, inicio: c.inicio })),
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.consultar_citas_activas_especialista },
    };
  }

  /**
   * Rediseño de agendamiento (autorizado) — lista real de horarios
   * disponibles (reemplaza el booleano de consultarDisponibilidadEspecialista
   * para el nuevo modelo). Solo lectura, nunca escribe nada.
   */
  private async listarHorariosDisponiblesEspecialistaAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const phoneNumberId = request.conversation?.phoneNumberId ?? params.phoneNumberId ?? "";
    const servicio = params.servicio ?? "";
    const fecha = params.fecha ?? "";
    const duracionMinInput = params.duracionMin ? num(params.duracionMin, 0) : undefined;

    if (!phoneNumberId || !servicio || !fecha) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_availability_params",
      };
    }

    assertNotAborted(signal);
    const owned = await this.deps.authorizer.assertPhoneNumberOwnedByTenant(request.tenantId, phoneNumberId);
    if (!owned) return this.tenantRejected();
    assertNotAborted(signal);

    const resultado = await this.deps.listarHorariosDisponiblesEspecialista(this.deps.supabase, {
      phoneNumberId,
      servicio,
      fecha,
      duracionMinInput,
    });

    assertNotAborted(signal);

    if (!resultado.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.motivo,
        data: { detalle: resultado.detalle },
      };
    }

    const data = {
      horariosDisponibles: resultado.horarios,
      horariosDisponiblesTexto: formatearListaHorarios(resultado.horarios),
      cantidadHorarios: resultado.horarios.length,
      especialista: resultado.especialistaResuelto,
      duracionMin: resultado.duracionMin,
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.listar_horarios_disponibles_especialista },
    };
  }

  /**
   * Rediseño de agendamiento (autorizado) — ÚNICA función que decide qué
   * hora quedó seleccionada. Lee `horariosDisponibles` directo de
   * `request.payload` (no de `params`: mergeParams descarta arrays, ver
   * mergeParams arriba) -- es la lista REAL que ya dejó la acción de
   * listar, nunca un valor que la IA pueda sustituir. resolverSeleccionHorario
   * es pura (sin I/O); esto es solo el wrapper de acción del mismo patrón
   * que el resto de acciones de este archivo.
   *
   * MISMO nodo/actionType se usa en DOS puntos del grafo de agendar (ver
   * daniela-agendar-cita.flow.ts): (1) camino rápido, justo tras listar
   * horarios, con la 'hora' ya extraída del primer mensaje (Parte 12: si no
   * calza EXACTO con la lista real, se descarta en silencio -- nunca
   * bloquea, solo no hay atajo); (2) tras que la clienta responda a la
   * pregunta abierta de selección, con lo que interpretó ai-interpretar-
   * seleccion (seleccionTipo/seleccionIndice/seleccionHora). Se distinguen
   * solo por qué variables existen en `state` en ese momento -- ninguna
   * config especial por nodo, ninguna interpolación necesaria.
   */
  private async resolverSeleccionHorarioAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
  ): Promise<EffectDispatchResult> {
    const horariosDisponibles = Array.isArray(request.payload.horariosDisponibles)
      ? (request.payload.horariosDisponibles as unknown[]).filter((h): h is string => typeof h === "string")
      : [];

    const tieneSeleccionExplicita =
      params.seleccionTipo !== undefined || params.seleccionIndice !== undefined || params.seleccionHora !== undefined;

    const resultado = tieneSeleccionExplicita
      ? resolverSeleccionHorario({
          horariosDisponibles,
          seleccionTipo: params.seleccionTipo,
          seleccionIndice: params.seleccionIndice !== undefined ? num(params.seleccionIndice, NaN) : undefined,
          seleccionHora: params.seleccionHora,
        })
      : params.hora
        ? resolverSeleccionHorario({ horariosDisponibles, seleccionTipo: "time", seleccionHora: params.hora })
        : resolverSeleccionHorario({ horariosDisponibles });

    if (!resultado.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.motivo,
        data: { detalle: resultado.detalle, horariosDisponiblesTexto: formatearListaHorarios(horariosDisponibles) },
      };
    }

    const data = { hora: resultado.hora, effectId: request.effectId };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.resolver_seleccion_horario },
    };
  }

  /**
   * Cierre final Daniela (autorizado) — catálogo REAL de servicios, leído
   * de `baseConocimiento` (ya sembrada en state.variables por el
   * orchestrator, igual que `hoy`). Pura respecto a Supabase -- no hace
   * ninguna consulta, solo parsea el texto real del negocio. Ver
   * parseServiciosDesdeBaseConocimiento para el porqué de no inventar/
   * hardcodear nada acá.
   */
  private async listarServiciosEspecialistaAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
  ): Promise<EffectDispatchResult> {
    const baseConocimiento = params.baseConocimiento ?? "";
    const servicios = parseServiciosDesdeBaseConocimiento(baseConocimiento);
    // Pestañas nunca tiene un precio único real (tiene ~20 sub-precios) y
    // nunca se agenda por autoservicio -- se agrega visible en el catálogo
    // (precio 0 = sentinel, nunca se muestra: el grafo transfiere antes de
    // llegar a msg-precio-servicio, ver cond-servicio-pestanas). Solo se
    // agrega si el tenant realmente tiene pestañas configuradas.
    if (esMencionPestanas(baseConocimiento)) {
      servicios.push({ nombre: "Pestañas", precio: 0 });
    }

    const data = {
      serviciosDisponibles: servicios,
      serviciosDisponiblesTexto: formatearListaServicios(servicios),
      cantidadServicios: servicios.length,
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.listar_servicios_especialista },
    };
  }

  /**
   * Cierre final Daniela (autorizado) — ÚNICA función que decide qué
   * servicio quedó realmente seleccionado. Lee `serviciosDisponibles`
   * directo de `request.payload` (no de `params`: mergeParams descarta
   * arrays/objetos, ver mergeParams arriba) -- es la lista REAL que ya dejó
   * listar_servicios_especialista, nunca un valor que la IA pueda
   * sustituir. Mismo nodo/actionType se usa en DOS puntos del grafo
   * (camino rápido con el hint del primer mensaje, y tras la pregunta
   * abierta) -- mismo patrón exacto que resolver_seleccion_horario.
   */
  private async resolverSeleccionServicioAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
  ): Promise<EffectDispatchResult> {
    const serviciosRaw = Array.isArray(request.payload.serviciosDisponibles) ? request.payload.serviciosDisponibles : [];
    const servicios = serviciosRaw.filter(
      (s): s is { nombre: string; precio: number } =>
        typeof s === "object" && s !== null && typeof (s as { nombre?: unknown }).nombre === "string",
    );

    const tieneSeleccionExplicita =
      params.seleccionTipo !== undefined || params.seleccionIndice !== undefined || params.seleccionNombre !== undefined;

    const resultado = tieneSeleccionExplicita
      ? resolverSeleccionServicio({
          servicios,
          seleccionTipo: params.seleccionTipo,
          seleccionIndice: params.seleccionIndice !== undefined ? num(params.seleccionIndice, NaN) : undefined,
          seleccionNombre: params.seleccionNombre,
        })
      : params.servicio
        ? resolverSeleccionServicio({ servicios, seleccionTipo: "nombre", seleccionNombre: params.servicio })
        : resolverSeleccionServicio({ servicios });

    if (!resultado.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.motivo,
        data: { detalle: resultado.detalle, serviciosDisponiblesTexto: formatearListaServicios(servicios) },
      };
    }

    const data = {
      servicio: resultado.nombre,
      precio: resultado.precio,
      precioTexto: formatearPrecioCop(resultado.precio),
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.resolver_seleccion_servicio },
    };
  }

  /**
   * Rediseño de agendamiento (autorizado) — validación determinista de
   * fecha (parse-fecha-colombia.ts), mismo criterio que
   * validarServicioEspecialistaAction: success:false si no se pudo
   * convertir a una fecha real, para que el grafo pueda volver a preguntar
   * en vez de dejar pasar texto libre hacia la lógica de disponibilidad
   * (hallazgo 🔴 de la auditoría -- "el sábado" nunca debe llegar a
   * ventanaAtencion sin pasar por acá primero). `hoy` viene sembrado en
   * state.variables por el orchestrator, igual que ya lo usa ai-extraer.
   *
   * Reutilizado en DOS flows con nombres de variable distintos (agendar:
   * `fecha`; reagendar: `nuevaFechaTexto`, ver daniela-reagendar-cita.flow.ts)
   * -- lee cualquiera de los dos y escribe AMBOS nombres de salida
   * (`fecha`/`nuevaFecha`) para que cada flow encuentre el suyo sin
   * necesitar una segunda función ni ningún nodo AI de mapeo.
   */
  private async validarFechaEspecialistaAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
  ): Promise<EffectDispatchResult> {
    const fecha = params.fecha ?? params.nuevaFechaTexto ?? "";
    const hoy = params.hoy ?? "";

    if (!fecha || !hoy) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_date_params",
      };
    }

    const resultado = parseFechaColombia(fecha, hoy);

    if (!resultado.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.kind,
        data: { detalle: resultado.message },
      };
    }

    const data = { fecha: resultado.fecha, nuevaFecha: resultado.fecha, effectId: request.effectId };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.validar_fecha_especialista },
    };
  }

  /**
   * Fase 1 (Blocker #5) — mueve (reagenda) una cita real existente. citaId
   * es SIEMPRE requerido (a diferencia de cancelar, acá no hay "la más
   * próxima" implícita -- siempre se mueve una cita puntual ya identificada
   * en el flow). Ver moverCitaEspecialista en el adaptador para la
   * estrategia atómica real (UPDATE sobre la misma fila, constraint
   * EXCLUDE, nunca cancelar+crear).
   */
  private async moverCitaEspecialistaAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const phoneNumberId = request.conversation?.phoneNumberId ?? params.phoneNumberId ?? "";
    const telefonoCliente = request.conversation?.telefonoCliente ?? params.telefonoCliente ?? "";
    const confirmado = params.confirmado === "true";
    // Rediseño de agendamiento (autorizado) — mismo criterio que
    // cancelarCitaEspecialistaAction: acepta también los nombres reales que
    // ya deja este flow (citaObjetivoId de ai-identificar-*, nuevaFechaTexto
    // ya validada por act-validar-nueva-fecha, nuevaHoraTexto ya validada
    // por la propia pregunta con validation.kind:"hora_colombia") -- ya no
    // hace falta ai-proponer-mover (propose_action, eliminado) para este
    // mapeo trivial de nombres.
    const citaIdRaw = params.citaId ?? params.citaObjetivoId;
    const nuevaFecha = params.nuevaFecha ?? params.nuevaFechaTexto ?? "";
    const nuevaHora = params.nuevaHora ?? params.nuevaHoraTexto ?? "";

    if (!phoneNumberId || !telefonoCliente || !citaIdRaw || !nuevaFecha || !nuevaHora) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_reschedule_params",
      };
    }
    const citaId = Number(citaIdRaw);
    if (!Number.isFinite(citaId)) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "invalid_cita_id",
      };
    }

    assertNotAborted(signal);
    const owned = await this.deps.authorizer.assertPhoneNumberOwnedByTenant(request.tenantId, phoneNumberId);
    if (!owned) return this.tenantRejected();
    assertNotAborted(signal);

    const resultado = await this.deps.moverCitaEspecialista(this.deps.supabase, {
      phoneNumberId,
      telefonoCliente,
      citaId,
      nuevaFecha,
      nuevaHora,
      confirmado,
    });

    assertNotAborted(signal);

    if (!resultado.ok) {
      if (resultado.motivo === "ocupado") {
        return {
          success: false,
          classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
          error: "ocupado",
          data: { ocupado: true, horariosTomados: resultado.horariosTomados },
        };
      }
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.motivo,
        data: { detalle: resultado.detalle },
      };
    }

    const data = {
      citaId: resultado.cita.id,
      movida: true,
      servicio: resultado.cita.servicio,
      inicio: resultado.cita.inicio,
      fin: resultado.cita.fin,
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.mover_cita_especialista },
    };
  }
}
