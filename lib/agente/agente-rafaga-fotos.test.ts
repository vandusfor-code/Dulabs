/**
 * Bloque 30 — velocidad y ráfagas (solo números con checkout conversacional):
 *  - varias fotos seguidas (cada una en su propio webhook) => UNA sola respuesta;
 *  - aviso de espera único si el modelo tarda (nunca después de la respuesta);
 *  - un BOTÓN no espera el freno de ráfaga del webhook.
 * Sin red ni Supabase.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createCatalogService } from "@/lib/catalogo/service";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import type { AIProvider } from "@/lib/ia-proveedores/contrato";
import { createMemoryAgentConfigStore, type AgentConfigRow } from "@/lib/agente/config";
import { createMemoryConversationStateStore } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { ESPERA_RAFAGA_MS, atenderConAgenteSiAplica, esperaDeRafagaMs, fotoParaBuzon, type AgentBoundaryDeps } from "@/lib/agente/webhook";
import { createMemoryMailboxStore } from "@/lib/agente/buzon";
import { FOTO_SIN_REFERENCIA, MEDIA_MESSAGES, NON_TEXT_MESSAGES } from "@/lib/agente/entrada";
import { HOLD_NOTICE_TEXT, withHoldNotice } from "@/lib/agente/runtime";

const T = "aaaaaaaa-0000-4000-8000-00000000000a";
const PN = "100000000000001";
const WA = "573001112233";
const cliente = { id_tenant: T, phone_number_id: PN };
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
  checkout_conversacional: true,
  ...over,
});

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let state: ReturnType<typeof createMemoryConversationStateStore>;
let mailbox: ReturnType<typeof createMemoryMailboxStore>;
let sent: string[];
let lecturas: string[];
let seq: number;

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  mem.enableModule(T);
  state = createMemoryConversationStateStore();
  mailbox = createMemoryMailboxStore();
  sent = [];
  lecturas = [];
  seq = 0;
});

const producto = (name: string) => createCatalogService({ repo: mem.repo }).createProduct({ tenantId: T, userId: "admin" }, { name, retailPrice: 45_000, stock: 5 });

function lento(base: AIProvider, ms: number): AIProvider {
  return { id: base.id, generate: async (req, signal) => (await new Promise((r) => setTimeout(r, ms)), base.generate(req, signal)) };
}

function deps(opts: { script?: SimulatedStep[]; refs?: Record<string, string[]>; row?: AgentConfigRow; delayMs?: number; holdNoticeMs?: number } = {}) {
  const provider = createSimulatedProvider(opts.script ?? [{ text: "¡Las tengo! 💖" }]);
  const engine = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: mem.repo, key: Buffer.alloc(32, 1), log: () => {} });
  const d: AgentBoundaryDeps = {
    configStore: createMemoryAgentConfigStore([opts.row ?? row()]),
    env: { GEMINI_KEY_DELACOUR: "k-no-real" },
    factories: { gemini: () => (opts.delayMs ? lento(provider, opts.delayMs) : provider) },
    logError: () => {},
    build() {
      return {
        tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true },
        state,
        history: { recent: async () => [] },
        sender: { sendText: async (t) => (sent.push(t), true), sendImage: async () => true, humanTookOver: async () => false },
        log: () => {},
        mailbox,
        imageReader: () => async (mediaId) => (lecturas.push(mediaId), opts.refs?.[mediaId] ?? []),
        ...(opts.holdNoticeMs !== undefined ? { holdNoticeMs: opts.holdNoticeMs } : {}),
      };
    },
  };
  return { d, provider };
}

const foto = (mediaId: string, extra: { caption?: string; soloEncolar?: boolean } = {}) => ({
  cliente,
  waId: WA,
  destino: WA,
  wamid: `wamid.${++seq}`,
  text: "",
  nonText: { kind: "image" as const, mediaId, caption: extra.caption ?? null },
  ...(extra.soloEncolar ? { soloEncolar: true } : {}),
});

describe("B30 · ráfaga de fotos => UNA sola respuesta", () => {
  it("3 fotos seguidas (2 con referencia legible, 1 sin): se leen las 3 y el modelo responde UNA vez con todo", async () => {
    const a = await producto("Pulsera Corazón");
    const b = await producto("Aretes Luna");
    const { d, provider } = deps({ refs: { m1: [a.reference], m2: [b.reference] } });
    // Las dos primeras las superó la tercera (freno de ráfaga): solo se encolan.
    assert.deepEqual(await atenderConAgenteSiAplica(foto("m1", { soloEncolar: true }), d), { handled: true, outcome: "queued" });
    assert.deepEqual(await atenderConAgenteSiAplica(foto("m2", { soloEncolar: true }), d), { handled: true, outcome: "queued" });
    const r = await atenderConAgenteSiAplica(foto("m3"), d);
    assert.equal(r.handled && r.outcome, "replied");
    assert.deepEqual(lecturas, ["m1", "m2", "m3"]);
    assert.equal(provider.requests.length, 1, "un solo turno del modelo para las 3 fotos");
    const pedido = JSON.stringify(provider.requests[0]);
    for (const x of [`referencia en la foto: ${a.reference}`, `referencia en la foto: ${b.reference}`, FOTO_SIN_REFERENCIA]) assert.ok(pedido.includes(x), x);
    assert.deepEqual(sent, ["¡Las tengo! 💖"], "una sola respuesta");
  });

  it("3 fotos sin texto ni referencia legible: UN aviso (plural) que pide las referencias, sin modelo", async () => {
    const { d, provider } = deps();
    await atenderConAgenteSiAplica(foto("m1", { soloEncolar: true }), d);
    await atenderConAgenteSiAplica(foto("m2", { soloEncolar: true }), d);
    await atenderConAgenteSiAplica(foto("m3"), d);
    assert.equal(provider.requests.length, 0);
    assert.deepEqual(sent, [MEDIA_MESSAGES.pideReferencia("image", 3)]);
    assert.match(sent[0], /3 fotos/);
  });

  it("foto con texto de producto en la ráfaga: el texto y la referencia llegan juntos al modelo", async () => {
    const a = await producto("Pulsera Corazón");
    const { d, provider } = deps({ refs: { m1: [a.reference] } });
    await atenderConAgenteSiAplica(foto("m1", { caption: "Me gustó esta" }), d);
    const pedido = JSON.stringify(provider.requests[0]);
    assert.ok(pedido.includes("Me gustó esta") && pedido.includes(`referencia en la foto: ${a.reference}`));
  });

  it("tope de costo: en una ráfaga de 13 fotos se leen como máximo 10", async () => {
    const { d } = deps();
    for (let i = 1; i <= 12; i++) await atenderConAgenteSiAplica(foto(`m${i}`, { soloEncolar: true }), d);
    await atenderConAgenteSiAplica(foto("m13"), d);
    assert.ok(lecturas.length <= 10, `se leyeron ${lecturas.length}`);
    assert.equal(sent.length, 1);
  });

  it("con el registro del pedido en curso, la foto NO va al buzón (se pide el dato que falta) y no se lee", async () => {
    const key = { tenantId: T, phoneNumberId: PN, waId: WA };
    const built = deps().d.build(foto("m1"))!;
    const lector = async (id: string) => (lecturas.push(id), []);
    const base = { tools: built.tools, readImageReferences: lector };
    // Control: sin registro en curso, la foto sí va al buzón (y se lee).
    const libre = { ...base, state: { load: async () => ({ state: { checkout: null }, version: 1, reset: false }) } };
    assert.equal(await fotoParaBuzon(libre as never, mailbox, key, foto("m0")), FOTO_SIN_REFERENCIA);
    assert.deepEqual(lecturas, ["m0"]);
    const enCheckout = { ...base, state: { load: async () => ({ state: { checkout: { step: "delivery" } }, version: 1, reset: false }) } };
    assert.equal(await fotoParaBuzon(enCheckout as never, mailbox, key, foto("m1")), null);
    assert.deepEqual(lecturas, ["m0"], "en el registro del pedido no se lee la foto");
  });

  it("aislamiento: sin el checkout conversacional, una foto pasa a una asesora como siempre (ni buzón ni lectura)", async () => {
    const { d, provider } = deps({ row: row({ checkout_conversacional: false }) });
    const r = await atenderConAgenteSiAplica(foto("m1", { caption: "¿tienen este?" }), d);
    // Política de siempre: traspaso a una asesora (aquí sin pausa configurada => el aviso veraz de siempre).
    assert.ok(r.handled && ["handoff", "fallback"].includes(r.outcome as string));
    assert.ok([NON_TEXT_MESSAGES.handoff("image"), NON_TEXT_MESSAGES.handoffFailed("image")].includes(sent[0]), sent[0]);
    assert.equal(sent.length, 1);
    assert.deepEqual(lecturas, []);
    assert.equal(provider.requests.length, 0);
    assert.equal(mailbox.rows.length, 0);
  });
});

describe("B30 · aviso de espera si el modelo tarda", () => {
  const texto = () => ({ cliente, waId: WA, destino: WA, wamid: `wamid.t${++seq}`, text: "busco aretes dorados" });

  it("modelo lento: sale UN aviso y luego la respuesta, en ese orden", async () => {
    const { d } = deps({ delayMs: 80, holdNoticeMs: 20 });
    await atenderConAgenteSiAplica(texto(), d);
    assert.deepEqual(sent, [HOLD_NOTICE_TEXT, "¡Las tengo! 💖"]);
  });

  it("modelo rápido: sin aviso", async () => {
    const { d } = deps({ holdNoticeMs: 200 });
    await atenderConAgenteSiAplica(texto(), d);
    assert.deepEqual(sent, ["¡Las tengo! 💖"]);
  });

  it("sin el checkout conversacional: sin aviso aunque el modelo tarde (los demás negocios no cambian)", async () => {
    const { d } = deps({ delayMs: 80, holdNoticeMs: 20, row: row({ checkout_conversacional: false }) });
    await atenderConAgenteSiAplica(texto(), d);
    assert.deepEqual(sent, ["¡Las tengo! 💖"]);
  });

  it("withHoldNotice: nunca sale después de la respuesta ni dos veces", async () => {
    const out: string[] = [];
    const base = { sendText: async (t: string) => (out.push(t), true), sendImage: async () => true, humanTookOver: async () => false };
    let avisos = 0;
    const h = withHoldNotice(base, 10, () => avisos++);
    h.start();
    await h.sender.sendText("respuesta");
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(out, ["respuesta"]);
    const h2 = withHoldNotice(base, 5, () => avisos++);
    h2.start();
    await new Promise((r) => setTimeout(r, 20));
    h2.start();
    await new Promise((r) => setTimeout(r, 20));
    await h2.sender.sendText("final");
    assert.deepEqual(out, ["respuesta", HOLD_NOTICE_TEXT, "final"]);
    assert.equal(avisos, 1);
  });
});

describe("B30 · botones sin freno de ráfaga", () => {
  it("un BOTÓN de un número con agente no espera; todo lo demás, 2,5 s como siempre", () => {
    assert.equal(esperaDeRafagaMs({ agenteListo: true, esBoton: true }), 0);
    assert.equal(esperaDeRafagaMs({ agenteListo: true, esBoton: false }), ESPERA_RAFAGA_MS);
    assert.equal(esperaDeRafagaMs({ agenteListo: false, esBoton: true }), ESPERA_RAFAGA_MS);
    assert.equal(ESPERA_RAFAGA_MS, 2_500);
  });

  it("webhook: 'escribiendo…' antes del freno solo con agente; sin agente, el typing de siempre tras el freno", () => {
    const src = readFileSync(join(process.cwd(), "app/webhook-dulabs/route.ts"), "utf8");
    const iTyping = src.indexOf("if (agenteListo && tokenMeta) {");
    const iFreno = src.indexOf("esperaDeRafagaMs({ agenteListo, esBoton: botonDelAgente(mensaje) !== null })");
    const iMasReciente = src.indexOf("const { data: masReciente }");
    assert.ok(iTyping > 0 && iTyping < iFreno && iFreno < iMasReciente);
    assert.match(src, /if \(tokenMeta && !agenteListo\) \{\n\s+await marcarLeidoConTyping/);
    assert.doesNotMatch(src, /setTimeout\(resolve, 2500\)/, "la espera fija quedó en un solo lugar (esperaDeRafagaMs)");
  });
});
