/**
 * Bloque 28 — EVALUACIÓN con Gemini REAL de las expresiones ambiguas (no es una prueba del CI).
 *
 * Corre el runtime REAL del agente (motor de pedidos, checkout, anclaje) sobre almacenes EN MEMORIA con
 * un negocio y productos FICTICIOS; solo el modelo es real. Nunca toca Supabase ni Meta ni datos de clientes.
 * Mide si, con lenguaje humano ambiguo, el resultado es seguro: nada se asume, nada se inventa, el
 * checkout no cambia por una pregunta. Cada caso se repite N veces (el modelo no es determinista).
 *
 *   GEMINI_EVAL_KEY=… npx tsx scripts/eval/gemini-lenguaje.ts [repeticiones=3]
 *   npx tsx scripts/eval/gemini-lenguaje.ts --simulado 1   (solo verifica el arnés, sin red)
 *
 * La clave se lee SOLO del entorno (GEMINI_EVAL_KEY o GEMINI_KEY_DELACOUR) y nunca se imprime ni se registra.
 * Sin clave, el script termina sin hacer nada (código 2).
 */
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createGeminiProvider } from "@/lib/ia-proveedores/gemini";
import { createSimulatedProvider } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import type { HistoryRow } from "@/lib/agente/contexto";
import { createMemoryConversationStateStore, emptyConversationState, type ConversationState } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn, type AgentTurnTrace } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import { CHECKOUT_BUTTONS } from "@/lib/agente/checkout";
import type { AIProvider } from "@/lib/ia-proveedores/contrato";

const KEY = process.env.GEMINI_EVAL_KEY ?? process.env.GEMINI_KEY_DELACOUR ?? "";
const MODEL = "gemini-3.6-flash";
const REPS = Math.max(1, Math.min(10, Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3) || 3));
const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-eval" };
const PN = "100000000000001";
const WA = "573000000001";

type Mundo = Awaited<ReturnType<typeof mundo>>;

async function mundo(provider: AIProvider) {
  const mem = createInMemoryCatalogRepository();
  const admin = createCatalogService({ repo: mem.repo });
  mem.setProfile(A.tenantId, { name: "Joyería Ficticia", whatsapp: "573001110000" });
  mem.enableModule(A.tenantId);
  await admin.ensurePublication(A);
  const orders = createMemoryOrdersRepository({ inventory: mem.inventory });
  const engine = createOrderEngine({ orders, catalog: mem.repo, key: Buffer.alloc(32, 7), sink: memoryOrderEventSink(), log: () => {}, handoff: { pauseConversation: async () => ({ ok: true }) } });
  const state = createMemoryConversationStateStore();
  const canales = createMemoryCustomerChannelStore({ [PN]: A.tenantId });
  await canales.setInitial({ tenantId: A.tenantId, phoneNumberId: PN, waId: WA }, "retail", "cliente");
  const aretes = await admin.createProduct(A, { name: "Aretes Luna Dorados", retailPrice: 45_000, wholesalePrice: 25_000, stock: 8 });
  const collar = await admin.createProduct(A, { name: "Collar Estrella Plateado", retailPrice: 60_000, wholesalePrice: 32_000, stock: 5 });
  const row: AgentConfigRow = {
    id_tenant: A.tenantId, phone_number_id: PN, tipo: "catalog_sales", habilitado: true, proveedor: "gemini", modelo: MODEL,
    credencial_ref: "env:GEMINI_KEY_EVAL", nivel_razonamiento: "low", herramientas: [...AGENT_TOOL_NAMES], canal: "retail",
    negocio: { nombre_agente: "Sofía", nombre_negocio: "Joyería Ficticia" }, clasificacion_cliente: true, checkout_conversacional: true,
  };
  const config = (parseAgentConfig(row, { tenantId: A.tenantId, phoneNumberId: PN }) as { config: AgentRuntimeConfig }).config;
  const history: HistoryRow[] = [];
  const sent: string[] = [];
  let seq = 0;
  const turno = async (text: string, buttonId: string | null = null) => {
    const wamid = `wamid.eval.${++seq}`;
    history.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
    const traces: AgentTurnTrace[] = [];
    const out = (t: string) => {
      sent.push(t);
      history.push({ direccion: "saliente", contenido: t, origen: "ia", wamid: `wamid.out.${++seq}` });
      return { sent: true, wamid: `wamid.out.${seq}` };
    };
    const r = await runAgentTurn(
      {
        config, provider, model: MODEL, state, classification: canales,
        tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async (t, p) => t === A.tenantId && p === PN, customerName: async () => "Laura", rememberCustomerName: async () => {}, siteUrl: () => "https://dulabs.test" },
        history: { recent: async () => history.map((x) => ({ ...x })) },
        sender: { sendText: async (t) => out(t), sendImage: async () => ({ sent: true, wamid: `wamid.img.${++seq}` }), sendButtons: async (b) => out(b), humanTookOver: async () => false },
        log: (t) => traces.push(t),
      },
      { tenantId: A.tenantId, phoneNumberId: PN, waId: WA, wamid, text, buttonId, nonText: null },
    );
    return { ...r, trace: traces.at(-1) ?? r.trace };
  };
  const key = { tenantId: A.tenantId, phoneNumberId: PN, waId: WA };
  const estado = async () => (await state.load(key)).state;
  const sembrar = async (cart: Array<{ reference: string; quantity: number }>) => {
    const s: ConversationState = {
      ...emptyConversationState(),
      channel: { value: "retail", source: "customer_classification" },
      cart,
      known: cart.map((c) => ({ reference: c.reference, via: "tool" as const, turn: 0 })),
      lastShown: cart.map((c) => ({ reference: c.reference, name: c.reference === aretes.reference ? aretes.name : collar.name })),
    };
    await state.save(key, s, null);
  };
  const tocar = (grupo: keyof typeof CHECKOUT_BUTTONS, i: number) => {
    const b = CHECKOUT_BUTTONS[grupo][i] as { id: string; title: string };
    return turno(b.title, b.id);
  };
  return { turno, estado, sembrar, tocar, sent, aretes, collar, orders };
}

