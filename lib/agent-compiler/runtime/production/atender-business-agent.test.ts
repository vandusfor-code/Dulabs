/**
 * Bloques 9 + 11 — atenderMensajeConBusinessAgent (boundary). 100% offline:
 * resolver/store/orchestrator/gateSink/classifier/idempotency inyectados vía
 * `overrides` (mismo patrón que agent-runtime.test.ts). `supabase` es un stub
 * nunca invocado directamente porque TODOS los overrides están presentes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MENSAJE_SOLO_TEXTO, atenderMensajeConBusinessAgent, atenderMensajeNoTextoConBusinessAgent, type BusinessAgentBoundaryOverrides } from "@/lib/agent-compiler/runtime/production/atender-business-agent";
import type { BusinessAgentResolution, BusinessAgentResolver } from "@/lib/agent-compiler/runtime/production/business-agent-resolver";
import type { GateRule } from "@/lib/agent-compiler/runtime/guardrail-gate";
import type { OrchestratorResult } from "@/lib/flow/flow-orchestrator";
import type { ClienteConfig } from "@/lib/supabase";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTRO_TENANT = "22222222-2222-4222-8222-222222222222";

function cliente(over: Partial<ClienteConfig> = {}): ClienteConfig {
  return {
    id: "cliente-1",
    id_tenant: TENANT,
    nombre_negocio: "Negocio X",
    whatsapp_business_account_id: "waba1",
    phone_number_id: "pn1",
    telefono_negocio: "573000000000",
    prompt_sistema: null,
    api_key_ia: null,
    meta_permanent_token: null,
    estado_pausa: false,
    pausado_hasta: null,
    plan: null,
    mensajes_usados_mes: 0,
    mes_actual: "2026-09",
    base_conocimiento: null,
    base_conocimiento_nombre_archivo: null,
    base_conocimiento_actualizado_at: null,
    calidad: null,
    limite_mensajeria: null,
    estado_verificacion: null,
    estado_nombre_visible: null,
    ultima_sincronizacion_meta: null,
    nombre_agente: null,
    ia_pausada: false,
    ia_restringida_a: null,
    ia_numeros_bloqueados: null,
    forward_to_dumo: false,
    captura_leads: false,
    agente_id: null,
    marketplace_activacion_id: null,
    flow_activo: true,
    flow_id: "flow-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function resolverQue(resolution: BusinessAgentResolution | (() => Promise<BusinessAgentResolution>)): BusinessAgentResolver {
  return { resolve: async () => (typeof resolution === "function" ? resolution() : resolution) };
}

function resolverQueLanza(mensaje: string): BusinessAgentResolver {
  return { resolve: async () => { throw new Error(mensaje); } };
}

const GATE_RULES: GateRule[] = [];

function resolutionOk(over: Partial<Extract<BusinessAgentResolution, { kind: "business_agent" }>> = {}): BusinessAgentResolution {
  return { kind: "business_agent", tenantId: TENANT, flowId: "flow-1", flowVersionId: "v1", checksum: "chk", gateRules: GATE_RULES, ...over };
}

function resultadoProcesado(): OrchestratorResult {
  return { outcome: "processed", effects: [], dispatchedEffectIds: [] };
}

/** Overrides mínimos que evitan tocar Supabase: orquestador/store/gateSink fakes que registran llamadas. */
function overridesConEspias() {
  const llamadas = { orchestrator: 0, gateSink: { sendMessage: 0, transferHuman: 0 } };
  const overrides: BusinessAgentBoundaryOverrides = {
    orchestrator: {
      async process(): Promise<OrchestratorResult> {
        llamadas.orchestrator++;
        return resultadoProcesado();
      },
    },
    store: { async getActiveExecution() { return null; } },
    gateSink: {
      async sendMessage() { llamadas.gateSink.sendMessage++; },
      async transferHuman() { llamadas.gateSink.transferHuman++; },
    },
  };
  return { overrides, llamadas };
}

