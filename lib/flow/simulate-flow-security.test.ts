/**
 * Test de seguridad EXPLÍCITO — Fase 1 (Flow Simulator, autorizado, spec §29).
 *
 * "simulation must never perform external side effects": cubre, como mínimo,
 * Meta/WhatsApp, HTTP webhook, Claude, Gemini (puntos 18 y 19 de la
 * cobertura mínima pedida).
 *
 * Dos capas independientes, cualquiera de las dos debe alcanzar para
 * detectar una regresión real:
 *
 * 1. AUDITORÍA ESTÁTICA de imports: lee el código fuente de
 *    lib/flow/simulate-flow.ts y de cada lib/flow/executors/simulated-*.ts,
 *    y falla si alguno importa (directa o indirectamente vía specifier
 *    literal) cualquier módulo capaz de hacer una llamada real -- los
 *    executors reales (ClaudeExecutor/GeminiExecutor/SendMessageExecutor/
 *    InternalActionExecutor), la factory real de producción
 *    (lib/flow/executor-factory.ts, lib/flow/flow-orchestrator.ts), o
 *    cualquier cliente HTTP/SDK real (@anthropic-ai/sdk, lib/whatsapp*,
 *    lib/marketplace-citas, lib/especialistas-flow-adaptador, etc). Esto
 *    detecta el bug ANTES de ejecutar una sola línea -- si alguien agrega
 *    por error `import { ClaudeExecutor } from "..."` a un archivo del
 *    simulador, este test falla inmediatamente sin necesitar mocks.
 *
 * 2. PRUEBA DE COMPORTAMIENTO: corre una simulación completa que pasa por
 *    los 3 tipos de efecto despachable (send_message, ai, action/webhook)
 *    con un spy sobre `globalThis.fetch` que hace FALLAR el test si se
 *    invoca durante la simulación -- si alguna ruta de código terminara
 *    haciendo una llamada de red real (Meta, Claude, Gemini, un webhook),
 *    este test la atraparía en el acto.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FlowDefinition } from "@/lib/flow/types";
import { runSimulationTurn } from "@/lib/flow/simulate-flow";
import { createSimulatedExecutorRegistry } from "@/lib/flow/executors/simulated-executor-registry";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

const SIMULATOR_SOURCE_FILES = [
  "lib/flow/simulate-flow.ts",
  "lib/flow/executors/simulated-send-message-executor.ts",
  "lib/flow/executors/simulated-ai-executor.ts",
  "lib/flow/executors/simulated-action-executor.ts",
  "lib/flow/executors/simulated-executor-registry.ts",
  "app/api/flows/[id]/simulate/route.ts",
];

// Cualquier módulo capaz, directa o transitivamente, de producir una llamada
// externa real. Se compara contra el TEXTO LITERAL de cada import -- no hace
// falta resolver el grafo de módulos completo: ninguno de estos specifiers
// debe aparecer JAMÁS en el código fuente del simulador.
const FORBIDDEN_IMPORT_SPECIFIERS = [
  "@/lib/flow/executor-factory", // factory REAL de producción (createDefaultExecutorRegistry)
  "@/lib/flow/flow-orchestrator", // orchestrator REAL (persistencia + dispatch real)
  "@/lib/flow/executors/claude-executor",
  "@/lib/flow/executors/gemini-executor",
  "@/lib/flow/executors/send-message-executor", // el REAL (distinto de simulated-send-message-executor)
  "@/lib/flow/executors/internal-action-executor",
  "@/lib/flow/claude/anthropic-client",
  "@anthropic-ai/sdk",
  "@/lib/whatsapp",
  "@/lib/whatsapp-outbound",
  "@/lib/marketplace-citas",
  "@/lib/especialistas-flow-adaptador",
  "@/lib/catalogo-servicios-flow-adaptador",
  "@/lib/enterprise-leads",
  "@/lib/pausas-chat",
  "@/lib/flow/integration-resolver", // resuelve credenciales reales (dulabs_flow_credentials) -- el simulador nunca debe necesitarlo
];

describe("Seguridad — simulation must never perform external side effects", () => {
  describe("1. Auditoría estática de imports", () => {
    for (const relPath of SIMULATOR_SOURCE_FILES) {
      it(`${relPath} no importa ningún módulo real (Meta/WhatsApp/Claude/Gemini/webhook/orchestrator)`, () => {
        const source = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
        for (const forbidden of FORBIDDEN_IMPORT_SPECIFIERS) {
          assert.ok(
            !source.includes(`"${forbidden}"`) && !source.includes(`'${forbidden}'`),
            `${relPath} NO debe importar "${forbidden}" -- eso reintroduciría una ruta real hacia producción dentro del simulador`,
          );
        }
      });
    }
  });

  describe("2. Comportamiento -- cero llamadas de red reales durante una simulación completa", () => {
    it("send_message + ai + action(webhook_http) simulados -- fetch global NUNCA se invoca", async () => {
      const flow: FlowDefinition = {
        name: "seguridad-e2e",
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          { id: "msg", type: "message", config: { text: "Hola, esto se vería en WhatsApp real" } },
          { id: "ai", type: "ai", config: { instruction: "Responde", mode: "respond" } },
          { id: "wh", type: "action", config: { actionType: "webhook_http", url: "https://deberia-fallar-si-se-llama.example.com/hook", method: "POST" } },
          { id: "tpl", type: "action", config: { actionType: "enviar_plantilla", templateName: "bienvenida" } },
          { id: "end", type: "end", config: { message: "Fin" } },
        ],
        edges: [
          { id: "e1", source: "start", target: "msg" },
          { id: "e2", source: "msg", target: "ai" },
          { id: "e3", source: "ai", target: "wh", sourceHandle: "success" },
          { id: "e4", source: "wh", target: "tpl", sourceHandle: "success" },
          { id: "e5", source: "tpl", target: "end", sourceHandle: "success" },
        ],
        variables: [],
      };

      const originalFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = ((...args: unknown[]) => {
        fetchCalls += 1;
        throw new Error(`fetch() NO debe llamarse durante una simulación -- se llamó con: ${JSON.stringify(args[0])}`);
      }) as typeof fetch;

      try {
        const registry = createSimulatedExecutorRegistry();
        const r = await runSimulationTurn({ flow, engineState: null, event: { type: "start" }, registry, tenantId: "seguridad-test" });
        assert.equal(r.status, "completed", "la simulación completa debe correr de punta a punta sin necesitar red real");
        assert.equal(fetchCalls, 0, "fetch() nunca debe haberse invocado durante la simulación");
        // Confirma además que SÍ pasó por los 3 tipos de efecto (para que el
        // spy de fetch realmente haya tenido oportunidad de dispararse).
        assert.ok(r.effectsLog.some((e) => e.kind === "send_message"));
        assert.ok(r.effectsLog.some((e) => e.kind === "ai"));
        assert.ok(r.effectsLog.filter((e) => e.kind === "action").length === 2);
        assert.ok(r.effectsLog.every((e) => e.simulated === true));
        assert.ok(r.messages.every((m) => m.simulated === true));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("nodo action con actionType específico de AMORE/Daniela (agendar_cita_especialista) tampoco toca red real ni base de datos", async () => {
      const flow: FlowDefinition = {
        name: "seguridad-amore-action",
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          { id: "act", type: "action", config: { actionType: "agendar_cita_especialista", params: { especialistaId: "x", fecha: "2026-09-12" } } },
          { id: "end", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "act" },
          { id: "e2", source: "act", target: "end", sourceHandle: "success" },
        ],
        variables: [],
      };
      const originalFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = (() => {
        fetchCalls += 1;
        throw new Error("fetch() no debe llamarse");
      }) as typeof fetch;
      try {
        const r = await runSimulationTurn({
          flow,
          engineState: null,
          event: { type: "start" },
          registry: createSimulatedExecutorRegistry(),
          tenantId: "seguridad-test",
        });
        assert.equal(r.status, "completed");
        assert.equal(fetchCalls, 0);
        const actionEffect = r.effectsLog.find((e) => e.kind === "action");
        assert.equal(actionEffect?.data?.simulated, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
