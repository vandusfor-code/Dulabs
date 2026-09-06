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
  listarCatalogoServiciosReal,
  resolverServicioCatalogoReal,
  consultarDisponibilidadCatalogoReal,
  listarProfesionalesServicioReal,
  formatearCatalogoReal,
  formatearDuracion,
  type ServicioCatalogoReal,
} from "@/lib/catalogo-servicios-flow-adaptador";
import { resolverEscenario, type ResolverEscenarioDeps } from "@/lib/bot-escenarios/resolver";
import { nombreConocido } from "@/lib/clientes-conocidos";
import { cargarConocimientoReal, cargarEscenariosReal } from "@/lib/bot-escenarios/store";
import type { AgendamientoEnCurso } from "@/lib/bot-escenarios/tipos";
import {
  listarHorariosDisponiblesPorServicioConNylas,
  type ResultadoHorariosConNylas,
} from "@/lib/disponibilidad-servicio-nylas";
import { crearCitaConNylas } from "@/lib/reserva-servicio-nylas";
import { resolverNylasGrantIdParaTenant } from "@/lib/nylas/nylas-grant";
import {
  createNylasEventsClient,
  createNylasEventsWriteClient,
  resolveNylasApiKeyFromEnv,
} from "@/lib/nylas/nylas-client";
import { fechaColombiaDesdeIso, horaColombiaDesdeIso } from "@/lib/timezone-colombia";
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
  // AMORE (Fase 2, autorizado) — modelo ESTRUCTURADO de catálogo
  // (dulabs_servicios/dulabs_servicio_especialista), distinto del adaptador
  // de arriba (dulabs_especialistas.servicio + base_conocimiento). Ver
  // lib/catalogo-servicios-flow-adaptador.ts para el porqué. Opcionales
  // (a diferencia de los demás deps de arriba) A PROPÓSITO -- así ningún
  // fixture de test ya existente (Daniela/genéricos del Flow Engine) necesita
  // tocarse para agregar estas dos funciones nuevas; si se omiten, los
  // métodos de abajo llaman directo a la implementación real importada.
  listarCatalogoServiciosReal?: typeof listarCatalogoServiciosReal;
  consultarDisponibilidadCatalogoReal?: typeof consultarDisponibilidadCatalogoReal;
  listarProfesionalesServicioReal?: typeof listarProfesionalesServicioReal;
  // Banco de escenarios (autorizado, AMORE primer tenant) -- opcional, mismo
  // criterio de arriba: si se omite, llama directo a la implementación real
  // (lib/bot-escenarios/store.ts).
  cargarEscenariosReal?: typeof cargarEscenariosReal;
  // Base de conocimiento (autorizado, AMORE primer tenant) -- mismo criterio.
  cargarConocimientoReal?: typeof cargarConocimientoReal;
  // FASE 1 -- Agendamiento conversacional (autorizado). Mismo criterio de
  // arriba (opcionales, real por default) -- resolver.ts los necesita SOLO
  // mientras hay un agendamiento activo, para resolver especialistas reales
  // y el nombre ya conocido de la clienta sin preguntarlo de nuevo.
  cargarEspecialistas?: ResolverEscenarioDeps["cargarEspecialistas"];
  buscarNombreConocido?: ResolverEscenarioDeps["buscarNombreConocido"];
  // FASE 1 -- Agendamiento conversacional (autorizado). Todos opcionales,
  // mismo criterio de arriba (real por default; solo se inyectan mocks en
  // tests) -- NUNCA un segundo mecanismo de override para Nylas ya
  // existente en lib/nylas/*.
  listarHorariosDisponiblesPorServicioConNylas?: typeof listarHorariosDisponiblesPorServicioConNylas;
  crearCitaConNylas?: typeof crearCitaConNylas;
  resolverNylasGrantIdParaTenant?: typeof resolverNylasGrantIdParaTenant;
  resolveNylasApiKeyFromEnv?: typeof resolveNylasApiKeyFromEnv;
  createNylasEventsClient?: typeof createNylasEventsClient;
  createNylasEventsWriteClient?: typeof createNylasEventsWriteClient;
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
  // AMORE (Fase 2, autorizado) — modelo estructurado (dulabs_servicios).
  listar_catalogo_servicios: "READ",
  resolver_servicio_catalogo: "READ",
  consultar_disponibilidad_catalogo: "READ",
  listar_profesionales_servicio: "READ",
  resolver_escenario: "READ",
  // FASE 1 -- Agendamiento conversacional (autorizado).
  buscar_disponibilidad_nylas: "READ",
  crear_cita_nylas: "CRITICAL",
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