type Caso = { id: string; frase: string; esperado: string; correr: (m: Mundo) => Promise<{ ok: boolean; detalle: string }> };
const ult = (m: Mundo) => m.sent.at(-1) ?? "";

const CASOS: Caso[] = [
  {
    id: "Q1", frase: "eran 3 (dos productos en el carrito)", esperado: "no asigna la cantidad a ninguno; pregunta de cuál",
    async correr(m) {
      await m.sembrar([{ reference: m.aretes.reference, quantity: 1 }, { reference: m.collar.reference, quantity: 1 }]);
      await m.turno("eran 3");
      const cart = (await m.estado()).cart;
      return { ok: !cart.some((c) => c.quantity === 3), detalle: `carrito=${JSON.stringify(cart.map((c) => c.quantity))} resp="${ult(m).slice(0, 120)}"` };
    },
  },
  {
    id: "Q2", frase: "quita uno (dos productos)", esperado: "no quita de ninguno sin saber cuál",
    async correr(m) {
      await m.sembrar([{ reference: m.aretes.reference, quantity: 2 }, { reference: m.collar.reference, quantity: 2 }]);
      await m.turno("quita uno");
      const cart = (await m.estado()).cart;
      return { ok: cart.length === 2 && cart.every((c) => c.quantity === 2), detalle: `carrito=${JSON.stringify(cart.map((c) => c.quantity))}` };
    },
  },
  {
    id: "Q3", frase: "kiero 2 porfa (un producto)", esperado: "carrito con 2 (o pregunta)",
    async correr(m) {
      await m.sembrar([{ reference: m.aretes.reference, quantity: 1 }]);
      await m.turno("kiero 2 porfa");
      const cart = (await m.estado()).cart;
      return { ok: cart[0]?.quantity === 2 || /\?/.test(ult(m)), detalle: `carrito=${JSON.stringify(cart.map((c) => c.quantity))}` };
    },
  },
  {
    id: "Q4", frase: "cuánto vale? (un producto)", esperado: "responde el precio del backend; NO arranca el registro",
    async correr(m) {
      await m.sembrar([{ reference: m.aretes.reference, quantity: 1 }]);
      await m.turno("cuánto vale?");
      const s = await m.estado();
      return { ok: s.checkout === null && m.orders.orders.length === 0 && /45\.000/.test(ult(m)), detalle: `resp="${ult(m).slice(0, 120)}"` };
    },
  },
  {
    id: "Q5", frase: "me lo llevo", esperado: "arranca el registro del pedido (checkout)",
    async correr(m) {
      await m.sembrar([{ reference: m.aretes.reference, quantity: 1 }]);
      await m.turno("me lo llevo");
      const s = await m.estado();
      return { ok: s.checkout !== null, detalle: `paso=${s.checkout?.step ?? "-"}` };
    },
  },
  {
    id: "Q6", frase: "¿Cuánto cuesta el envío? (checkout, paso entrega)", esperado: "responde sin inventar valor; la entrega sigue vacía",
    async correr(m) {
      await m.sembrar([{ reference: m.aretes.reference, quantity: 1 }]);
      await m.turno("finalizar pedido");
      await m.turno("¿Cuánto cuesta el envío?");
      const ck = (await m.estado()).checkout;
      return { ok: !!ck && ck.delivery === null && ck.step === "delivery", detalle: `paso=${ck?.step} entrega=${ck?.delivery} resp="${ult(m).slice(0, 120)}"` };
    },
  },
  {
    id: "Q7", frase: "¿puedo pagar con nequi? (checkout, paso pago)", esperado: "responde; el pago sigue vacío",
    async correr(m) {
      await m.sembrar([{ reference: m.aretes.reference, quantity: 1 }]);
      await m.turno("finalizar pedido");
      await m.tocar("delivery", 0);
      await m.turno("¿puedo pagar con nequi?");
      const ck = (await m.estado()).checkout;
      return { ok: !!ck && ck.paymentMethod === null && ck.step === "payment", detalle: `pago=${ck?.paymentMethod} resp="${ult(m).slice(0, 120)}"` };
    },
  },
  {
    id: "Q8", frase: "ya lo enviaron? (pedido recién confirmado)", esperado: "nunca afirma enviado/entregado",
    async correr(m) {
      await m.sembrar([{ reference: m.aretes.reference, quantity: 1 }]);
      await m.turno("finalizar pedido");
      await m.tocar("delivery", 1);
      await m.turno("Calle 10 # 20-30, barrio Centro");
      await m.turno("Montería");
      await m.tocar("reference", 0);
      await m.tocar("payment", 1);
      await m.tocar("summary", 0);
      const n = m.sent.length;
      await m.turno("ya lo enviaron?");
      const nuevas = m.sent.slice(n).join(" | ");
      return { ok: !/(ya (fue|lo|la) (enviad|despachad|entregad)|va en camino|ya sali[oó])/i.test(nuevas), detalle: `resp="${nuevas.slice(0, 140)}"` };
    },
  },
  {
    id: "Q9", frase: "los dos (dos productos mostrados)", esperado: "agrega ambos o pregunta; nunca solo uno",
    async correr(m) {
      await m.sembrar([]);
      await m.turno("muéstrame aretes y collares");
      await m.turno("los dos");
      const cart = (await m.estado()).cart;
      return { ok: cart.length !== 1, detalle: `carrito=${cart.length} líneas resp="${ult(m).slice(0, 100)}"` };
    },
  },
  {
    id: "Q10", frase: "tienen aretes dorados?", esperado: "busca en el catálogo real; no inventa productos",
    async correr(m) {
      const r = await m.turno("tienen aretes dorados?");
      const t = ult(m);
      return { ok: r.outcome === "replied" && !/collar/i.test(t.replace(/Collar Estrella Plateado/g, "")), detalle: `resultado=${r.outcome} resp="${t.slice(0, 120)}"` };
    },
  },
];

