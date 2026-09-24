/**
 * Bloque 11 — un solo turno del agente a la vez por conversación (buzón + turno).
 *
 * Concurrencia REAL dentro del proceso: los turnos se detienen en promesas que la prueba
 * controla, así se reproducen exactamente las carreras de producción (dos mensajes
 * seguidos, un proceso caído, una ráfaga). Gemini SIMULADO; nada toca Supabase.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import type { AIGenerateRequest } from "@/lib/ia-proveedores/contrato";
import type { AIProvider } from "@/lib/ia-proveedores/contrato";
import { createMemoryAgentConfigStore, type AgentConfigRow } from "@/lib/agente/config";
import { batchInput, createMemoryMailboxStore, drain, enqueueAndDrain, type MailboxMessage } from "@/lib/agente/buzon";
import { createMemoryConversationStateStore, type ConversationStateStore } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { atenderConAgenteSiAplica, encolarEnBuzonSiAplica, type AgentBoundaryDeps } from "@/lib/agente/webhook";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const PN = "100000000000001";
const CLIENTE = "573001112233";
const KEY = { tenantId: A.tenantId, phoneNumberId: PN, waId: CLIENTE };
const msg = (wamid: string, text: string, replyTo: MailboxMessage["replyTo"] = null): MailboxMessage => ({ wamid, text, replyTo });

/** Promesa que la prueba libera cuando quiere (simula a Gemini "pensando"). */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}
const tick = () => new Promise((r) => setImmediate(r));

describe("buzón: turno único y ráfagas (unidad)", () => {
  it("la ráfaga se atiende junta: textos en orden, el wamid más nuevo y la foto citada más reciente", () => {
    const b = batchInput([msg("w1", "quiero este", { wamid: "foto-2", forwarded: false }), msg("w2", "2 unidades")]);
    assert.deepEqual(b, { text: "quiero este\n2 unidades", wamid: "w2", wamids: ["w1", "w2"], replyTo: { wamid: "foto-2", forwarded: false } });
  });

  it("dos mensajes seguidos: NUNCA dos turnos en paralelo; el segundo lo atiende el turno en curso", async () => {
    const store = createMemoryMailboxStore();
    let running = 0;
    let maxRunning = 0;
    const batches: string[][] = [];
    const g = gate();
    const runTurn = async (batch: MailboxMessage[]) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      batches.push(batch.map((m) => m.wamid));
      if (batches.length === 1) await g.p; // el primer turno tarda (Gemini pensando)
      running--;
      return batches.length;
    };
    const p1 = enqueueAndDrain(store, KEY, msg("w1", "quiero ver aretes"), runTurn);
    await tick();
    const r2 = await enqueueAndDrain(store, KEY, msg("w2", "dorados"), runTurn);
    assert.deepEqual(r2, { status: "queued" }, "el segundo proceso no corre un turno propio");
    g.open();
    const r1 = await p1;
    assert.deepEqual(r1, { status: "drained", turns: 2, leftPending: false, lost: false });
    assert.deepEqual(batches, [["w1"], ["w2"]]);
    assert.equal(maxRunning, 1);
    assert.equal(store.leases.size, 0, "el turno quedó libre");
  });

  it("mensaje que llega justo cuando el dueño suelta el turno: nunca queda sin atender", async () => {
    const store = createMemoryMailboxStore();
    const seen: string[] = [];
    const runTurn = async (batch: MailboxMessage[]) => {
      seen.push(...batch.map((m) => m.wamid));
      // Mientras se procesa w1, w2 entra al buzón pero no consigue el turno.
      if (seen.length === 1) assert.deepEqual(await enqueueAndDrain(store, KEY, msg("w2", "y otro"), async () => 99), { status: "queued" });
      return 1;
    };
    await enqueueAndDrain(store, KEY, msg("w1", "hola"), runTurn);
    assert.deepEqual(seen, ["w1", "w2"], "soltar el turno vuelve a mirar el buzón");
  });

  it("reintento de Meta (mismo wamid): no se encola dos veces ni genera otro turno", async () => {
    const store = createMemoryMailboxStore();
    let turns = 0;
    await enqueueAndDrain(store, KEY, msg("w1", "hola"), async () => ++turns);
    const again = await enqueueAndDrain(store, KEY, msg("w1", "hola"), async () => ++turns);
    assert.deepEqual(again, { status: "drained", turns: 0, leftPending: false, lost: false });
    assert.equal(turns, 1);
  });

  it("proceso caído con el turno: al vencer, el siguiente mensaje atiende TODO lo pendiente", async () => {
    let now = 1_000_000;
    const store = createMemoryMailboxStore({ now: () => now });
    await store.enqueue(KEY, msg("w1", "quiero un dije"));
    assert.equal(await store.acquire(KEY, "w1", 60), true); // el proceso de w1 se cae aquí
    assert.deepEqual(await enqueueAndDrain(store, KEY, msg("w2", "¿hola?"), async () => 1, { now: () => now }), { status: "queued" }, "turno vigente: espera");
    now += 61_000;
    const batches: string[][] = [];
    const r = await enqueueAndDrain(store, KEY, msg("w3", "¿me atienden?"), async (b) => (batches.push(b.map((m) => m.wamid)), 1), { now: () => now });
    assert.equal(r.status, "drained");
    assert.deepEqual(batches, [["w1", "w2", "w3"]]);
  });

  it("pendientes viejos (p. ej. mientras una asesora tenía el chat) se cierran sin responder", async () => {
    let now = 1_000_000;
    const store = createMemoryMailboxStore({ now: () => now });
    await store.enqueue(KEY, msg("w1", "mensaje de hace rato"));
    now += 20 * 60_000;
    const batches: string[][] = [];
    await enqueueAndDrain(store, KEY, msg("w2", "hola de nuevo"), async (b) => (batches.push(b.map((m) => m.wamid)), 1), { now: () => now });
    assert.deepEqual(batches, [["w2"]]);
    assert.equal(store.rows.find((r) => r.wamid === "w1")?.processed, true);
  });

  it("un turno que falla cierra sus mensajes (nunca un bucle sobre el mismo mensaje)", async () => {
    const store = createMemoryMailboxStore();
    let calls = 0;
    const r = await enqueueAndDrain(store, KEY, msg("w1", "hola"), async () => {
      calls++;
      throw new Error("boom");
    });
    assert.equal(calls, 1);
    assert.deepEqual(r, { status: "drained", turns: 1, leftPending: false, lost: false });
  });

  it("presupuesto de tiempo: no empieza otro turno si no alcanza; lo pendiente queda para el siguiente mensaje", async () => {
    let now = 0;
    const store = createMemoryMailboxStore({ now: () => now });
    const runTurn = async () => {
      now += 50_000; // un turno lento
      await store.enqueue(KEY, msg(`w${now}`, "otro"));
      return 1;
    };
    const r = await enqueueAndDrain(store, KEY, msg("w1", "hola"), runTurn, { now: () => now, budgetMs: 45_000 });
    assert.deepEqual(r, { status: "drained", turns: 1, leftPending: true, lost: false });
    assert.equal(store.leases.size, 0, "suelta el turno para que otro lo tome");
  });

  it("otro negocio nunca toma el turno ni ve el buzón de esta conversación", async () => {
    const store = createMemoryMailboxStore();
    await store.enqueue(KEY, msg("w1", "hola"));
    const otro = { ...KEY, tenantId: "bbbbbbbb-0000-4000-8000-00000000000b" };
    assert.equal(await store.acquire(KEY, "w1", 60), true);
    assert.equal(await store.acquire(otro, "x", 60), false);
    assert.deepEqual(await store.pending(otro, 10), []);
    assert.equal(await drain(store, otro, "x", async () => 1).then((r) => r.status), "queued");
  });
});

