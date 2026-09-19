/**
 * R4 — HARNESS del E2E de cadena completa con conocimiento (compartido por el test offline
 * y por el E2E REAL contra Supabase, que solo cambia el store de conocimiento):
 *
 *   FAQ + PDF real (pdf-parse) -> extracción -> chunks -> store
 *   Spec(faq) -> compile -> draft validado -> publish -> resolver real
 *     -> atenderMensajeConBusinessAgent (boundary real: blacklist + gate + orquestador)
 *       -> Flow Engine real (cond/question/action/ai reales)
 *       -> InternalActionExecutor REAL -> buscar_conocimiento REAL -> retrieval REAL
 *
 * Fakes: el LLM (stub que redacta SOLO a partir de lo que recibe), el store de
 * conocimiento en memoria (la relevancia de Postgres se verifica en el E2E de la
 * BD), Nylas/calendario/idempotencia. Lo demás es el código real de producción.
 */
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { createExecutionOrchestrator, type NormalizedFlowEvent } from "@/lib/flow/flow-orchestrator";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { IntegrationResolver } from "@/lib/flow/integration-resolver";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest, type EffectExecutor } from "@/lib/flow/executor-types";
import { InternalActionExecutor, type InternalActionDeps } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import type { ClienteConfig } from "@/lib/supabase";
import type { AgentCapabilities, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import { compileAndCreateDraftVersion, publishBusinessAgentVersion } from "@/lib/agent-compiler/registry/registry";
import { createInMemoryBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/testing/in-memory-registry-store";
import { createSupabaseBusinessAgentResolver } from "@/lib/agent-compiler/runtime/production/business-agent-resolver";
import { atenderMensajeConBusinessAgent } from "@/lib/agent-compiler/runtime/production/atender-business-agent";
import { createInMemoryOrchestratorStore } from "@/lib/agent-compiler/runtime/testing/in-memory-store";
import type { SemanticClassifier } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { retailSpec } from "@/lib/agent-compiler/runtime/fixtures";
import { createInMemoryCalendarStore } from "@/lib/agent-compiler/calendar/testing/in-memory-calendar-store";
import type { NylasCreateEventParams, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";
import type { KnowledgeStore } from "@/lib/business-agent-knowledge/store";
import { createInMemoryKnowledgeStore, stem } from "@/lib/business-agent-knowledge/testing/in-memory-knowledge-store";
import { tokenizeQuery, unaccent } from "@/lib/business-agent-knowledge/tokenizer";
import { buildPdf } from "@/lib/business-agent-knowledge/testing/pdf-fixture";
import { createFaq, uploadDocument } from "@/lib/business-agent-knowledge/service";

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_B = "22222222-2222-4222-8222-222222222222";
export const TELEFONO = "573001112233";
export const CONV = { phoneNumberId: "pn1", telefonoCliente: TELEFONO };
export const stubClassifier: SemanticClassifier = async () => null;
export const AUTHORIZER: InternalActionAuthorizer = { assertActivacionOwnedByTenant: async () => true, assertPhoneNumberOwnedByTenant: async () => true };
/** Texto legacy ENORME de dulabs_clientes_config.base_conocimiento: NUNCA debe llegar a la IA del Business Agent. */
export const BASE_LEGACY = "SECRETO-LEGACY " + "el precio del corte es 99 pesos. ".repeat(3000);

export const POLITICAS = buildPdf([
  "Política de cancelación",
  "Las citas pueden cancelarse sin costo hasta 24 horas antes.",
  "Si la cancelación es con menos de 24 horas se cobra el 50% del servicio.",
  "",
  "Política de reembolsos",
  "No hay reembolsos por servicios ya prestados.",
]);

export function caps(p: Partial<AgentCapabilities>): AgentCapabilities {
  return { ...(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, false])) as AgentCapabilities), ...p };
}
export function cliente(flowId: string, tenantId: string): ClienteConfig {
  return {
    id: "cliente-1", id_tenant: tenantId, nombre_negocio: "Negocio X", whatsapp_business_account_id: "waba1",
    phone_number_id: CONV.phoneNumberId, telefono_negocio: "573000000000", prompt_sistema: null, api_key_ia: null,
    meta_permanent_token: null, estado_pausa: false, pausado_hasta: null, plan: null, mensajes_usados_mes: 0,
    mes_actual: "2026-09", base_conocimiento: BASE_LEGACY, base_conocimiento_nombre_archivo: "legacy.pdf", base_conocimiento_actualizado_at: null,
    calidad: null, limite_mensajeria: null, estado_verificacion: null, estado_nombre_visible: null, ultima_sincronizacion_meta: null,
    nombre_agente: null, ia_pausada: false, ia_restringida_a: null, ia_numeros_bloqueados: null, forward_to_dumo: false,
    captura_leads: false, agente_id: null, marketplace_activacion_id: null, flow_activo: true, flow_id: flowId,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  } as ClienteConfig;
}

