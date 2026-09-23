/**
 * Fase 8, Bloque 4 — frontera webhook -> agente. Sin red ni Supabase.
 * Garantías: sin fila => todo sigue igual; con fila => el mensaje es del
 * agente (nunca cae a otro bot ni a Claude), fail-closed ante config inválida.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { createSimulatedProvider } from "@/lib/ia-proveedores/simulado";
import { createMemoryAgentConfigStore, type AgentConfigRow, type AgentConfigStore } from "@/lib/agente/config";
import { createMemoryConversationStateStore } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { atenderConAgenteSiAplica, type AgentBoundaryDeps } from "@/lib/agente/webhook";

const T = "aaaaaaaa-0000-4000-8000-00000000000a";
const PN = "100000000000001";
const cliente = { id_tenant: T, phone_number_id: PN };
const input = { cliente, waId: "573001112233", destino: "573001112233", wamid: "wamid.x", text: "hola" };
const row = (over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({
  id_tenant: T,
  phone_number_id: PN,
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_DELACOUR",
  nivel_razonamiento: null,
  herramientas: [...AGENT_TOOL_NAMES],
  canal: "retail",
  negocio: {},
  ...over,
});

function deps(store: AgentConfigStore, opts: { env?: Record<string, string>; script?: Parameters<typeof createSimulatedProvider>[0] } = {}) {
  const calls = { build: 0, factories: [] as string[], sent: [] as string[], errors: [] as Array<Record<string, unknown>> };
  const mem = createInMemoryCatalogRepository();
  mem.enableModule(T);
  const provider = createSimulatedProvider(opts.script ?? [{ text: "¡Hola! ¿En qué te ayudo?" }]);
  const d: AgentBoundaryDeps = {
    configStore: store,
    env: opts.env ?? { GEMINI_KEY_DELACOUR: "k-no-real" },
    factories: { gemini: (k) => (calls.factories.push(k), provider) },
    logError: (e) => calls.errors.push(e),
    build() {
      calls.build++;
      const engine = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: mem.repo, key: Buffer.alloc(32, 1), log: () => {} });
      return {
        tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true },
        state: createMemoryConversationStateStore(),
        history: { recent: async () => [] },
        sender: { sendText: async (t) => (calls.sent.push(t), true), sendImage: async () => true, humanTookOver: async () => false },
        log: () => {},
      };
    },
  };
  return { d, calls, provider };
}

describe("frontera webhook -> agente", () => {
  it("sin fila para el número => handled:false (Flow / Business Agent / legacy siguen igual) y no se construye nada", async () => {
    const { d, calls } = deps(createMemoryAgentConfigStore([]));
    assert.deepEqual(await atenderConAgenteSiAplica(input, d), { handled: false, reason: "no_agent" });
    assert.equal(calls.build, 0);
    assert.deepEqual(calls.factories, []);
  });

  it("fila válida => atiende Gemini con la key del negocio y responde", async () => {
    const { d, calls, provider } = deps(createMemoryAgentConfigStore([row()]));
    const r = await atenderConAgenteSiAplica(input, d);
    assert.deepEqual(r, { handled: true, outcome: "replied" });
    assert.deepEqual(calls.factories, ["k-no-real"]);
    assert.equal(provider.requests[0].model, "gemini-3.6-flash");
    assert.deepEqual(calls.sent, ["¡Hola! ¿En qué te ayudo?"]);
  });

  it("fila apagada => silencio (NO cae a otro bot)", async () => {
    const { d, calls } = deps(createMemoryAgentConfigStore([row({ habilitado: false })]));
    assert.deepEqual(await atenderConAgenteSiAplica(input, d), { handled: true, outcome: "disabled" });
    assert.equal(calls.build, 0);
    assert.deepEqual(calls.sent, []);
  });

  it("config inválida (anthropic, modelo no soportado, otro tenant) => fail-closed, sin llamar a ningún modelo", async () => {
    for (const [over, reason] of [
      [{ proveedor: "anthropic" }, "provider_unsupported"],
      [{ modelo: "claude-sonnet-5" }, "model_unsupported"],
      [{ id_tenant: "bbbbbbbb-0000-4000-8000-00000000000b" }, "tenant_mismatch"],
    ] as const) {
      const { d, calls } = deps(createMemoryAgentConfigStore([row(over as Partial<AgentConfigRow>)]));
      assert.deepEqual(await atenderConAgenteSiAplica(input, d), { handled: true, outcome: "invalid_config", reason });
      assert.deepEqual(calls.factories, []);
      assert.deepEqual(calls.sent, []);
      assert.equal(calls.errors[0].reason, reason);
      assert.doesNotMatch(JSON.stringify(calls.errors), /573001112233/);
    }
  });

  it("falta la GEMINI_KEY del negocio => fail-closed (no usa la de plataforma ni Anthropic, no responde)", async () => {
    const { d, calls } = deps(createMemoryAgentConfigStore([row()]), { env: { GEMINI_KEY: "plataforma", ANTHROPIC_API_KEY: "sk-ant" } });
    assert.deepEqual(await atenderConAgenteSiAplica(input, d), { handled: true, outcome: "invalid_config", reason: "credential_missing" });
    assert.deepEqual(calls.factories, []);
    assert.deepEqual(calls.sent, []);
  });

  it("no se puede leer la configuración (tras un reintento) => fail-closed; un error puntual se recupera", async () => {
    let fallos = 2;
    const inestable: AgentConfigStore = { async getByPhoneNumber() { if (fallos-- > 0) throw new Error("db"); return null; } };
    const { d } = deps(inestable);
    assert.deepEqual(await atenderConAgenteSiAplica(input, d), { handled: true, outcome: "unavailable", reason: "config_unreadable" });
    fallos = 1;
    assert.deepEqual(await atenderConAgenteSiAplica(input, deps(inestable).d), { handled: false, reason: "no_agent" });
  });
});

describe("webhook: posición del agente y aislamiento de lo existente (guarda estructural)", () => {
  const fuente = readFileSync(join(process.cwd(), "app/webhook-dulabs/route.ts"), "utf8");
  const pos = (m: string) => {
    const i = fuente.indexOf(m);
    assert.notEqual(i, -1, `no se encontró "${m}"`);
    return i;
  };

  it("el agente corre DESPUÉS de lista negra, pausas, cupo, ráfaga y candado; ANTES de Flow, Business Agent y legacy", () => {
    const agente = pos("if (await intentarAgenteConversacionalSiAplica(cliente, mensaje, telefonoRemitente, destinoWhatsApp)) return;");
    for (const antes of [
      "esTelefonoBloqueado(cliente.ia_numeros_bloqueados, telefonoRemitente)",
      "if (cliente.ia_pausada) {",
      "if (cliente.ia_restringida_a) {",
      "if (!(await dentroDelCupoIA(cliente))) {",
      "const yaTengoCandado = await adquirirCandadoChat(",
      'etapa: "post_candado"',
    ]) {
      assert.ok(pos(antes) < agente, `debe ir antes del agente: ${antes}`);
    }
    for (const despues of ["if (await intentarBusinessAgentSiAplica(cliente, mensaje, telefonoRemitente)) return;", "const intentoFlow = await atenderMensajeConFlowConFallback({", "const contexto = await resolverContextoMensaje(cliente, destinoWhatsApp);"]) {
      assert.ok(agente < pos(despues), `debe ir después del agente: ${despues}`);
    }
  });

  it("la capa del agente y de proveedores no importa Anthropic, la IA legacy ni el Flow Engine", () => {
    const archivos: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) archivos.push(p);
      }
    };
    walk(join(process.cwd(), "lib/agente"));
    walk(join(process.cwd(), "lib/ia-proveedores"));
    for (const f of archivos) {
      const imports = [...readFileSync(f, "utf8").matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
      for (const mod of imports) {
        assert.doesNotMatch(mod, /anthropic|claude/i, `${f} importa ${mod}`);
        assert.notEqual(mod, "@/lib/ia", `${f} importa la IA legacy`);
        assert.doesNotMatch(mod, /^@\/lib\/(flow|agent-compiler)\//, `${f} importa ${mod}`);
      }
    }
  });
});
