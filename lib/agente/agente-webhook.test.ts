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
import { atenderConAgenteSiAplica, numeroConAgente, type AgentBoundaryDeps } from "@/lib/agente/webhook";
import { createMemoryMailboxStore } from "@/lib/agente/buzon";
import { NON_TEXT_MESSAGES } from "@/lib/agente/entrada";

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

function deps(store: AgentConfigStore, opts: { env?: Record<string, string>; script?: Parameters<typeof createSimulatedProvider>[0]; mailbox?: ReturnType<typeof createMemoryMailboxStore> } = {}) {
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
        ...(opts.mailbox ? { mailbox: opts.mailbox } : {}),
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

describe("Bloque 23: mensajes sin texto en la frontera", () => {
  const audio = { ...input, wamid: "wamid.audio", text: "", nonText: { kind: "audio" as const } };

  it("número SIN agente: handled:false (AMORE, Flow y legacy siguen igual); número con fila: el agente lo atiende sin Gemini", async () => {
    const sin = deps(createMemoryAgentConfigStore([]));
    assert.deepEqual(await atenderConAgenteSiAplica(audio, sin.d), { handled: false, reason: "no_agent" });
    assert.equal(await numeroConAgente(createMemoryAgentConfigStore([]), PN), false);
    assert.equal(await numeroConAgente(createMemoryAgentConfigStore([row({ habilitado: false })]), PN), true, "apagado sigue siendo del agente (silencio, no otro bot)");
    assert.equal(await numeroConAgente({ getByPhoneNumber: async () => { throw new Error("db"); } }, PN), false, "si no se puede leer: el comportamiento de siempre (se descarta)");
    const con = deps(createMemoryAgentConfigStore([row()]));
    assert.deepEqual(await atenderConAgenteSiAplica(audio, con.d), { handled: true, outcome: "replied" });
    assert.deepEqual(con.calls.sent, [NON_TEXT_MESSAGES.audio]);
    assert.equal(con.provider.requests.length, 0);
  });

  it("ráfaga 'texto + nota de voz': el texto que el freno de ráfaga dejó en el buzón se atiende PRIMERO (con Gemini), luego el aviso fijo", async () => {
    const mailbox = createMemoryMailboxStore();
    const key = { tenantId: T, phoneNumberId: PN, waId: input.waId };
    await mailbox.enqueue(key, { wamid: "wamid.texto", text: "hola, ¿tienen aretes?", replyTo: null });
    const { d, calls, provider } = deps(createMemoryAgentConfigStore([row()]), { mailbox });
    const r = await atenderConAgenteSiAplica(audio, d);
    assert.equal(r.handled, true);
    assert.deepEqual(calls.sent, ["¡Hola! ¿En qué te ayudo?", NON_TEXT_MESSAGES.audio], "en el orden en que escribió el cliente");
    assert.equal(provider.requests.length, 1, "Gemini solo para el texto");
    assert.match(JSON.stringify(provider.requests[0].turns.at(-1)), /tienen aretes/);
    assert.ok(mailbox.rows.every((m) => m.processed), "nada queda pendiente en el buzón");
    assert.ok(!mailbox.rows.some((m) => m.wamid === "wamid.audio"), "el audio no entra al buzón (no tiene texto)");
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

  it("el webhook le pasa al agente el mensaje CITADO (respuesta a una foto) o si fue reenviado", () => {
    const src = readFileSync(join(process.cwd(), "app/webhook-dulabs/route.ts"), "utf8");
    // Bloque 22: una ÚNICA lectura del context de Meta (replyToDeMeta, probada en agente-meta-contexto.test.ts).
    // Bloque 26: el toque de un botón no cita una foto (replyTo null) y lleva el id del botón.
    assert.match(src, /const replyTo = boton \? null : replyToDeMeta\(mensaje\.context\);/);
    assert.match(src, /atenderConAgenteSiAplica\(\{ cliente, waId: telefonoRemitente, destino, wamid: mensaje\.id, text: texto\.slice\(0, 4_000\), replyTo, buttonId: boton \}, deps\)/);
    assert.match(src, /const replyTo = botonDelAgente\(mensaje\) \? null : replyToDeMeta\(mensaje\.context\);/);
  });

  it("frontera: el contexto de respuesta llega al runtime (una cita desconocida => aclaración, nunca adivina)", async () => {
    const { d, provider } = deps(createMemoryAgentConfigStore([row()]), { script: [{ text: "¿Cuál producto te gustó? Respóndeme a su foto." }] });
    const r = await atenderConAgenteSiAplica({ ...input, text: "quiero este", replyTo: { wamid: "wamid.no.registrado" } }, d);
    assert.deepEqual(r, { handled: true, outcome: "replied" });
    assert.match(provider.requests[0].system, /"respondio_a":"un mensaje que no es una foto de producto"/);
  });

  it("Bloque 23: el MISMO gate registra (Inbox + freno de ráfaga) y enruta los mensajes sin texto al agente; sticker y reacción no pasan", () => {
    const src = readFileSync(join(process.cwd(), "app/webhook-dulabs/route.ts"), "utf8");
    // Registro síncrono: solo si el número tiene agente y el tipo llega al agente.
    assert.match(src, /some\(\(m\) => nonTextReachesAgent\(m\.type\)\)\s*\? await numeroConAgente\(createSupabaseAgentConfigStore\(supabase\), phoneNumberId\)/);
    assert.match(src, /conAgente && !procesaraMediaFlow && phoneNumberId !== PHONE_NUMBER_ID_SOLUCIONES_FINANCIERAS \? contenidoNoTextoAgente\(mensaje\)/);
    // Enrutamiento: mismo criterio (Flow y Soluciones Financieras no cambian).
    assert.match(src, /!esSolucionesFinancieras && !esMediaHaciaFlow && nonTextReachesAgent\(mensaje\.type\) && \(await numeroConAgenteMemo\(\)\)/);
    assert.equal((src.match(/&& !esNoTextoHaciaAgente\) continue;/g) ?? []).length, 2);
    // En el agente: política determinista, y el mensaje superado por la ráfaga igual se atiende.
    assert.match(src, /nonText: \{ kind: politica\.kind(?:, caption: leyendaDeMeta\(mensaje\), mediaId: mensaje\.image\?\.id \?\? null)? \}/);
    assert.match(src, /if \(nonTextReachesAgent\(mensaje\.type\)\) await intentarAgenteConversacionalSiAplica\(cliente, mensaje, telefonoRemitente, destino(?:, true)?\);/);
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
