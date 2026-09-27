// Business Agent 2.0, FASE 4 — utilidades de test del Action Engine (sin red).
//
// La configuración de negocio es la REAL: el Spec de prueba se compila con el compilador del Business Agent y se leen
// los params que embebió en el flow (horario, datos del cliente, política). El handler es un doble que reproduce los
// códigos y formas de respuesta REALES de InternalActionExecutor; NO afirma que Nylas u otras integraciones funcionen:
// eso no se puede verificar sin credenciales (ver reporte de FASE 4).

import type { EffectDispatchRequest, EffectDispatchResult } from "@/lib/flow/executor-types";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { businessConfigFromFlow } from "@/lib/agent-compiler/runtime/production/conversation-runtime";
import { createActionEngine, type ActionEngineEvent, type ActionExecutionContext } from "@/lib/agent-compiler/actions/engine";
import { createInMemoryActionStore, type InMemoryActionStore } from "@/lib/agent-compiler/actions/testing/in-memory-action-store";
import type { ActionExecutionStore } from "@/lib/agent-compiler/actions/store";
import type { ConversationState } from "@/lib/agent-compiler/conversation/model";
import { buildAgentRequirements } from "@/lib/agent-compiler/conversation/requirements";
import { KEY, TENANT } from "@/lib/agent-compiler/conversation/testing/harness";

export function compiledConfig(spec: BusinessAgentSpec) {
  const c = compileBusinessAgent(spec, { tenantId: TENANT });
  if (!c.success) throw new Error(`spec no compila: ${JSON.stringify(c.diagnostics)}`);
  const f = compileIRToFlowDefinition(c.ir, { tenantId: TENANT });
  if (!f.success) throw new Error("flow no compila");
  return { flow: f.flow, config: businessConfigFromFlow(f.flow) };
}

export type Responder = (req: EffectDispatchRequest, signal: AbortSignal) => Promise<EffectDispatchResult> | EffectDispatchResult;

export interface FakeHandler {
  calls: EffectDispatchRequest[];
  handler: (req: EffectDispatchRequest, signal: AbortSignal) => Promise<EffectDispatchResult>;
  on(action: string, responder: Responder): void;
}

export const ok = (data: Record<string, unknown>): EffectDispatchResult => ({ success: true, classification: "SUCCESS", data, appliedResult: data });
export const fail = (classification: EffectDispatchResult["classification"], error: string, data?: Record<string, unknown>): EffectDispatchResult => ({ success: false, classification, error, ...(data ? { data } : {}) });

/** Respuestas por defecto con las formas REALES de los handlers internos. */
export function createFakeHandler(): FakeHandler {
  const calls: EffectDispatchRequest[] = [];
  const responders = new Map<string, Responder>();
  const defaults: Record<string, Responder> = {
    buscar_disponibilidad_nylas_generico: (r) => ok({ fecha: r.payload.fecha, duracionMin: 45, horariosDisponibles: ["09:00", "10:00", "16:00", "16:30", "17:00"], disponibilidadTexto: "(texto del backend)", hayCupos: true }),
    crear_cita_nylas_generico: (r) => ok({ citaId: "evt_123", status: "confirmada", inicio: `${r.payload.fecha}T${r.payload.hora}:00-05:00`, fin: "x", reservaTexto: `Listo, tu cita de ${r.payload.servicio} quedó agendada para el ${r.payload.fecha} ${r.payload.hora}.`, effectId: r.effectId }),
    agendar_cita_especialista: () => ok({ citaId: "cita_9", status: "confirmada" }),
    calcular_cotizacion: () => ok({ cotizacionTexto: "Corte clásico: $30.000", cotizacionTotal: 30000, cotizacionTotalTexto: "$30.000", cotizacionCompleta: true, cantidadLineasCotizacion: 1 }),
    buscar_conocimiento: () => ok({ conocimientoEncontrado: true, respuestaExacta: "", respuestaDirecta: "Atendemos de 8 a. m. a 8 p. m.", cantidadConocimiento: 1 }),
    listar_catalogo_servicios: () => ok({ catalogoTexto: "- Corte clásico", cantidadCatalogo: 1 }),
    transferir_soporte: () => ok({ transferred: true, pausadoHasta: "2026-09-27T15:00:00.000Z", pauseDurationHours: 24 }),
    listar_citas_cliente: () => ok({ citasCliente: [{ id: "cita-1" }], citasTexto: "1. Corte", cantidadCitas: 1 }),
    cancelar_cita_cliente: () => ok({ cancelada: true, citaCanceladaTexto: "Corte clásico — domingo 27", yaCancelada: false }),
  };
  return {
    calls,
    on(action, responder) {
      responders.set(action, responder);
    },
    async handler(req, signal) {
      calls.push(req);
      const action = (req.action as { actionType: string }).actionType;
      const r = responders.get(action) ?? defaults[action];
      if (!r) return fail("NON_RETRYABLE", `internal_action_not_supported:${action}`);
      return r(req, signal);
    },
  };
}

export function createTestEngine(opts: { store?: ActionExecutionStore; handler?: FakeHandler; sleep?: (ms: number) => Promise<void> } = {}) {
  const store = opts.store ?? createInMemoryActionStore();
  const fake = opts.handler ?? createFakeHandler();
  const events: ActionEngineEvent[] = [];
  const sleeps: number[] = [];
  const engine = createActionEngine({
    store,
    handler: fake.handler,
    clock: () => new Date("2026-09-26T15:10:00Z"),
    sleep: opts.sleep ?? (async (ms) => void sleeps.push(ms)),
    log: (e) => events.push(e),
  });
  return { engine, store: store as InMemoryActionStore, fake, events, sleeps };
}

export function contextFor(spec: BusinessAgentSpec, state: ConversationState, over: Partial<ActionExecutionContext> = {}): ActionExecutionContext {
  return {
    tenantId: KEY.tenantId,
    agentId: KEY.agentId,
    agentVersion: "v1",
    conversation: { phoneNumberId: KEY.phoneNumberId, telefonoCliente: KEY.telefonoCliente },
    spec,
    requirements: buildAgentRequirements(spec),
    state,
    businessConfig: compiledConfig(spec).config,
    userMessage: "hola",
    ...over,
  };
}

export { createInMemoryActionStore };