// ---------------------------------------------------------------------------

describe("frontera webhook -> agente con buzón (carreras reales)", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let admin: ReturnType<typeof createCatalogService>;
  let stateStore: ConversationStateStore;
  let sent: string[];

  beforeEach(() => {
    mem = createInMemoryCatalogRepository();
    admin = createCatalogService({ repo: mem.repo });
    mem.enableModule(A.tenantId);
    stateStore = createMemoryConversationStateStore();
    sent = [];
  });

  const row = (over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({
    id_tenant: A.tenantId,
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

  /**
   * "Gemini" que agrega al carrito las referencias escritas en el mensaje actual; el PRIMER turno
   * se queda pensando hasta que la prueba lo libera.
   */
  function gemini(firstTurn: ReturnType<typeof gate> | null) {
    let turn = 0;
    const requests: AIGenerateRequest[] = [];
    const provider: AIProvider = {
      id: "gemini",
      async generate(req) {
        requests.push(structuredClone(req));
        const last = req.turns.at(-1)!;
        if (last.role === "user") {
          turn++;
          if (turn === 1 && firstTurn) await firstTurn.p;
          const refs = [...last.text.toUpperCase().matchAll(/DL-\d{6}/g)].map((m) => m[0]);
          return { provider: "gemini", model: req.model, text: null, toolCalls: [{ id: `c${turn}`, name: "update_cart", args: { items: refs.map((reference) => ({ reference, quantity: 1 })) } }], finish: "tool_calls", usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: null, cachedTokens: null }, continuation: null, latencyMs: 1 };
        }
        return { provider: "gemini", model: req.model, text: "Listo, lo agregué.", toolCalls: [], finish: "stop", usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: null, cachedTokens: null }, continuation: null, latencyMs: 1 };
      },
    };
    return { provider, requests };
  }

  function deps(provider: AIProvider, mailbox: ReturnType<typeof createMemoryMailboxStore> | null): AgentBoundaryDeps {
    const engine = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: mem.repo, key: Buffer.alloc(32, 9), log: () => {} });
    return {
      configStore: createMemoryAgentConfigStore([row()]),
      env: { GEMINI_KEY_DELACOUR: "k-no-real" },
      factories: { gemini: () => provider },
      logError: () => {},
      build: () => ({
        tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true },
        state: stateStore,
        history: { recent: async () => [] },
        sender: { sendText: async (t) => (sent.push(t), true), sendImage: async () => true, humanTookOver: async () => false },
        log: () => {},
        ...(mailbox ? { mailbox } : {}),
      }),
    };
  }
  const input = (wamid: string, text: string) => ({ cliente: { id_tenant: A.tenantId, phone_number_id: PN }, waId: CLIENTE, destino: CLIENTE, wamid, text });

  it("SIN buzón (antes): dos mensajes en paralelo pierden un cambio del carrito — el problema que resuelve el bloque", async () => {
    const p1 = await admin.createProduct(A, { name: "Anillo", retailPrice: 10_000, stock: 5 });
    const p2 = await admin.createProduct(A, { name: "Dije", retailPrice: 20_000, stock: 5 });
    const g = gate();
    const { provider } = gemini(g);
    const d = deps(provider, null);
    const t1 = atenderConAgenteSiAplica(input("w1", `quiero el ${p1.reference}`), d);
    await tick();
    await atenderConAgenteSiAplica(input("w2", `y el ${p2.reference}`), d);
    g.open();
    await t1;
    const cart = (await stateStore.load(KEY)).state.cart.map((c) => c.reference);
    assert.equal(cart.length, 1, "el turno lento no pudo guardar: su cambio se perdió");
    assert.equal(sent.length, 2, "…aunque ambos respondieron 'agregado'");
  });

  it("CON buzón: el segundo mensaje espera su turno; el carrito conserva AMBOS cambios", async () => {
    const p1 = await admin.createProduct(A, { name: "Anillo", retailPrice: 10_000, stock: 5 });
    const p2 = await admin.createProduct(A, { name: "Dije", retailPrice: 20_000, stock: 5 });
    const g = gate();
    const { provider, requests } = gemini(g);
    const mailbox = createMemoryMailboxStore();
    const d = deps(provider, mailbox);
    const t1 = atenderConAgenteSiAplica(input("w1", `quiero el ${p1.reference}`), d);
    await tick();
    const r2 = await atenderConAgenteSiAplica(input("w2", `y el ${p2.reference}`), d);
    assert.deepEqual(r2, { handled: true, outcome: "queued" });
    g.open();
    const r1 = await t1;
    assert.deepEqual(r1, { handled: true, outcome: "replied", turns: 2 });
    const cart = (await stateStore.load(KEY)).state.cart.map((c) => c.reference).sort();
    assert.deepEqual(cart, [p1.reference, p2.reference].sort());
    assert.equal(sent.length, 2);
    assert.equal(requests.filter((q) => q.turns.at(-1)!.role === "user").length, 2, "un turno por mensaje, en serie");
  });

  it("ráfaga: el mensaje que el freno deja pasar entra al buzón y el turno del más nuevo atiende ambos juntos (con la referencia del primero)", async () => {
    const p1 = await admin.createProduct(A, { name: "Anillo", retailPrice: 10_000, stock: 5 });
    const { provider, requests } = gemini(null);
    const mailbox = createMemoryMailboxStore();
    const d = deps(provider, mailbox);
    assert.equal(await encolarEnBuzonSiAplica(input("w1", `quiero el ${p1.reference}`), { configStore: d.configStore, mailbox }), true);
    const r = await atenderConAgenteSiAplica(input("w2", "por favor"), d);
    assert.deepEqual(r, { handled: true, outcome: "replied", turns: 1 });
    const userTurn = requests[0].turns.at(-1) as { text: string };
    assert.equal(userTurn.text, `quiero el ${p1.reference}\npor favor`);
    assert.deepEqual(
      (await stateStore.load(KEY)).state.cart.map((c) => c.reference),
      [p1.reference],
      "la referencia del primer mensaje de la ráfaga es válida (procedencia del cliente)",
    );
    assert.deepEqual((await stateStore.load(KEY)).state.recentWamids.slice(-2), ["w1", "w2"]);
  });

  it("sin agente válido, el freno de ráfaga no encola nada", async () => {
    const mailbox = createMemoryMailboxStore();
    const configStore = createMemoryAgentConfigStore([row({ habilitado: false })]);
    assert.equal(await encolarEnBuzonSiAplica(input("w1", "hola"), { configStore, mailbox }), false);
    assert.equal(mailbox.rows.length, 0);
  });

  it("sin la migración del buzón: un turno directo, como antes", async () => {
    const { provider } = gemini(null);
    const mailbox = createMemoryMailboxStore();
    mailbox.available = false;
    const r = await atenderConAgenteSiAplica(input("w1", "hola"), deps(provider, mailbox));
    assert.deepEqual(r, { handled: true, outcome: "replied" });
  });
});