/**
 * FASE 1 -- Agendamiento conversacional (autorizado). Guard MÍNIMO: un
 * objeto plano (nunca array/string/null) es aceptable -- resolver.ts ya
 * revalida cada campo real (ids/fechas/horarios) contra catálogo/
 * elegibilidad/Nylas en cada paso, así que este guard solo evita que un
 * valor corrupto rompa el spread, nunca duplica esa validación.
 */
function esAgendamientoValido(value: unknown): value is AgendamientoEnCurso {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      case "listar_catalogo_servicios":
        return this.listarCatalogoServiciosAction(request, signal);
      case "resolver_servicio_catalogo":
        return this.resolverServicioCatalogoAction(request, params);
      case "consultar_disponibilidad_catalogo":
        return this.consultarDisponibilidadCatalogoAction(request, params, signal);
      case "listar_profesionales_servicio":
        return this.listarProfesionalesServicioAction(request, params, signal);
      case "resolver_escenario":
        return this.resolverEscenarioAction(request, params, signal);
      case "buscar_disponibilidad_nylas":
        return this.buscarDisponibilidadNylasAction(request, signal);
      case "crear_cita_nylas":
        return this.crearCitaNylasAction(request, signal);
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

  // --- AMORE (Fase 2, autorizado): modelo estructurado de catálogo -------
  // Ver lib/catalogo-servicios-flow-adaptador.ts para el porqué de un
  // adaptador nuevo en vez de reutilizar listar_servicios_especialista/
  // resolver_seleccion_servicio (esos leen dulabs_especialistas.servicio +
  // base_conocimiento, un modelo distinto que no representa elegibilidad
  // N:N por servicio). request.tenantId ya es la fuente de verdad de tenant
  // -- a diferencia de las acciones de arriba, estas no reciben ni
  // necesitan un phoneNumberId separado que autorizar.

  private async listarCatalogoServiciosAction(
    request: EffectDispatchRequest,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    assertNotAborted(signal);
    const servicios = await (this.deps.listarCatalogoServiciosReal ?? listarCatalogoServiciosReal)(this.deps.supabase, request.tenantId);
    assertNotAborted(signal);

    const data = {
      catalogoDisponible: servicios,
      catalogoTexto: formatearCatalogoReal(servicios),
      cantidadCatalogo: servicios.length,
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.listar_catalogo_servicios },
    };
  }

  /**
   * ÚNICA función que decide qué servicio real quedó seleccionado -- lee
   * `catalogoDisponible` de request.payload (no de params: mergeParams
   * descarta arrays, mismo motivo exacto que resolverSeleccionServicioAction
   * de arriba), y acepta tanto una selección explícita (índice/nombre, tras
   * mostrar la lista) como el hint `servicio` del primer mensaje (camino
   * rápido, mismo criterio que act-resolver-seleccion-inicial-servicio de
   * Daniela).
   */
  private async resolverServicioCatalogoAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
  ): Promise<EffectDispatchResult> {
    const catalogoRaw = Array.isArray(request.payload.catalogoDisponible) ? request.payload.catalogoDisponible : [];
    const catalogo = catalogoRaw.filter(
      (s): s is ServicioCatalogoReal =>
        typeof s === "object" && s !== null && typeof (s as { nombre?: unknown }).nombre === "string",
    );

    const tieneSeleccionExplicita =
      params.seleccionTipo !== undefined || params.seleccionIndice !== undefined || params.seleccionNombre !== undefined;

    const resultado = tieneSeleccionExplicita
      ? resolverServicioCatalogoReal({
          servicios: catalogo,
          seleccionTipo: params.seleccionTipo,
          seleccionIndice: params.seleccionIndice !== undefined ? num(params.seleccionIndice, NaN) : undefined,
          seleccionNombre: params.seleccionNombre,
        })
      : params.servicio
        ? resolverServicioCatalogoReal({ servicios: catalogo, seleccionTipo: "nombre", seleccionNombre: params.servicio })
        : resolverServicioCatalogoReal({ servicios: catalogo });

    if (!resultado.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: resultado.motivo,
        data: { detalle: resultado.detalle, catalogoTexto: formatearCatalogoReal(catalogo) },
      };
    }

    const data = {
      servicioId: resultado.servicio.id,
      servicio: resultado.servicio.nombre,
      precio: resultado.servicio.precio,
      precioTexto: formatearPrecioCop(resultado.servicio.precio),
      duracionMin: resultado.servicio.duracionMin,
      duracionTexto: formatearDuracion(resultado.servicio.duracionMin),
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.resolver_servicio_catalogo },
    };
  }

  /**
   * Envoltorio del Flow Engine sobre listarHorariosDisponiblesPorServicio
   * (EL MISMO resolver que ya usa el portal público de reservas) -- ninguna
   * regla de horario/elegibilidad/bloqueo se reimplementa acá.
   */
  private async consultarDisponibilidadCatalogoAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const servicioId = params.servicioId ?? "";
    const fecha = params.fecha ?? "";
    if (!servicioId || !fecha) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_availability_params",
      };
    }

    assertNotAborted(signal);
    const resultado = await (this.deps.consultarDisponibilidadCatalogoReal ?? consultarDisponibilidadCatalogoReal)(this.deps.supabase, {
      idTenant: request.tenantId,
      servicioId,
      fecha,
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

    const hayDisponibilidad = resultado.especialistas.some((e) => e.horarios.length > 0);
    const data = {
      disponibilidadTexto: resultado.texto,
      hayDisponibilidad,
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.consultar_disponibilidad_catalogo },
    };
  }

  /**
   * AMORE (autorizado) — profesionales reales elegibles para un servicio ya
   * resuelto (params.servicioId, viene de resolver_servicio_catalogo).
   * Envoltorio de solo lectura sobre resolverEspecialistasElegiblesParaServicio
   * -- NUNCA se usa para reservar, solo para responder "¿quién hace X?".
   */
  private async listarProfesionalesServicioAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    const servicioId = params.servicioId ?? "";
    if (!servicioId) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "missing_servicioId",
      };
    }

    assertNotAborted(signal);
    const resultado = await (this.deps.listarProfesionalesServicioReal ?? listarProfesionalesServicioReal)(
      this.deps.supabase,
      request.tenantId,
      servicioId,
    );
    assertNotAborted(signal);

    const data = {
      profesionales: resultado.profesionales,
      profesionalesTexto: resultado.profesionales.length > 0 ? resultado.profesionales.join(", ") : "",
      cantidadProfesionales: resultado.profesionales.length,
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.listar_profesionales_servicio },
    };
  }

  /**
   * Banco de escenarios (autorizado, AMORE primer tenant) -- único punto de
   * entrada al Flow Engine para lib/bot-escenarios/resolver.ts. Lee el
   * mensaje actual y el contexto conversacional directo de request.payload
   * (el mismo state.variables acumulado que el Engine ya auto-mergea, ver
   * mergeParams arriba) -- NUNCA de params estáticos del nodo, que no tienen
   * sentido para esta acción (siempre la misma, sin configuración por nodo).
   * Siempre emite las 6 claves de contexto (aunque vengan vacías) para que
   * el merge aditivo de variables del Engine pueda de verdad LIMPIAR un
   * contexto viejo (portal/transfer) en vez de dejarlo pegado para siempre.
   */
  private async resolverEscenarioAction(
    request: EffectDispatchRequest,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    assertNotAborted(signal);
    const mensaje = params.mensajeActual?.trim() || params.__firstMessageText?.trim() || "";
    const turno = num(params.__turnoEscenario, 0);
    // ultimasOpcionesIds/agendamiento son array/objeto -- mergeParams (arriba)
    // descarta arrays/objetos al armar `params`, mismo motivo exacto por el
    // que catalogoDisponible se lee de request.payload directo en otras
    // acciones de este archivo. Nunca de `params`.
    const ultimasOpcionesIdsRaw = request.payload.ultimasOpcionesIds;
    const ultimasOpcionesIds = Array.isArray(ultimasOpcionesIdsRaw)
      ? ultimasOpcionesIdsRaw.filter((v): v is string => typeof v === "string")
      : [];
    // FASE 1 -- Agendamiento conversacional (autorizado). `agendamiento` es
    // el acumulador completo (objeto anidado) -- viaja tal cual en
    // state.variables (ver flow-engine.ts: un nodo "action" mergea
    // event.data SIN allowlist, a diferencia de un nodo "ai" que solo copia
    // outputVariables declaradas), así que se lee/escribe entero, nunca
    // campo por campo.
    const agendamiento = esAgendamientoValido(request.payload.agendamiento) ? request.payload.agendamiento : undefined;

    const resultado = await resolverEscenario({
      supabase: this.deps.supabase,
      tenantId: request.tenantId,
      mensaje,
      contexto: {
        ultimoServicioId: params.ultimoServicioId || undefined,
        ultimoServicioNombre: params.ultimoServicioNombre || undefined,
        ultimoServicioBId: params.ultimoServicioBId || undefined,
        ultimoServicioBNombre: params.ultimoServicioBNombre || undefined,
        ultimaCategoria: params.ultimaCategoria || undefined,
        ultimaAccionSugerida: params.ultimaAccionSugerida || undefined,
        ultimasOpcionesIds: ultimasOpcionesIds.length > 0 ? ultimasOpcionesIds : undefined,
        agendamiento,
      },
      turno,
      telefonoCliente: request.conversation?.telefonoCliente,
      deps: {
        cargarEscenarios: this.deps.cargarEscenariosReal ?? cargarEscenariosReal,
        // Reutiliza EXACTAMENTE los mismos deps opcionales inyectables que ya
        // usan listar_catalogo_servicios/listar_profesionales_servicio arriba
        // -- nunca un segundo mecanismo de override para los mismos datos.
        cargarCatalogo: this.deps.listarCatalogoServiciosReal,
        cargarProfesionales: this.deps.listarProfesionalesServicioReal,
        cargarConocimiento: this.deps.cargarConocimientoReal,
        cargarEspecialistas: this.deps.cargarEspecialistas,
        buscarNombreConocido: this.deps.buscarNombreConocido,
      },
    });
    assertNotAborted(signal);

    // Revisión (autorizada, secciones 15/16/28-C) -- nombre YA conocido de
    // la clienta (dulabs_clientes_conocidos), disponible para un saludo
    // OCASIONAL y natural cuando vuelve a escribir ("Hola, Mariana, qué
    // lindo volver a tenerte por aquí") -- nunca para usarlo en cada
    // respuesta (eso lo decide el propio nodo IA vía su instrucción, ver
    // amore-router.flow.ts). Solo se consulta en el PRIMER turno de la
    // ejecución (evita una lectura de Supabase en cada mensaje) -- el
    // propio agendamiento hace su PROPIA consulta, independiente, cuando
    // de verdad necesita el nombre para reservar (mucho más adelante en la
    // conversación, nunca en el turno 0). Genérico para cualquier tenant
    // que use resolver_escenario, no solo AMORE.
    let nombreClienteConocido = "";
    if (turno === 0 && request.conversation?.telefonoCliente) {
      const buscarNombreConocido = this.deps.buscarNombreConocido ?? nombreConocido;
      nombreClienteConocido =
        (await buscarNombreConocido(this.deps.supabase, `whatsapp-qr:${request.tenantId}`, request.conversation.telefonoCliente)) ?? "";
    }

    const data = {
      escenarioCodigo: resultado.escenarioCodigo,
      modo: resultado.modo,
      respuestaTexto: resultado.respuestaTexto ?? "",
      requiereIA: String(resultado.requiereIA),
      instruccionIA: resultado.instruccionIA ?? "",
      datosIA: resultado.datosIA ?? [],
      // Base de conocimiento (autorizado) -- SIEMPRE una clave separada de
      // datosIA, nunca fusionada (regla explícita: precio/duración/categoría
      // son hechos confirmados; esto es explicación general, con su fuente
      // declarada). Solo presente cuando modo=ai y hay servicio(s) involucrados.
      conocimientoGeneral: resultado.conocimientoGeneral ?? [],
      // FASE — refinamiento conversacional (autorizado) -- señal MÍNIMA para
      // que el nodo IA sepa si ya saludó, sin ninguna arquitectura de memoria
      // nueva: `turno` YA es el contador real de vueltas de esta MISMA
      // ejecución activa (dulabs_flow_executions -- una ejecución nueva
      // siempre arranca en turno=0; solo termina/reinicia cuando el flow
      // llega a un nodo end, ej. transferencia a humano). Genérico para
      // cualquier tenant que use resolver_escenario, no solo AMORE.
      esPrimerTurno: turno === 0,
      nombreClienteConocido,
      ultimoServicioId: resultado.contexto.ultimoServicioId ?? "",
      ultimoServicioNombre: resultado.contexto.ultimoServicioNombre ?? "",
      ultimoServicioBId: resultado.contexto.ultimoServicioBId ?? "",
      ultimoServicioBNombre: resultado.contexto.ultimoServicioBNombre ?? "",
      ultimaCategoria: resultado.contexto.ultimaCategoria ?? "",
      ultimaAccionSugerida: resultado.contexto.ultimaAccionSugerida ?? "",
      ultimasOpcionesIds: resultado.contexto.ultimasOpcionesIds ?? [],
      // FASE 1 -- objeto anidado completo, ver comentario arriba sobre por
      // qué un nodo "action" puede pasarlo tal cual (a diferencia de un
      // outputVariable declarado en un nodo "ai").
      agendamiento: resultado.contexto.agendamiento ?? null,
      __turnoEscenario: turno + 1,
      effectId: request.effectId,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.resolver_escenario },
    };
  }

  /**
   * FASE 1 -- Agendamiento conversacional (autorizado). Wrapper FINO: la
   * lógica real vive en lib/disponibilidad-servicio-nylas.ts (sin cambios).
   * Se llega acá SOLO cuando decidirSiguientePasoAgendamiento (resolver.ts)
   * ya validó que hay servicio+fecha reales -- este nodo consulta Nylas y
   * SIEMPRE devuelve success:true (nunca hace fallar la ejecución): el
   * resultado (opciones reales, sin cupo, o error técnico) se comunica vía
   * modo="ai" + instruccionIA/datosIA para que ai-generar-respuesta (el
   * MISMO nodo IA de siempre) lo redacte con naturalidad -- sección 16 del
   * pedido: nunca se corta la conversación por un fallo de disponibilidad.
   */
  private async buscarDisponibilidadNylasAction(
    request: EffectDispatchRequest,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    assertNotAborted(signal);
    const agendamientoRaw = request.payload.agendamiento;
    const agendamientoEntrante = esAgendamientoValido(agendamientoRaw) ? agendamientoRaw : undefined;
    // Revisión (autorizada) -- (re)consultar disponibilidad SIEMPRE limpia
    // una selección puntual previa (horario/profesional ya elegidos,
    // esperando confirmación): si esos campos llegan poblados es porque
    // venimos de un intento de reserva que acaba de fallar (ver
    // amore-router.flow.ts: act-crear-cita-nylas --aiFailure-->
    // msg-reserva-no-completada --> este nodo) -- esa selección ya no es
    // válida (el horario pudo ocuparse, o el intento fue rechazado por otro
    // motivo real) y NUNCA debe sobrevivir junto a las opciones frescas de
    // abajo, o decidirSiguientePasoAgendamiento quedaría atascado pidiendo
    // confirmar un horario obsoleto en vez de mostrar las opciones nuevas.
    const agendamiento: AgendamientoEnCurso | undefined = agendamientoEntrante
      ? {
          ...agendamientoEntrante,
          horarioSeleccionadoISO: undefined,
          especialistaSeleccionadaId: undefined,
          especialistaSeleccionadaNombre: undefined,
          esperandoConfirmacion: undefined,
        }
      : undefined;

    // `extra` lleva SOLO el flag plano que Claim Security necesita para
    // reconocer que Nylas de verdad respondió esta consulta (ver
    // action-capabilities.ts: verifiesOnSuccess: ["appointment.available"],
    // outputVariables: ["disponibilidadConsultada"]) -- nunca afirma que hay
    // cupo, solo que la consulta real se hizo; el propio datosIA (vacío o
    // no) es lo que decide qué puede decir la IA con honestidad.
    const responderNaturalmente = (
      instruccionIA: string,
      datosIA: unknown,
      agendamientoActualizado: AgendamientoEnCurso | undefined,
      extra?: Record<string, unknown>,
    ): EffectDispatchResult => {
      const data = {
        modo: "ai",
        instruccionIA,
        datosIA,
        conocimientoGeneral: [],
        agendamiento: agendamientoActualizado ?? null,
        effectId: request.effectId,
        ...extra,
      };
      return {
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data,
        appliedResult: data,
        rawResult: data,
        metadata: { operationClass: OPERATION_CLASS.buscar_disponibilidad_nylas },
      };
    };

    // Defensivo -- decidirSiguientePasoAgendamiento solo emite este modo con
    // ambos ya presentes; nunca debería ocurrir en producción.
    if (!agendamiento || !agendamiento.servicioId || !agendamiento.fechaISO) {
      return responderNaturalmente(
        "Pregúntale de nuevo, de forma natural, qué servicio y para qué día desea la cita.",
        [],
        agendamiento,
      );
    }
    const servicioId = agendamiento.servicioId;
    const fechaISO = agendamiento.fechaISO;

    const grantId = (this.deps.resolverNylasGrantIdParaTenant ?? resolverNylasGrantIdParaTenant)(request.tenantId);
    const apiKey = (this.deps.resolveNylasApiKeyFromEnv ?? resolveNylasApiKeyFromEnv)();
    if (!grantId || !apiKey) {
      return responderNaturalmente(
        "No puedes verificar la disponibilidad real en este momento (falta la conexión con el calendario). Explícaselo con naturalidad a la clienta y ofrécele intentarlo de nuevo en un momento, sin inventar ningún horario.",
        [],
        agendamiento,
      );
    }
    const nylasClient = (this.deps.createNylasEventsClient ?? createNylasEventsClient)(apiKey);

    let resultado: ResultadoHorariosConNylas;
    try {
      resultado = await (this.deps.listarHorariosDisponiblesPorServicioConNylas ?? listarHorariosDisponiblesPorServicioConNylas)(
        this.deps.supabase,
        { idTenant: request.tenantId, servicioId, fecha: fechaISO, especialistaId: agendamiento.especialistaId },
        { nylasClient, grantId },
      );
    } catch {
      return responderNaturalmente(
        "No pudiste verificar la disponibilidad real en este momento (hubo un error técnico). Explícaselo con naturalidad a la clienta y ofrécele intentarlo de nuevo en un momento, sin inventar ningún horario.",
        [],
        agendamiento,
      );
    }
    assertNotAborted(signal);

    if (!resultado.ok) {
      if (resultado.motivo === "sin_especialistas_habilitados") {
        // La profesional mencionada no atiende este servicio (o ninguna
        // está habilitada todavía) -- se limpia la selección puntual para
        // que la clienta pueda elegir otra sin quedar atascada.
        return responderNaturalmente(
          "La profesional mencionada no atiende ese servicio (o ninguna profesional está habilitada todavía). Explícalo con naturalidad y pregunta si desea que busques con otra profesional o prefiere otro servicio.",
          [],
          { ...agendamiento, especialistaId: undefined, especialistaNombre: undefined },
        );
      }
      return responderNaturalmente(
        "Ese servicio ya no está disponible. Discúlpate con naturalidad y pregunta si desea otro servicio.",
        [],
        { ...agendamiento, servicioId: undefined, servicioNombre: undefined, duracionMin: undefined },
      );
    }

    const disponibles = resultado.especialistas.filter((e) => e.estado === "ok" && e.horarios.length > 0);
    const todosNoConfirmados = resultado.especialistas.length > 0 && resultado.especialistas.every((e) => e.estado === "no_confirmado");

    const opciones = disponibles.flatMap((e) =>
      e.horarios.map((hhmm) => ({
        especialistaId: e.especialistaId,
        especialistaNombre: e.nombre,
        horaTexto: hhmm,
        horaISO: `${fechaISO}T${hhmm}:00-05:00`,
      })),
    );

    const agendamientoActualizado: AgendamientoEnCurso = {
      ...agendamiento,
      opcionesOfrecidas: opciones.length > 0 ? opciones : undefined,
    };

    if (opciones.length === 0) {
      if (todosNoConfirmados) {
        return responderNaturalmente(
          "No pudiste confirmar la disponibilidad real en este momento para ninguna profesional. Explícaselo con naturalidad a la clienta y ofrécele intentarlo de nuevo en un momento, o darle el enlace del portal si prefiere revisar ella misma, sin inventar ningún horario.",
          [{ servicio: agendamiento.servicioNombre ?? null, fecha: fechaISO }],
          agendamientoActualizado,
        );
      }
      return responderNaturalmente(
        "No hay cupo real disponible para ese servicio ese día con ninguna profesional elegible. Explícaselo con naturalidad y pregúntale si quiere que busques otro día.",
        [{ servicio: agendamiento.servicioNombre ?? null, fecha: fechaISO }],
        agendamientoActualizado,
        { disponibilidadConsultada: true },
      );
    }

    return responderNaturalmente(
      "Presenta con naturalidad las opciones REALES de datosIA (profesional + hora) para que la clienta elija -- nunca inventes ni ofrezcas una hora que no esté ahí. Si hay muchas, resume las más cercanas y ofrece contar el resto si quiere.",
      opciones.map((o) => ({ profesional: o.especialistaNombre, hora: o.horaTexto })),
      agendamientoActualizado,
      { disponibilidadConsultada: true },
    );
  }

  /**
   * FASE 1 -- Agendamiento conversacional (autorizado, revisado). Wrapper
   * FINO sobre crearCitaConNylas() (lib/reserva-servicio-nylas.ts, sin
   * cambios): esa función YA hace toda la revalidación/idempotencia/rollback
   * real. Se llega acá SOLO tras confirmación explícita ya verificada por
   * decidirSiguientePasoAgendamiento -- este wrapper nunca decide si se
   * confirma, solo ejecuta.
   *
   * Revisión (autorizada): a diferencia del diseño original de esta fase,
   * esta acción ya NO devuelve success:true en un rechazo real -- mismo
   * contrato EXACTO que agendar_cita_especialista (success:false + rama
   * aiFailure del grafo, ver amore-router.flow.ts: act-crear-cita-nylas
   * --aiFailure--> msg-reserva-no-completada --> act-buscar-disponibilidad-nylas,
   * mismo patrón que daniela-agendar-cita.flow.ts: act-agendar --aiFailure-->
   * msg-ocupado --> act-relistar-horarios). Motivo real encontrado en
   * revisión: Claim Security (capabilitiesFromVerifiedEntry,
   * external-claim-security.ts) NO filtra por outputVariables en la
   * práctica -- el filtro real y único es que el EXECUTOR nunca marque
   * success sin evidencia real (ver criticalEvidenceMissing, y el propio
   * comentario de flow-external-claim-security.test.ts). Devolver
   * success:true en un rechazo (aunque sin citaId) habría permitido que
   * CUALQUIER dispatch de esta acción, incluido un rechazo real, otorgara
   * "appointment.reserved" -- justo lo que este wrapper existe para evitar.
   */
  private async crearCitaNylasAction(
    request: EffectDispatchRequest,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    assertNotAborted(signal);
    const agendamientoRaw = request.payload.agendamiento;
    const agendamiento = esAgendamientoValido(agendamientoRaw) ? agendamientoRaw : undefined;

    const rechazar = (motivo: string, detalle: string): EffectDispatchResult => ({
      success: false,
      classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
      error: motivo,
      data: { detalle },
    });

    // Defensivo -- decidirSiguientePasoAgendamiento solo emite este modo con
    // TODO esto ya presente y una confirmación explícita ya recibida.
    if (
      !agendamiento ||
      !agendamiento.servicioId ||
      !agendamiento.horarioSeleccionadoISO ||
      !agendamiento.especialistaSeleccionadaId ||
      !agendamiento.especialistaSeleccionadaNombre ||
      !agendamiento.nombreCliente
    ) {
      return rechazar("datos_incompletos", "Faltan datos reales del agendamiento para poder reservar.");
    }
    const servicioId = agendamiento.servicioId;
    const especialistaId = agendamiento.especialistaSeleccionadaId;
    const horarioSeleccionadoISO = agendamiento.horarioSeleccionadoISO;
    const nombreCliente = agendamiento.nombreCliente;

    const grantId = (this.deps.resolverNylasGrantIdParaTenant ?? resolverNylasGrantIdParaTenant)(request.tenantId);
    const apiKey = (this.deps.resolveNylasApiKeyFromEnv ?? resolveNylasApiKeyFromEnv)();
    if (!grantId || !apiKey) {
      return rechazar("sin_conexion_nylas", "No hay conexión configurada con el calendario en este momento.");
    }
    const nylasReadClient = (this.deps.createNylasEventsClient ?? createNylasEventsClient)(apiKey);
    const nylasWriteClient = (this.deps.createNylasEventsWriteClient ?? createNylasEventsWriteClient)(apiKey);
    const telefonoCliente = request.conversation?.telefonoCliente ?? null;

    // Idempotencia real (lib/idempotencia-reserva.ts, reutilizada TAL CUAL
    // dentro de crearCitaConNylas) -- atada a este effect puntual, así un
    // reintento genuino del mismo efecto nunca duplica la cita.
    const idempotencyKey = `agendamiento:${request.executionRowId}:${request.effectId}`;

    let resultado;
    try {
      resultado = await (this.deps.crearCitaConNylas ?? crearCitaConNylas)(
        this.deps.supabase,
        {
          idTenant: request.tenantId,
          servicioId,
          especialistaId,
          inicio: new Date(horarioSeleccionadoISO),
          nombreCliente,
          telefonoCliente,
          idempotencyKey,
        },
        { nylasReadClient, nylasWriteClient, grantId },
      );
    } catch {
      return rechazar("error_tecnico", "Hubo un error técnico real al intentar reservar.");
    }
    assertNotAborted(signal);

    if (!resultado.ok) {
      return rechazar(resultado.motivo, resultado.detalle);
    }

    const agendamientoCompletado: AgendamientoEnCurso = { ...agendamiento, completado: true };
    const data = {
      modo: "ai",
      instruccionIA:
        "La reserva se completó de verdad -- confirma con naturalidad y calidez el servicio, la profesional, la fecha y la hora exactos de datosIA. Nunca inventes ningún otro dato.",
      datosIA: [
        {
          servicio: resultado.servicio.nombre,
          profesional: resultado.especialista.nombre,
          fecha: fechaColombiaDesdeIso(resultado.cita.inicio),
          hora: horaColombiaDesdeIso(resultado.cita.inicio),
        },
      ],
      conocimientoGeneral: [],
      agendamiento: agendamientoCompletado,
      effectId: request.effectId,
      // `citaId` es la fila real ya insertada en dulabs_citas_especialista
      // -- ver action-capabilities.ts: verifiesOnSuccess:
      // ["appointment.reserved"], outputVariables: ["citaId"]. Presente
      // SOLO en esta única rama de éxito real.
      citaId: resultado.cita.id,
    };
    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      rawResult: data,
      metadata: { operationClass: OPERATION_CLASS.crear_cita_nylas },
    };
  }
}