describe("atenderMensajeConBusinessAgent — Bloques 9 + 11", () => {
  it("1. Business Agent activo -> entra al runtime (handled=true, outcome=flow, orquestador invocado)", async () => {
    const { overrides, llamadas } = overridesConEspias();
    const r = await atenderMensajeConBusinessAgent({
      supabase: {} as never,
      cliente: cliente(),
      telefonoCliente: "573001112233",
      texto: "hola",
      wamid: "wamid-1",
      resolver: resolverQue(resolutionOk()),
      overrides,
    });
    assert.equal(r.handled, true);
    assert.equal(r.outcome, "flow");
    assert.equal(llamadas.orchestrator, 1);
  });

  it("2/7/8. Sin Business Agent resoluble (inactivo/inexistente/deshabilitado) -> handled=false, Legacy sigue; CERO orquestador", async () => {
    for (const reason of ["not_active", "not_published", "not_business_agent"] as const) {
      const { overrides, llamadas } = overridesConEspias();
      const r = await atenderMensajeConBusinessAgent({
        supabase: {} as never,
        cliente: cliente(),
        telefonoCliente: "573001112233",
        texto: "hola",
        wamid: `wamid-${reason}`,
        resolver: resolverQue({ kind: "none", reason }),
        overrides,
      });
      assert.equal(r.handled, false, `reason=${reason}`);
      assert.equal(r.outcome, "no_business_agent");
      assert.equal(llamadas.orchestrator, 0, `no debe invocar el orquestador (reason=${reason})`);
    }
  });

  it("3/4/5. Número bloqueado -> CERO LLM, CERO tools, CERO WhatsApp (ni siquiera se resuelve el agente)", async () => {
    const { overrides, llamadas } = overridesConEspias();
    let resolverLlamado = false;
    const r = await atenderMensajeConBusinessAgent({
      supabase: {} as never,
      cliente: cliente({ ia_numeros_bloqueados: "573001112233,573009998888" }),
      telefonoCliente: "573001112233",
      texto: "hola",
      wamid: "wamid-blocked",
      resolver: { resolve: async () => { resolverLlamado = true; return resolutionOk(); } },
      overrides,
    });
    assert.equal(r.handled, true);
    assert.equal(r.outcome, "blocked_number");
    assert.equal(resolverLlamado, false, "ni siquiera se intenta resolver el Business Agent");
    assert.equal(llamadas.orchestrator, 0, "cero LLM/tools (el Flow Engine nunca corre)");
    assert.equal(llamadas.gateSink.sendMessage, 0, "cero envío de WhatsApp");
    assert.equal(llamadas.gateSink.transferHuman, 0);
  });

  it("número NO bloqueado -> el mecanismo de blacklist no interfiere (mismo esTelefonoBloqueado que Legacy)", async () => {
    const { overrides, llamadas } = overridesConEspias();
    const r = await atenderMensajeConBusinessAgent({
      supabase: {} as never,
      cliente: cliente({ ia_numeros_bloqueados: "573009998888" }), // otro número, no el remitente
      telefonoCliente: "573001112233",
      texto: "hola",
      wamid: "wamid-not-blocked",
      resolver: resolverQue(resolutionOk()),
      overrides,
    });
    assert.equal(r.outcome, "flow");
    assert.equal(llamadas.orchestrator, 1);
  });

  it("6. Tenant incorrecto (artefacto de otro tenant) -> fail_closed, nunca ejecuta", async () => {
    const { overrides, llamadas } = overridesConEspias();
    const r = await atenderMensajeConBusinessAgent({
      supabase: {} as never,
      cliente: cliente({ id_tenant: TENANT }),
      telefonoCliente: "573001112233",
      texto: "hola",
      wamid: "wamid-mismatch",
      resolver: resolverQue(resolutionOk({ tenantId: OTRO_TENANT })),
      overrides,
    });
    assert.equal(r.handled, true);
    assert.equal(r.outcome, "fail_closed");
    assert.equal(r.reason, "tenant_mismatch");
    assert.equal(llamadas.orchestrator, 0);
  });

  it("22. Error del resolver (infra real) -> fail_closed, NUNCA propaga la excepción ni cae a Legacy en silencio", async () => {
    const { overrides, llamadas } = overridesConEspias();
    const r = await atenderMensajeConBusinessAgent({
      supabase: {} as never,
      cliente: cliente(),
      telefonoCliente: "573001112233",
      texto: "hola",
      wamid: "wamid-resolver-error",
      resolver: resolverQueLanza("DB caída"),
      overrides,
    });
    assert.equal(r.handled, true, "fail-closed: el llamador NO debe caer a Legacy");
    assert.equal(r.outcome, "fail_closed");
    assert.equal(r.reason, "resolver_error");
    assert.equal(llamadas.orchestrator, 0);
  });

  it("9. wamid duplicado -> outcome=duplicate, el orquestador NUNCA corre una segunda vez", async () => {
    const { overrides } = overridesConEspias();
    let intentos = 0;
    overrides.idempotency = { async claim() { intentos++; return intentos === 1; } }; // solo el primer intento "gana"
    const params = {
      supabase: {} as never,
      cliente: cliente(),
      telefonoCliente: "573001112233",
      texto: "hola",
      wamid: "wamid-dup",
      resolver: resolverQue(resolutionOk()),
      overrides,
    };
    const r1 = await atenderMensajeConBusinessAgent(params);
    const r2 = await atenderMensajeConBusinessAgent(params);
    assert.equal(r1.outcome, "flow");
    assert.equal(r2.outcome, "duplicate");
    assert.equal(r2.handled, true);
  });

  it("11. commercialState real: se resuelve desde la ejecución activa (current_node_id) y el Gate lo usa -- prueba observable vía una regla que condiciona por estado", async () => {
    // Regla del Gate que SOLO hace match si commercialState === "QUALIFICATION"
    // (mismo "field: state" que evaluateGuardrailGate liga a context.commercialState,
    // ver guardrail-gate.ts:142). current_node_id="q-qualify" mapea a QUALIFICATION
    // (commercial-state-resolver.ts) -- si el boundary resolviera mal el estado
    // (o no lo resolviera), esta regla NUNCA haría match y el Gate pasaría de largo.
    const reglaCondicionadaAEstado: GateRule = {
      id: "rule-qualification-only",
      source: "prohibition",
      evaluation: "deterministic",
      priority: 1,
      condition: { rules: [{ field: "state", operator: "equals", value: "QUALIFICATION" }], match: "any" },
      action: "BLOCK",
      provenance: { kind: "prohibition", sourceId: "prohibition-1" },
    };
    const { overrides, llamadas } = overridesConEspias();
    overrides.store = {
      async getActiveExecution() {
        return {
          tenant_id: TENANT,
          id: "exec-1",
          flow_id: "flow-1",
          flow_version_id: "v1",
          execution_id: "exec-1",
          phone_number_id: "pn1",
          telefono_cliente: "573001112233",
          status: "waiting_input",
          state_version: 1,
          current_node_id: "q-qualify",
          variables: {},
          expected_input: "text",
          pending_effect: null,
          exports: { lead: {}, custom_fields: {}, webhook_body: {} },
          metadata: {},
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          last_activity_at: "2026-01-01T00:00:00.000Z",
        };
      },
    };
    const r = await atenderMensajeConBusinessAgent({
      supabase: {} as never,
      cliente: cliente(),
      telefonoCliente: "573001112233",
      texto: "cuanto cuesta",
      wamid: "wamid-state",
      resolver: resolverQue(resolutionOk({ gateRules: [reglaCondicionadaAEstado] })),
      overrides,
    });
    assert.equal(r.handled, true);
    assert.equal(r.outcome, "guardrail_blocked", "la regla condicionada a QUALIFICATION hizo match: el commercialState resuelto fue el correcto");
    assert.equal(llamadas.orchestrator, 0, "el Gate cortó ANTES del Flow Engine/LLM");
  });

  it("12. defensa cross-tenant: aunque el store devuelva una ejecución de OTRO tenant, el commercialState nunca se filtra (resolveCommercialState ya lo bloquea)", async () => {
    // Regla que bloquearía SI (incorrectamente) se filtrara el estado BOOKING
    // de la ejecución del otro tenant. La fila cruzada tiene current_node_id
    // "q-booking-when" (mapea a BOOKING) -- si resolveCommercialState no
    // aplicara su defensa tenant_mismatch, esta regla haría match y el
    // resultado sería guardrail_blocked. Al defenderse correctamente,
    // commercialState queda undefined y la regla NUNCA matchea.
    const reglaCondicionadaABooking: GateRule = {
      id: "rule-booking-only",
      source: "prohibition",
      evaluation: "deterministic",
      priority: 1,
      condition: { rules: [{ field: "state", operator: "equals", value: "BOOKING" }], match: "any" },
      action: "BLOCK",
      provenance: { kind: "prohibition", sourceId: "prohibition-2" },
    };
    const { overrides, llamadas } = overridesConEspias();
    overrides.store = {
      async getActiveExecution() {
        return {
          tenant_id: OTRO_TENANT, // fila de otro tenant, defensivamente ignorada
          id: "exec-x",
          flow_id: "flow-1",
          flow_version_id: "v1",
          execution_id: "exec-x",
          phone_number_id: "pn1",
          telefono_cliente: "573001112233",
          status: "waiting_input",
          state_version: 1,
          current_node_id: "q-booking-when",
          variables: {},
          expected_input: "text",
          pending_effect: null,
          exports: { lead: {}, custom_fields: {}, webhook_body: {} },
          metadata: {},
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          last_activity_at: "2026-01-01T00:00:00.000Z",
        };
      },
    };
    const r = await atenderMensajeConBusinessAgent({
      supabase: {} as never,
      cliente: cliente(),
      telefonoCliente: "573001112233",
      texto: "hola",
      wamid: "wamid-cross",
      resolver: resolverQue(resolutionOk({ gateRules: [reglaCondicionadaABooking] })),
      overrides,
    });
    // El turno se completa vía el Flow (pass, no block) -- prueba de que el
    // commercialState de la ejecución del OTRO tenant nunca llegó al Gate.
    assert.equal(r.handled, true);
    assert.equal(r.outcome, "flow", "la regla condicionada a BOOKING NO debe matchear: el estado cruzado nunca se filtra");
    assert.equal(llamadas.orchestrator, 1);
  });
});