export type Fila = Record<string, unknown>;
export function supabaseIdempotencia(): SupabaseClient {
  const filas: Fila[] = [];
  const from = (tabla: string) => {
    if (tabla !== "dulabs_idempotencia_reservas") throw new Error(`tabla inesperada: ${tabla}`);
    const filtros: Array<(f: Fila) => boolean> = [];
    let insert: Fila | undefined;
    let update: Fila | undefined;
    const ejecutar = (): { data: Fila[]; error: { code: string; message: string } | null } => {
      if (insert) {
        const n = insert;
        if (filas.some((f) => f.id_tenant === n.id_tenant && f.idempotency_key === n.idempotency_key)) return { data: [], error: { code: "23505", message: "dup" } };
        const fila = { resultado_json: null, ...n };
        filas.push(fila);
        return { data: [fila], error: null };
      }
      if (update) {
        for (const f of filas) if (filtros.every((fn) => fn(f))) Object.assign(f, update);
        return { data: [], error: null };
      }
      return { data: filas.filter((f) => filtros.every((fn) => fn(f))), error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), b),
      insert: (f: Fila) => ((insert = f), b),
      update: (c: Fila) => ((update = c), b),
      async maybeSingle() { const r = ejecutar(); return { data: r.data[0] ?? null, error: r.error }; },
      then: (resolve: (r: { data: Fila[]; error: unknown }) => unknown) => resolve(ejecutar()),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

export async function publicar(spec: BusinessAgentSpec, tenantId: string) {
  const registryStore = createInMemoryBusinessAgentRegistryStore();
  const draft = await compileAndCreateDraftVersion({ store: registryStore }, { tenantId, spec });
  assert.ok(draft.ok, `draft: ${JSON.stringify(draft)}`);
  if (!draft.ok) throw new Error("unreachable");
  assert.equal(draft.validationStatus, "validated", JSON.stringify(draft.diagnostics));
  const pub = await publishBusinessAgentVersion({ store: registryStore }, { tenantId, flowId: draft.flowId, flowVersionId: draft.flowVersionId });
  assert.ok(pub.ok, JSON.stringify(pub));
  const version = await registryStore.resolvePublishedVersion(tenantId, draft.flowId);
  assert.ok(version);
  return { registryStore, flowId: draft.flowId, version: version! };
}

export const SERVICIOS = [{ id: "s1", nombre: "Corte", precio: 35000, duracionMin: 45, categoria: null, descripcion: null }];

export interface AiCall { nodeId: string; payload: Record<string, unknown> }

export async function mundo(knowledge: KnowledgeStore = createInMemoryKnowledgeStore(), internalOverrides: Partial<InternalActionDeps> = {}) {
  const orchStore = createInMemoryOrchestratorStore();
  const calendarStore = createInMemoryCalendarStore();
  const eventos: NylasCreateEventParams[] = [];
  const mensajes: string[] = [];
  const acciones: EffectDispatchRequest[] = [];
  // Pausas del chat que el runtime REAL pide (transferencia a humano).
  const pausas: Array<{ phoneNumberId: string; telefonoCliente: string; duracionMs: number }> = [];
  const aiCalls: AiCall[] = [];
  let respuestaIA: (req: EffectDispatchRequest) => Record<string, unknown> = () => ({ responseText: "ok" });

  const lector: NylasEventsClient = { async listEvents() { return []; } };
  const escritor: NylasEventsWriteClient = { async createEvent(p) { eventos.push(p); return { id: `evt-${eventos.length}` }; }, async deleteEvent() {} };
  const ejecutorReal = new InternalActionExecutor({
    supabase: supabaseIdempotencia(),
    authorizer: AUTHORIZER,
    guardarLeadEnterprise: async () => ({ ok: false }) as never,
    activarPausaChat: async (_s, phoneNumberId, telefonoCliente, duracionMs) => { pausas.push({ phoneNumberId, telefonoCliente, duracionMs }); return { ok: true } as never; },
    verificarDisponibilidad: async () => ({ disponible: false }) as never,
    sugerirHorariosLibres: async () => [] as never,
    crearCita: async () => ({ ok: false }) as never,
    readPausaUntil: async () => (pausas.length > 0 ? new Date(Date.now() + pausas[pausas.length - 1]!.duracionMs).toISOString() : null),
    consultarDisponibilidadEspecialista: async () => ({ disponible: false }) as never,
    validarServicioEspecialista: async () => ({ ok: false }) as never,
    agendarCitaEspecialista: async () => ({ ok: false }) as never,
    cancelarCitaEspecialista: async () => ({ ok: false }) as never,
    consultarCitasActivasEspecialista: async () => ({ ok: false }) as never,
    moverCitaEspecialista: async () => ({ ok: false }) as never,
    listarHorariosDisponiblesEspecialista: async () => ({ ok: false }) as never,
    listarCatalogoServiciosReal: async () => SERVICIOS,
    resolveNylasApiKeyFromEnv: () => "api-key-fake",
    createNylasEventsClient: () => lector,
    createNylasEventsWriteClient: () => escritor,
    createBusinessAgentCalendarStore: () => calendarStore,
    recordarNombreCliente: async () => undefined,
    // Reloj fijo: jueves 2030-03-14 (hora Colombia) => "el sábado" = 2030-03-16.
    now: () => new Date("2030-03-14T15:00:00Z"),
    // R4: el store de conocimiento (en memoria, con el mismo contrato que el real).
    createKnowledgeStore: () => knowledge,
    // El E2E REAL contra Supabase inyecta aquí las funciones reales (p. ej. la pausa del chat).
    ...internalOverrides,
  });
  const accionEspiada: EffectExecutor = {
    kind: "action", version: "espia", capabilities: ejecutorReal.capabilities,
    dispatch: (req, ctx, signal) => { acciones.push(req); return ejecutorReal.dispatch(req, ctx, signal); },
  };
  const ia: EffectExecutor = {
    kind: "ai", version: "stub", capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    dispatch: async (req) => {
      aiCalls.push({ nodeId: req.nodeId, payload: req.payload });
      const data = respuestaIA(req);
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
    },
  };
  const envio: EffectExecutor = {
    kind: "send_message", version: "stub", capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    dispatch: async (req) => {
      const t = (req as { message?: { content?: { text?: string } } }).message?.content?.text;
      if (t) mensajes.push(t);
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: {}, appliedResult: {} };
    },
  };
  const framework = createTestEffectExecutorFramework({
    executors: [ia, accionEspiada, envio],
    integrationResolver: new IntegrationResolver({ getIntegrationById: async () => null, getIntegrationCredentials: async () => [] }),
  });
  const orquestador = createExecutionOrchestrator({ store: orchStore, engine: { createFlowEngineState, runFlowEngine }, effectFramework: framework });

  async function activar(spec: BusinessAgentSpec, tenantId: string) {
    const s = await publicar(spec, tenantId);
    orchStore.publishFlow({ tenantId, flowId: s.flowId, definition: s.version.flow });
    const seen = new Set<string>();
    return {
      flow: s.version.flow,
      turno: (texto: string, wamid: string) =>
        atenderMensajeConBusinessAgent({
          supabase: {} as never,
          cliente: cliente(s.flowId, tenantId),
          telefonoCliente: TELEFONO,
          texto,
          wamid,
          resolver: createSupabaseBusinessAgentResolver({ store: s.registryStore }),
          classifier: stubClassifier,
          overrides: {
            orchestrator: { process: (e: NormalizedFlowEvent) => orquestador.process(e) },
            store: orchStore,
            gateSink: { async sendMessage() {}, async transferHuman() {} },
            idempotency: { async claim(_t, w) { return seen.has(w) ? false : (seen.add(w), true); } },
          },
        }),
    };
  }
  return {
    knowledge, orchStore, calendarStore, eventos, mensajes, acciones, aiCalls,
    setIA: (fn: typeof respuestaIA) => { respuestaIA = fn; },
    activar,
    conectarCalendario: (tenantId: string) =>
      calendarStore.saveConnection({
        tenantId, provider: "nylas", grantId: `grant-${tenantId}`, accountEmail: "n@x.com", status: "connected",
        selectedCalendarId: `cal-${tenantId}`, selectedCalendarName: "P", connectedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ejecucion: (tenantId: string) => orchStore.listExecutions(tenantId)[0]!,
    aiDe: (nodeId: string) => aiCalls.filter((c) => c.nodeId === nodeId),
    accionesDe: (nodeId: string) => acciones.filter((a) => a.nodeId === nodeId),
    pausas,
  };
}

/**
 * IA "honesta": redacta EXCLUSIVAMENTE a partir de los fragmentos que recibe en
 * `conocimientoTexto` (como debe hacerlo el modelo real). Si no hay fragmentos
 * no puede afirmar nada -- pero además el flujo ni siquiera la invoca.
 */
export function iaHonesta(req: EffectDispatchRequest): Record<string, unknown> {
  if (req.nodeId === "ai-faq-present") {
    const fragmentos = String(req.payload.conocimientoTexto ?? "");
    const pregunta = String(req.payload.user_request ?? req.payload.__firstMessageText ?? "");
    const terminos = new Set(tokenizeQuery(pregunta).terms.map(stem));
    const primera = fragmentos.split("\n\n")[0] ?? "";
    const cuerpo = primera.replace(/^\[\d+\] (Pregunta frecuente: .*\nRespuesta: |Documento ".*" \(fragmento\):\n)/, "");
    // Un modelo real responde SOLO lo que se preguntó: se conservan las líneas que comparten términos con la pregunta.
    const utiles = cuerpo.split("\n").filter((l) => (unaccent(l).match(/[a-z0-9ñ]+/g) ?? []).some((w) => terminos.has(stem(w))));
    const respuesta = (utiles.length > 0 ? utiles : [cuerpo]).join(" ").trim();
    return { responseText: respuesta ? `Según la información del negocio: ${respuesta}` : "No cuento con ese dato." };
  }
  return { responseText: "ok" };
}

export const NO_INFO = "No tengo ese dato por ahora. ¿Quieres preguntarme otra cosa?";
export function agenteFaq(over: Partial<BusinessAgentSpec> = {}): BusinessAgentSpec {
  const s = retailSpec();
  return {
    ...s,
    capabilities: caps({ faq: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    policies: { prohibitions: [], rules: [] },
    handoff: { rules: [], defaultPauseHours: 24 },
    knowledge: { authority: "secondary", documents: [], noAnswerMessage: NO_INFO },
    ...over,
  };
}

export async function tiendaConConocimiento(tenantId: string, store: KnowledgeStore = createInMemoryKnowledgeStore()) {
  const f = await createFaq(store, tenantId, { question: "¿Cuál es el horario?", answer: "Lunes a viernes de 8 a 6." });
  const f2 = await createFaq(store, tenantId, { question: "¿Dónde están ubicados?", answer: "Estamos en la Calle 10 #20-30, Bogotá." });
  const d = await uploadDocument(store, tenantId, { filename: "politicas.pdf", mimeType: "application/pdf", buffer: POLITICAS, userId: null });
  assert.ok(f.ok && f2.ok && d.ok, "conocimiento de prueba");
  return { store, docId: d.ok ? d.value.id : "", faqId: f.ok ? f.value.id : "" };
}