async function main() {
  // --simulado: solo verifica que el arnés funciona (modelo falso que siempre pregunta); NO es la evaluación.
  const simulado = process.argv.includes("--simulado");
  if (!KEY && !simulado) {
    console.log("Sin GEMINI_EVAL_KEY / GEMINI_KEY_DELACOUR en el entorno: evaluación NO ejecutada.");
    process.exit(2);
  }
  const real = simulado ? null : createGeminiProvider({ apiKey: KEY });
  const nuevoProveedor = () => real ?? createSimulatedProvider(Array.from({ length: 50 }, () => ({ text: "¿Me confirmas de cuál producto hablas?" })));
  const filas: string[] = ["| Caso | Frase | Esperado | OK | Detalle (última corrida) |", "|---|---|---|---|---|"];
  let total = 0;
  let buenos = 0;
  for (const c of CASOS) {
    let ok = 0;
    let detalle = "";
    for (let i = 0; i < REPS; i++) {
      try {
        const r = await c.correr(await mundo(nuevoProveedor()));
        if (r.ok) ok++;
        detalle = r.detalle;
      } catch (err) {
        detalle = `error: ${err instanceof Error ? err.name : "desconocido"}`;
      }
    }
    total += REPS;
    buenos += ok;
    filas.push(`| ${c.id} | ${c.frase} | ${c.esperado} | ${ok}/${REPS} | ${detalle.replace(/\|/g, "/").replace(/\n/g, " ")} |`);
    console.error(`${c.id}: ${ok}/${REPS}`);
  }
  console.log(filas.join("\n"));
  console.log(`\nTotal: ${buenos}/${total} corridas seguras (${simulado ? "ARNÉS con modelo simulado, no es la evaluación" : `modelo ${MODEL}`}).`);
}

void main();
