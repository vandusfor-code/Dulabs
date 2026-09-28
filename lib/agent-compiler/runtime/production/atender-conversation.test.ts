// Business Agent 2.0, FASE 4 — conexión del runtime conversacional en la frontera real del webhook
// (atenderMensajeConBusinessAgent). Sin Supabase: resolver, orquestador, gateSink y runtime inyectados.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atenderMensajeConBusinessAgent, type BusinessAgentBoundaryOverrides } from "@/lib/agent-compiler/runtime/production/atender-business-agent";
import type { BusinessAgentResolution } from "@/lib/agent-compiler/runtime/production/business-agent-resolver";
import type { ConversationTurnHandler } from "@/lib/agent-compiler/runtime/agent-runtime";
import { STATE_MACHINE_TENANTS_ENV } from "@/lib/agent-compiler/runtime/production/conversation-runtime";
import { barberSpec } from "@/lib/agent-compiler/conversation/testing/harness";
import type { ClienteConfig } from "@/lib/supabase";

const TENANT = "11111111-1111-4111-8111-111111111111";
const cliente = { id: "c1", id_tenant: TENANT, phone_number_id: "pn1", ia_numeros_bloqueados: null, flow_activo: true, flow_id: "flow-1" } as unknown as ClienteConfig;

function resolution(withSpec = true): BusinessAgentResolution {
  return { kind: "business_agent", tenantId: TENANT, flowId: "flow-1", flowVersionId: "ver-7", checksum: "chk", gateRules: [], ...(withSpec ? { spec: barberSpec() } : {}) };
}

function spies(conversation?: ConversationTurnHandler) {
  const calls = { orchestrator: 0, handle: [] as unknown[] };
  const overrides: BusinessAgentBoundaryOverrides = {
    orchestrator: { process: async () => { calls.orchestrator++; return { outcome: "processed", effects: [], dispatchedEffectIds: [] }; } },
    store: { getActiveExecution: async () => null },
    gateSink: { sendMessage: async () => {}, transferHuman: async () => {} },
    ...(conversation ? { conversation } : {}),
  };
  return { calls, overrides };
}

describe("FASE 4 — frontera del webhook: motor conversacional detrás del Gate", () => {
  it("con el runtime conversacional: atiende el motor (no el grafo), con la clave derivada del canal y la versión publicada", async () => {
    const handled: unknown[] = [];
    const { calls, overrides } = spies({ handle: async (i) => { handled.push(i); return { outcome: "processed", status: "COLLECTING_INFORMATION", sent: true, actions: [] }; } });
    const r = await atenderMensajeConBusinessAgent({ supabase: {} as never, cliente, telefonoCliente: "573001112233", texto: "hola", wamid: "w1", resolver: { resolve: async () => resolution() }, overrides });
    assert.deepEqual([r.handled, r.outcome, calls.orchestrator], [true, "conversation", 0]);
    assert.deepEqual(handled[0], { key: { tenantId: TENANT, phoneNumberId: "pn1", telefonoCliente: "573001112233", agentId: "flow-1" }, agentVersion: "ver-7", wamid: "w1", text: "hola" });
  });

  it("sin habilitar el tenant: el Business Agent sigue con el grafo compilado exactamente igual", async () => {
    const prev = process.env[STATE_MACHINE_TENANTS_ENV];
    delete process.env[STATE_MACHINE_TENANTS_ENV];
    try {
      const { calls, overrides } = spies();
      const r = await atenderMensajeConBusinessAgent({ supabase: {} as never, cliente, telefonoCliente: "573001112233", texto: "hola", wamid: "w2", resolver: { resolve: async () => resolution() }, overrides });
      assert.deepEqual([r.outcome, calls.orchestrator], ["flow", 1]);
    } finally {
      if (prev !== undefined) process.env[STATE_MACHINE_TENANTS_ENV] = prev;
    }
  });

  it("una excepción del motor conversacional falla cerrado (no cae al grafo ni a LEGACY)", async () => {
    const { calls, overrides } = spies({ handle: async () => { throw new Error("db down"); } });
    const r = await atenderMensajeConBusinessAgent({ supabase: {} as never, cliente, telefonoCliente: "573001112233", texto: "hola", wamid: "w3", resolver: { resolve: async () => resolution() }, overrides });
    assert.deepEqual([r.handled, r.outcome, r.reason, calls.orchestrator], [true, "fail_closed", "conversation_runtime_error", 0]);
  });
});
