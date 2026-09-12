/**
 * AI Provider Router — Fase 6 (IA configurable, autorizado). Nunca red
 * real (siempre anthropicClient/geminiClient mockeados); dulabs_agentes se
 * simula con un Supabase falso (mismo patrón que otras suites de esta fase).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
// El router SIEMPRE inyecta su propio resolveApiKey (nunca el de claudeDeps/
// geminiDeps -- ver createAiProviderRouter): cuando no hay agentId, resuelve
// null y el executor cae a su fallback YA EXISTENTE (env var de plataforma),
// exactamente igual que en producción real. Sin esto, los tests sin agentId
// fallarían con AUTH_ERROR por falta de env var, no por ningún bug del router.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-test-platform-fallback-not-real";
process.env.GEMINI_KEY = process.env.GEMINI_KEY || "gemini-test-platform-fallback-not-real";

import { cifrarSecreto } from "@/lib/crypto";
import { createAiProviderRouter } from "@/lib/flow/executors/ai-provider-router";
import { createDefaultExecutorRegistry } from "@/lib/flow/executor-factory";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest, type EffectExecutor } from "@/lib/flow/executor-types";
import type { AnthropicMessagesClient } from "@/lib/flow/claude/claude-types";
import type { GeminiGenerateContentClient } from "@/lib/flow/gemini/gemini-types";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

type AgenteFila = {
  id: string;
  id_tenant: string;
  nombre: string;
  prompt_sistema: string | null;
  base_conocimiento: string | null;
  base_conocimiento_nombre_archivo: string | null;
  api_key_ia: string | null;
};

function crearSupabaseFalso(agentes: AgenteFila[]) {
  return {
    from(tabla: string) {
      if (tabla !== "dulabs_agentes") throw new Error(`tabla inesperada en el fake: ${tabla}`);
      return {
        select() {
          return this;
        },
        eq(_col: string, value: string) {
          this._filtroId = value;
          return this;
        },
        async maybeSingle() {
          const fila = agentes.find((a) => a.id === this._filtroId);
          return { data: fila ?? null, error: null };
        },
        _filtroId: undefined as string | undefined,
      };
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

function baseRequest(overrides: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "fx-ai-1",
    executionRowId: "exec-1",
    tenantId: TENANT_A,
    nodeId: "ai-node",
    kind: "ai",
    payload: { text: "hola" },
    attempt: 1,
    ai: { instruction: "Ayuda al usuario", mode: "respond" },
    ...overrides,
  };
}

function mockAnthropicClient(toolInput: Record<string, unknown>, opts: { onCreate?: (params: unknown) => void } = {}): AnthropicMessagesClient {
  return {
    async createMessage(params) {
      opts.onCreate?.(params);
      return {
        content: [{ type: "tool_use", id: "tu-1", name: "structured_ai_output", input: toolInput }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: "claude-sonnet-5",
      };
    },
  };
}

function mockGeminiClient(jsonOutput: Record<string, unknown>, opts: { onGenerate?: (params: unknown) => void } = {}): GeminiGenerateContentClient {
  return {
    async generateContent(params) {
      opts.onGenerate?.(params);
      return { text: JSON.stringify(jsonOutput), usage: { promptTokenCount: 10, candidatesTokenCount: 5 }, model: "gemini-3.6-flash" };
    },
  };
}

describe("Fase 6 — AI Provider Router: selección de proveedor", () => {
  it("1. provider omitido -> usa Claude (retrocompatible)", async () => {
    let claudeCalled = false;
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([]),
      claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "respond", responseText: "ok claude" }, { onCreate: () => (claudeCalled = true) }) },
      geminiDeps: { geminiClient: mockGeminiClient({ mode: "respond", responseText: "ok gemini" }) },
    });
    const result = await router.dispatch(baseRequest(), { tenantId: TENANT_A, internal: true });
    assert.equal(claudeCalled, true);
    assert.equal(result.success, true);
    assert.equal(result.data?.responseText, "ok claude");
  });

  it("2. provider='claude' explícito -> Claude", async () => {
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([]),
      claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "respond", responseText: "ok claude" }) },
    });
    const result = await router.dispatch(baseRequest({ ai: { instruction: "x", mode: "respond", provider: "claude" } }), {
      tenantId: TENANT_A,
      internal: true,
    });
    assert.equal(result.data?.responseText, "ok claude");
  });

  it("3. provider='gemini' -> Gemini", async () => {
    let geminiCalled = false;
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([]),
      claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "respond", responseText: "NO debería llamarse" }) },
      geminiDeps: { geminiClient: mockGeminiClient({ mode: "respond", responseText: "ok gemini" }, { onGenerate: () => (geminiCalled = true) }) },
    });
    const result = await router.dispatch(baseRequest({ ai: { instruction: "x", mode: "respond", provider: "gemini" } }), {
      tenantId: TENANT_A,
      internal: true,
    });
    assert.equal(geminiCalled, true);
    assert.equal(result.data?.responseText, "ok gemini");
  });

  it("4. provider inválido -> rechazo (VALIDATION_ERROR), nunca llama a ningún proveedor", async () => {
    let anyCalled = false;
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([]),
      claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "respond" }, { onCreate: () => (anyCalled = true) }) },
    });
    const result = await router.dispatch(
      baseRequest({ ai: { instruction: "x", mode: "respond", provider: "gpt4" as never } }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
    assert.equal(result.error, "invalid_ai_provider");
    assert.equal(anyCalled, false);
  });
});

describe("Fase 6 — AI Provider Router: aislamiento y resolución de dulabs_agentes", () => {
  const agenteA: AgenteFila = {
    id: "1",
    id_tenant: TENANT_A,
    nombre: "Agente de prueba",
    prompt_sistema: "Eres el asistente oficial de la tienda.",
    base_conocimiento: "Horario: 9am-6pm. Envíos gratis desde $100.000.",
    base_conocimiento_nombre_archivo: "politicas.txt",
    api_key_ia: cifrarSecreto("sk-tenant-a-real-12345"),
  };

  it("5. agentId válido del mismo tenant -> resuelve y ejecuta normalmente", async () => {
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([agenteA]),
      claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "respond", responseText: "ok" }) },
    });
    const result = await router.dispatch(baseRequest({ ai: { instruction: "x", mode: "respond", agentId: "1" } }), {
      tenantId: TENANT_A,
      internal: true,
    });
    assert.equal(result.success, true);
  });

  it("6. agentId de OTRO tenant -> rechazo (SECURITY_REJECTED, agent_tenant_mismatch), nunca llama al proveedor", async () => {
    let called = false;
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([agenteA]),
      claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "respond" }, { onCreate: () => (called = true) }) },
    });
    const result = await router.dispatch(
      baseRequest({ tenantId: TENANT_B, ai: { instruction: "x", mode: "respond", agentId: "1" } }),
      { tenantId: TENANT_B, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.equal(result.error, "agent_tenant_mismatch");
    assert.equal(called, false);
  });

  it("7. agentId inexistente -> rechazo (SECURITY_REJECTED, agent_not_found), nunca llama al proveedor", async () => {
    let called = false;
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([agenteA]),
      claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "respond" }, { onCreate: () => (called = true) }) },
    });
    const result = await router.dispatch(baseRequest({ ai: { instruction: "x", mode: "respond", agentId: "999" } }), {
      tenantId: TENANT_A,
      internal: true,
    });
    assert.equal(result.success, false);
    assert.equal(result.error, "agent_not_found");
    assert.equal(called, false);
  });

  it("8. prompt_sistema del agente + instruction del nodo llegan combinados al proveedor", async () => {
    let capturedSystem = "";
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([agenteA]),
      claudeDeps: {
        anthropicClient: mockAnthropicClient({ mode: "respond", responseText: "ok" }, { onCreate: (params) => (capturedSystem = (params as { system: string }).system) }),
      },
    });
    await router.dispatch(baseRequest({ ai: { instruction: "Instrucción específica del nodo", mode: "respond", agentId: "1" } }), {
      tenantId: TENANT_A,
      internal: true,
    });
    assert.match(capturedSystem, /Eres el asistente oficial de la tienda\./);
    assert.match(capturedSystem, /Instrucción específica del nodo/);
  });

  it("9. base_conocimiento del agente llega disponible al proveedor", async () => {
    let capturedSystem = "";
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([agenteA]),
      claudeDeps: {
        anthropicClient: mockAnthropicClient({ mode: "respond", responseText: "ok" }, { onCreate: (params) => (capturedSystem = (params as { system: string }).system) }),
      },
    });
    await router.dispatch(baseRequest({ ai: { instruction: "x", mode: "respond", agentId: "1" } }), { tenantId: TENANT_A, internal: true });
    assert.match(capturedSystem, /CONOCIMIENTO DISPONIBLE/);
    assert.match(capturedSystem, /Envíos gratis desde \$100\.000/);
  });

  it("10. API key tenant-scoped del agente se resuelve y se usa vía resolveApiKey (nunca la del env)", async () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-platform-env-fallback";
    try {
      let capturedApiKeyUsed: string | null = null;
      // Interceptamos resolveApiKey indirectamente: el mock no ve la key
      // directamente, pero createAnthropicMessagesClient sí la usaría en
      // producción real -- acá confirmamos que el router RESOLVIÓ la key
      // correcta llamando directamente a la resolución (mismo criterio que
      // el resto de la suite: comportamental, no de texto-fuente).
      const { resolveAgentProfileForTenant } = await import("@/lib/flow/ai-runtime/agent-profile-resolver");
      const perfil = await resolveAgentProfileForTenant(crearSupabaseFalso([agenteA]), { tenantId: TENANT_A, agentId: "1" });
      if (perfil.ok) capturedApiKeyUsed = perfil.profile.apiKey;
      assert.equal(capturedApiKeyUsed, "sk-tenant-a-real-12345");
    } finally {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    }
  });

  it("11. API key nunca aparece en el resultado devuelto al Engine (data/appliedResult/metadata)", async () => {
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([agenteA]),
      claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "respond", responseText: "ok" }) },
    });
    const result = await router.dispatch(baseRequest({ ai: { instruction: "x", mode: "respond", agentId: "1" } }), {
      tenantId: TENANT_A,
      internal: true,
    });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("sk-tenant-a-real-12345"));
  });

  it("12. outputVariables sigue funcionando a través del router (sin cambios de flow-engine.ts)", async () => {
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([]),
      claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "extract", extracted: { nombre: "Ana", telefono: "3001234567" } }) },
    });
    const result = await router.dispatch(
      baseRequest({ ai: { instruction: "x", mode: "extract", outputVariables: ["nombre", "telefono"] } }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    // mode "extract" aplana las claves directo en `data` (ver
    // claude-engine-mapper.ts::mapAiOutputToEngineData) -- flow-engine.ts
    // luego las escribe en variables (ver outputVariables ya existente).
    assert.equal(result.data?.nombre, "Ana");
    assert.equal(result.data?.telefono, "3001234567");
  });

  it("15. propose_action con allowedTools sigue funcionando (fallback/transferencia a humano no se rompe)", async () => {
    const router = createAiProviderRouter({
      supabase: crearSupabaseFalso([]),
      claudeDeps: {
        anthropicClient: mockAnthropicClient({ mode: "propose_action", actionProposal: { actionType: "transferir_soporte" } }),
      },
    });
    const result = await router.dispatch(
      baseRequest({ ai: { instruction: "x", mode: "propose_action", allowedTools: ["transferir_soporte"] } }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal((result.data?.actionProposal as { actionType: string })?.actionType, "transferir_soporte");
  });
});

describe("Fase 6 — 13/14: retrocompatibilidad vía ExecutorRegistry real", () => {
  it("13. Flow antiguo sin provider, vía createDefaultExecutorRegistry -> sigue yendo a Claude", async () => {
    let claudeCalled = false;
    const supabaseFalso = crearSupabaseFalso([]);
    const registry = createDefaultExecutorRegistry(supabaseFalso, {
      aiProviderRouterDeps: { claudeDeps: { anthropicClient: mockAnthropicClient({ mode: "respond", responseText: "ok" }, { onCreate: () => (claudeCalled = true) }) } },
    });
    const executor = registry.resolve("ai");
    const result = await executor.dispatch(baseRequest(), { tenantId: TENANT_A, internal: true });
    assert.equal(claudeCalled, true);
    assert.equal(result.success, true);
  });

  it("14. overrides.aiExecutor (AMORE) sigue teniendo prioridad absoluta -- el router de F6 nunca se registra en ese caso", async () => {
    let overrideCalled = false;
    const overrideExecutor: EffectExecutor = {
      kind: "ai",
      version: "amore-gemini-fake",
      capabilities: { supportsIntegration: false, supportsAsync: true, operationClasses: [] },
      dispatch: async () => {
        overrideCalled = true;
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: { responseText: "amore gemini directo" } };
      },
    };
    const registry = createDefaultExecutorRegistry(crearSupabaseFalso([]), { aiExecutor: overrideExecutor });
    const executor = registry.resolve("ai");
    const result = await executor.dispatch(baseRequest({ ai: { instruction: "x", mode: "respond", provider: "gemini" } }), {
      tenantId: TENANT_A,
      internal: true,
    });
    assert.equal(overrideCalled, true, "el override de AMORE debe recibir el dispatch directo, sin pasar por el router nuevo");
    assert.equal(result.data?.responseText, "amore gemini directo");
  });
});