describe("atenderMensajeNoTextoConBusinessAgent — audio/imagen/etc. de un tenant con Business Agent", () => {
  const params = (over: Record<string, unknown> = {}) => ({ supabase: {} as never, cliente: cliente(), telefonoCliente: "573001112233", wamid: "wamid-media", ...over });

  it("1. Business Agent activo -> aviso fijo SIN IA ni orquestador (handled=true, outcome=unsupported_message)", async () => {
    const enviados: string[] = [];
    const { overrides, llamadas } = overridesConEspias();
    overrides.gateSink = { async sendMessage({ text }) { enviados.push(text); }, async transferHuman() { llamadas.gateSink.transferHuman++; } };
    const r = await atenderMensajeNoTextoConBusinessAgent({ ...params(), resolver: resolverQue(resolutionOk()), overrides });
    assert.equal(r.handled, true);
    assert.equal(r.outcome, "unsupported_message");
    assert.deepEqual(enviados, [MENSAJE_SOLO_TEXTO]);
    assert.equal(llamadas.orchestrator, 0, "la conversación en curso NO se toca (el cliente retoma por escrito)");
    assert.equal(llamadas.gateSink.transferHuman, 0);
  });

  it("2. sin Business Agent (flow hand-built / tenant legacy) -> handled=false, NO envía nada (camino de siempre)", async () => {
    const enviados: string[] = [];
    const { overrides } = overridesConEspias();
    overrides.gateSink = { async sendMessage({ text }) { enviados.push(text); }, async transferHuman() {} };
    const r = await atenderMensajeNoTextoConBusinessAgent({ ...params(), resolver: resolverQue({ kind: "none", reason: "not_business_agent" }), overrides });
    assert.equal(r.handled, false);
    assert.deepEqual(enviados, []);
  });

  it("3. número bloqueado -> silencio (handled=true, sin resolver ni envío)", async () => {
    const enviados: string[] = [];
    const { overrides } = overridesConEspias();
    overrides.gateSink = { async sendMessage({ text }) { enviados.push(text); }, async transferHuman() {} };
    const r = await atenderMensajeNoTextoConBusinessAgent({ ...params({ cliente: cliente({ ia_numeros_bloqueados: "573001112233" }) }), resolver: resolverQueLanza("no debe resolverse"), overrides });
    assert.equal(r.handled, true);
    assert.equal(r.outcome, "blocked_number");
    assert.deepEqual(enviados, []);
  });

  it("4. error del resolver / artefacto de otro tenant -> fail-closed silencioso (nunca cae a LEGACY)", async () => {
    const enviados: string[] = [];
    const { overrides } = overridesConEspias();
    overrides.gateSink = { async sendMessage({ text }) { enviados.push(text); }, async transferHuman() {} };
    const err = await atenderMensajeNoTextoConBusinessAgent({ ...params(), resolver: resolverQueLanza("db caída"), overrides });
    assert.deepEqual({ handled: err.handled, outcome: err.outcome, reason: err.reason }, { handled: true, outcome: "fail_closed", reason: "resolver_error" });
    const cruzado = await atenderMensajeNoTextoConBusinessAgent({ ...params(), resolver: resolverQue(resolutionOk({ tenantId: OTRO_TENANT })), overrides });
    assert.deepEqual({ handled: cruzado.handled, outcome: cruzado.outcome, reason: cruzado.reason }, { handled: true, outcome: "fail_closed", reason: "tenant_mismatch" });
    assert.deepEqual(enviados, []);
  });

  it("5. si falla el envío del aviso, el mensaje SIGUE siendo del Business Agent (no lanza, no cae a LEGACY)", async () => {
    const { overrides } = overridesConEspias();
    overrides.gateSink = { async sendMessage() { throw new Error("meta 500"); }, async transferHuman() {} };
    const r = await atenderMensajeNoTextoConBusinessAgent({ ...params(), resolver: resolverQue(resolutionOk()), overrides });
    assert.equal(r.handled, true);
    assert.equal(r.outcome, "unsupported_message");
  });
});
