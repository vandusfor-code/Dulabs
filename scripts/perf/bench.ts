/**
 * Rendimiento (Bloque 20) — mide el CÓDIGO REAL del catálogo, pedidos y herramientas del agente
 * contra una BD LOCAL con datos SINTÉTICOS (ver scripts/perf/README.md). Nunca contra Supabase.
 *
 * Por operación: latencia p50/p95 (ms), consultas HTTP a PostgREST por operación (detecta N+1),
 * bytes recibidos de la BD y, para las herramientas del agente, el tamaño de lo que recibiría
 * Gemini. Después, escenarios CONCURRENTES (búsquedas, carritos, confirmaciones, última unidad).
 *
 * Uso: PERF_REST=http://127.0.0.1:54440 npx tsx scripts/perf/bench.ts [--rondas 30] [--json salida.json]
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createCatalogService, createPublicCatalogService } from "@/lib/catalogo/service";
import { createOrderEngine, OrderError } from "@/lib/catalogo/pedidos/motor";
import { createSupabaseOrdersRepository, type OrderCursor } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { emptyConversationState, rememberReferences } from "@/lib/agente/estado";
import { executeAgentTool, type AgentTurnToolContext } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";

const REST = process.env.PERF_REST ?? "http://127.0.0.1:54440";
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const RONDAS = Number(arg("rondas", "30"));
const TENANT = "aaaaaaaa-0000-4000-8000-0000000000a1";
const SLUG = "joyeria-sintetica";
// Segundo negocio CON Catálogo (opcional: 01-sinteticos.sql -v n_segundo=2000): mismas referencias DL-…, nombres con « Q».
const TENANT_Q = "cccccccc-0000-4000-8000-0000000000c3";
const SLUG_Q = "joyeria-sintetica-dos";

// Contador de consultas y bytes por operación (envuelve el fetch de supabase-js).
let requests = 0;
let bytes = 0;
const supabase = createClient("http://perf.local", "local-sin-jwt", {
  auth: { persistSession: false },
  global: {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input).replace("http://perf.local/rest/v1", REST);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.delete("authorization");
      headers.delete("apikey");
      requests++;
      const res = await fetch(url, { ...init, headers, method: init?.method ?? (input instanceof Request ? input.method : "GET"), body: init?.body });
      const buf = await res.arrayBuffer();
      bytes += buf.byteLength;
      return new Response(buf.byteLength === 0 && [204, 205, 304].includes(res.status) ? null : buf, { status: res.status, statusText: res.statusText, headers: res.headers });
    },
  },
});

const catalog = createSupabaseCatalogRepository(supabase);
const orders = createSupabaseOrdersRepository(supabase);
const KEY = Buffer.alloc(32, 7);
const engine = createOrderEngine({ orders, catalog, key: KEY, log: () => {}, sink: memoryOrderEventSink() });
const publico = createPublicCatalogService({ repo: catalog, orders: { key: KEY, engine, events: memoryOrderEventSink() } });
const admin = createCatalogService({ repo: catalog });
const ADMIN = { tenantId: TENANT, userId: "perf-admin" };

type Resultado = { operacion: string; p50: number; p95: number; max: number; consultas: number; kb_bd: number; kb_gemini?: number; nota?: string };
const resultados: Resultado[] = [];
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function medir(operacion: string, fn: (i: number) => Promise<unknown>, opts: { rondas?: number; gemini?: (r: unknown) => number; nota?: string } = {}) {
  const n = opts.rondas ?? RONDAS;
  for (let i = 0; i < 3; i++) await fn(-1 - i); // calentamiento
  const tiempos: number[] = [];
  let reqs = 0;
  let b = 0;
  let gem = 0;
  for (let i = 0; i < n; i++) {
    const r0 = requests;
    const b0 = bytes;
    const t0 = performance.now();
    const out = await fn(i);
    tiempos.push(performance.now() - t0);
    reqs += requests - r0;
    b += bytes - b0;
    if (opts.gemini) gem = Math.max(gem, opts.gemini(out));
  }
  const r: Resultado = {
    operacion,
    p50: +pct(tiempos, 50).toFixed(1),
    p95: +pct(tiempos, 95).toFixed(1),
    max: +Math.max(...tiempos).toFixed(1),
    consultas: +(reqs / n).toFixed(1),
    kb_bd: +(b / n / 1024).toFixed(1),
    ...(opts.gemini ? { kb_gemini: +(gem / 1024).toFixed(2) } : {}),
    ...(opts.nota ? { nota: opts.nota } : {}),
  };
  resultados.push(r);
  console.log(JSON.stringify(r));
}

let conocidas: string[] = [];
let carrito: Array<{ reference: string; quantity: number }> = [];
function ctxAgente(waId: string): AgentTurnToolContext {
  return {
    tenantId: TENANT,
    phoneNumberId: "PN-PERF",
    waId,
    channel: "retail",
    requestId: randomUUID(),
    wamid: `wamid.perf.${randomUUID()}`,
    turn: 1,
    // Como en una conversación real: las referencias ya se le mostraron al cliente (guarda de procedencia).
    state: { ...rememberReferences(emptyConversationState(), conocidas, "tool"), cart: carrito },
    pendingChoice: new Set(),
    designated: new Set(),
    customerText: "",
    images: [],
    handedOff: false,
    handoffMotive: null,
    newProposal: null,
  };
}
const toolDeps = { engine, catalog, log: () => {}, ownsPhoneNumber: async () => true, siteUrl: () => "https://perf.local" };
const herramienta = async (name: string, args: Record<string, unknown>) => {
  const out = await executeAgentTool(name, args, AGENT_TOOL_NAMES, ctxAgente("573009990001"), toolDeps);
  // Un resultado de negocio (p. ej. AMBIGUOUS con candidatos) también es lo que recibe Gemini.
  if (!out.ok && !["AMBIGUOUS", "NOT_FOUND"].includes(out.error.code)) throw new Error(`${name}: ${out.error.code}`);
  return out.ok ? out.data : out.error;
};
const tamano = (x: unknown) => Buffer.byteLength(JSON.stringify(x));

async function main() {
  const { data: muestra } = await supabase.from("dulabs_inventario_productos").select("referencia, nombre, stock").eq("id_tenant", TENANT).eq("activo", true).gt("stock", 5).order("referencia").limit(80);
  const refs = (muestra ?? []).map((r) => r.referencia as string);
  const nombre = (muestra ?? [])[3].nombre as string;
  conocidas = refs.slice(0, 60);
  console.log(`# ${refs.length} referencias de muestra; rondas=${RONDAS}; rest=${REST}`);

  // --- Tienda pública ---------------------------------------------------------------------
  await medir("tienda: listado página 1", () => publico.getCatalog({ slug: SLUG, context: "retail" }));
  await medir("tienda: listado página 30 (profunda)", () => publico.getCatalog({ slug: SLUG, context: "retail", page: 30 }));
  await medir("tienda: inicio (destacados + portadas)", () => publico.getHome(SLUG));
  await medir("tienda: ficha de producto", (i) => publico.getProduct({ slug: SLUG, reference: refs[Math.abs(i) % refs.length] }));
  await medir("búsqueda: referencia exacta", (i) => publico.getCatalog({ slug: SLUG, context: "retail", q: refs[Math.abs(i) % refs.length] }));
  await medir("búsqueda: fragmento de referencia", () => publico.getCatalog({ slug: SLUG, context: "retail", q: "000184" }));
  await medir("búsqueda: una palabra frecuente (anillo)", () => publico.getCatalog({ slug: SLUG, context: "retail", q: "anillo" }));
  await medir("búsqueda: nombre (aretes luna)", () => publico.getCatalog({ slug: SLUG, context: "retail", q: "aretes luna" }));
  await medir("búsqueda: sin tildes (corazon)", () => publico.getCatalog({ slug: SLUG, context: "retail", q: "corazon" }));
  await medir("búsqueda: material/color (plata rosa)", () => publico.getCatalog({ slug: SLUG, context: "retail", q: "plata rosa" }));
  await medir("búsqueda: 3 palabras (collar perla dorado)", () => publico.getCatalog({ slug: SLUG, context: "retail", q: "collar perla dorado" }));
  await medir("búsqueda: sin coincidencia total (amplía)", () => publico.getCatalog({ slug: SLUG, context: "retail", q: "anillo zafiro morado" }));
  await medir("búsqueda: página 5 (oro)", () => publico.getCatalog({ slug: SLUG, context: "retail", q: "oro", page: 5 }));

  // --- Carrito y pedido desde la tienda -----------------------------------------------------
  await medir("carrito: resolver 5 referencias", () => publico.resolveSelection({ slug: SLUG, references: refs.slice(0, 5) }));
  await medir("carrito: resolver 60 referencias (máximo)", () => publico.resolveSelection({ slug: SLUG, references: refs.slice(0, 60) }));
  await medir("pedido tienda: validar + guardar (5 líneas)", async (i) => {
    const sel = await publico.resolveSelection({ slug: SLUG, references: refs.slice(10, 15) });
    return publico.prepareOrder({ slug: SLUG, items: refs.slice(10, 15).map((reference) => ({ reference, quantity: 1 })), quote: sel!.quote ?? undefined, requestKey: `perf-tienda-${i}-${randomUUID()}` });
  });

  // --- Pedido del agente: validar y confirmar (reserva atómica) ------------------------------
  await medir("agente: crear pedido validado (3 líneas)", (i) =>
    engine.createOrder({ tenantId: TENANT, channel: "retail", source: "agent", contact: { phoneNumberId: "PN-PERF", waId: `5730090${String(Math.abs(i)).padStart(5, "0")}` }, items: refs.slice(20, 23).map((reference) => ({ reference, quantity: 1 })), idempotencyKey: `agent:perf-${randomUUID()}` }),
  );
  await medir("agente: confirmar = reserva atómica (3 líneas)", async (i) => {
    const contact = { phoneNumberId: "PN-PERF", waId: `5730091${String(Math.abs(i)).padStart(5, "0")}` };
    const { order } = await engine.createOrder({ tenantId: TENANT, channel: "retail", source: "agent", contact, items: refs.slice(30, 33).map((reference) => ({ reference, quantity: 1 })), idempotencyKey: `agent:perf-${randomUUID()}` });
    const r0 = requests;
    const t0 = performance.now();
    const c = await engine.confirmOrder({ tenantId: TENANT, contact, orderId: order.orderId, confirmationId: order.confirmation!.id, actor: "agent" });
    confirmaciones.push({ ms: performance.now() - t0, consultas: requests - r0 });
    await engine.closeOrder({ tenantId: TENANT, orderId: order.orderId, action: "cancel" }); // devuelve el stock: la medición no lo agota
    return c;
  }, { nota: "incluye crear+confirmar+cancelar; la confirmación sola va en la fila siguiente" });
  resultados.push({ operacion: "  └ solo confirmar (reserva)", p50: +pct(confirmaciones.map((c) => c.ms), 50).toFixed(1), p95: +pct(confirmaciones.map((c) => c.ms), 95).toFixed(1), max: +Math.max(...confirmaciones.map((c) => c.ms)).toFixed(1), consultas: +(confirmaciones.reduce((n, c) => n + c.consultas, 0) / confirmaciones.length).toFixed(1), kb_bd: 0 });
  console.log(JSON.stringify(resultados.at(-1)));

  // --- Panel de pedidos de la asesora (con N pedidos abiertos) ------------------------------
  const { count: abiertos } = await supabase.from("dulabs_catalogo_pedidos").select("id", { count: "exact", head: true }).eq("id_tenant", TENANT).in("estado", ["pending_confirmation", "confirmed", "handoff"]);
  await medir(`panel: pedidos abiertos (hay ${abiertos})`, () => engine.listOpenOrders(TENANT, 100), { nota: "tope 100 por página" });

  // --- Historial de pedidos cerrados (cursor): recorrido completo exacto + costo por página ------
  const { count: cerrados } = await supabase.from("dulabs_catalogo_pedidos").select("id", { count: "exact", head: true }).eq("id_tenant", TENANT).in("estado", ["completed", "cancelled", "expired"]);
  const vistos = new Set<string>();
  let cursor: OrderCursor | null = null;
  let paginas = 0;
  do {
    const r = await engine.listClosedOrders(TENANT, { cursor, limit: 25 });
    for (const i of r.items) {
      if (vistos.has(i.order.orderId)) throw new Error(`FALLA historial: ${i.order.orderId} repetido`);
      if (i.order.businessId !== TENANT) throw new Error("FALLA historial: pedido de otro negocio");
      vistos.add(i.order.orderId);
    }
    cursor = r.next;
    paginas++;
  } while (cursor);
  if (vistos.size !== cerrados) throw new Error(`FALLA historial: recorrió ${vistos.size} de ${cerrados}`);
  let profundo: OrderCursor | null = null;
  for (let i = 0; i < Math.min(paginas - 1, 10); i++) profundo = (await engine.listClosedOrders(TENANT, { cursor: profundo, limit: 25 })).next;
  await medir(`panel: historial página 1 (hay ${cerrados} cerrados)`, () => engine.listClosedOrders(TENANT, { cursor: null, limit: 25 }), { nota: `recorrido completo por cursor: ${vistos.size}/${cerrados} en ${paginas} páginas, sin repetidos` });
  await medir("panel: historial página 11 (cursor)", () => engine.listClosedOrders(TENANT, { cursor: profundo, limit: 25 }));

  // --- Herramientas del agente (lo que recibe Gemini) ---------------------------------------
  await medir("gemini: search_products (aretes oro)", () => herramienta("search_products", { query: "aretes oro" }), { gemini: tamano });
  await medir("gemini: search_products (anillo)", () => herramienta("search_products", { query: "anillo" }), { gemini: tamano });
  await medir("gemini: resolve_product_by_reference", (i) => herramienta("resolve_product_by_reference", { reference: refs[Math.abs(i) % refs.length] }), { gemini: tamano });
  await medir("gemini: resolve_product_by_attributes", () => herramienta("resolve_product_by_attributes", { name: nombre }), { gemini: tamano });
  await medir("gemini: similar_products", (i) => herramienta("similar_products", { reference: refs[Math.abs(i) % 60] }), { gemini: tamano });
  carrito = refs.slice(40, 45).map((reference) => ({ reference, quantity: 1 }));
  await medir("gemini: resolve_order (carrito de 5 líneas)", () => herramienta("resolve_order", {}), { gemini: tamano });
  carrito = [];
  await medir("gemini: more_products (página siguiente)", () => herramienta("more_products", {}), { gemini: tamano });
  await medir("gemini: get_product_details", (i) => herramienta("get_product_details", { reference: refs[Math.abs(i) % 60] }), { gemini: tamano });
  await medir("gemini: request_product_images (3 fotos)", () => herramienta("request_product_images", { references: refs.slice(0, 3) }), { gemini: tamano });

  // --- Panel administrativo -------------------------------------------------------------------
  await medir("admin: listado página 1 (50)", () => admin.listProducts(ADMIN, { q: undefined, page: 1, pageSize: 50, status: "ALL" }));
  await medir("admin: listado página 100 (profunda)", () => admin.listProducts(ADMIN, { q: undefined, page: 100, pageSize: 50, status: "ALL" }));
  await medir("admin: buscar 'luna' (nombre o referencia)", () => admin.listProducts(ADMIN, { q: "luna", page: 1, pageSize: 50, status: "ALL" }));
  await medir("admin: ficha (producto + fotos)", async (i) => {
    const { data } = await supabase.from("dulabs_inventario_productos").select("id").eq("id_tenant", TENANT).eq("referencia", refs[Math.abs(i) % refs.length]).single();
    return admin.getProduct(ADMIN, data!.id as string);
  }, { nota: "incluye 1 consulta para obtener el id" });
  await medir("admin: claves del negocio (vista previa de importación)", () => catalog.listProductKeys(TENANT), { rondas: 5, nota: "acción de administración puntual; pagina de a 1.000" });

  // --- Concurrencia ---------------------------------------------------------------------------
  await concurrencia("concurrente: 50 búsquedas a la vez", 50, (i) => publico.getCatalog({ slug: SLUG, context: "retail", q: ["aretes oro", "anillo luna", "corazon", "plata", "collar perla"][i % 5] }));
  await concurrencia("concurrente: 50 carritos (10 refs) a la vez", 50, (i) => publico.resolveSelection({ slug: SLUG, references: refs.slice(i % 60, (i % 60) + 10) }));
  await concurrencia("concurrente: 30 confirmaciones de productos distintos", 30, async (i) => {
    const contact = { phoneNumberId: "PN-PERF", waId: `5730092${String(i).padStart(5, "0")}` };
    const { order } = await engine.createOrder({ tenantId: TENANT, channel: "retail", source: "agent", contact, items: [{ reference: refs[i % refs.length], quantity: 1 }], idempotencyKey: `agent:perf-${randomUUID()}` });
    const c = await engine.confirmOrder({ tenantId: TENANT, contact, orderId: order.orderId, confirmationId: order.confirmation!.id, actor: "agent" });
    await engine.closeOrder({ tenantId: TENANT, orderId: order.orderId, action: "cancel" });
    return c;
  });
  await ultimaUnidad(refs[79]);

  // --- Varios negocios a la vez (si existe el segundo negocio con Catálogo) -------------------
  const { count: productosQ } = await supabase.from("dulabs_inventario_productos").select("id", { count: "exact", head: true }).eq("id_tenant", TENANT_Q);
  if (productosQ) await multiNegocio(refs);

  if (process.argv.includes("--json")) writeFileSync(arg("json", "perf.json"), JSON.stringify(resultados, null, 2));
  console.log("\n| Operación | p50 ms | p95 ms | máx ms | consultas | KB BD | KB a Gemini |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of resultados) console.log(`| ${r.operacion} | ${r.p50} | ${r.p95} | ${r.max} | ${r.consultas} | ${r.kb_bd} | ${r.kb_gemini ?? ""} |`);
}

const confirmaciones: Array<{ ms: number; consultas: number }> = [];

async function concurrencia(operacion: string, n: number, fn: (i: number) => Promise<unknown>) {
  const tiempos: number[] = [];
  let errores = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const s = performance.now();
      try {
        await fn(i);
      } catch {
        errores++;
      }
      tiempos.push(performance.now() - s);
    }),
  );
  const total = performance.now() - t0;
  const r: Resultado = { operacion, p50: +pct(tiempos, 50).toFixed(1), p95: +pct(tiempos, 95).toFixed(1), max: +Math.max(...tiempos).toFixed(1), consultas: 0, kb_bd: 0, nota: `${n} en ${total.toFixed(0)} ms (${((n / total) * 1000).toFixed(0)}/s), errores ${errores}` };
  resultados.push(r);
  console.log(JSON.stringify(r));
}

/** 20 clientes confirman A LA VEZ la última unidad: exactamente uno la obtiene. */
async function ultimaUnidad(reference: string) {
  await supabase.from("dulabs_inventario_productos").update({ stock: 1 }).eq("id_tenant", TENANT).eq("referencia", reference);
  const pedidos = await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      const contact = { phoneNumberId: "PN-PERF", waId: `5730093${String(i).padStart(5, "0")}` };
      const { order } = await engine.createOrder({ tenantId: TENANT, channel: "retail", source: "agent", contact, items: [{ reference, quantity: 1 }], idempotencyKey: `agent:perf-${randomUUID()}` });
      return { contact, order };
    }),
  );
  const t0 = performance.now();
  const r = await Promise.allSettled(pedidos.map(({ contact, order }) => engine.confirmOrder({ tenantId: TENANT, contact, orderId: order.orderId, confirmationId: order.confirmation!.id, actor: "agent" })));
  const ms = performance.now() - t0;
  const ok = r.filter((x) => x.status === "fulfilled").length;
  const agotado = r.filter((x) => x.status === "rejected" && x.reason instanceof OrderError && x.reason.code === "OUT_OF_STOCK").length;
  const { data } = await supabase.from("dulabs_inventario_productos").select("stock").eq("id_tenant", TENANT).eq("referencia", reference).single();
  const fila: Resultado = { operacion: "concurrente: 20 clientes por la ÚLTIMA unidad", p50: 0, p95: 0, max: +ms.toFixed(1), consultas: 0, kb_bd: 0, nota: `confirmados ${ok}, agotado ${agotado}, stock final ${data?.stock}` };
  resultados.push(fila);
  console.log(JSON.stringify(fila));
  if (ok !== 1 || data?.stock !== 0) throw new Error(`FALLA última unidad: ${fila.nota}`);
  for (const [i, x] of r.entries()) if (x.status === "fulfilled") await engine.closeOrder({ tenantId: TENANT, orderId: pedidos[i].order.orderId, action: "cancel" });
  await supabase.from("dulabs_inventario_productos").update({ stock: 12 }).eq("id_tenant", TENANT).eq("referencia", reference);
}

/**
 * Dos negocios con Catálogo a la vez, con LAS MISMAS referencias (DL-…): búsquedas y carritos
 * concurrentes intercalados nunca devuelven productos del otro negocio (los de Q terminan en « Q»),
 * y la última unidad de la MISMA referencia en los dos negocios a la vez se reparte bien: exactamente
 * un confirmado por negocio y el stock de cada uno en 0.
 */
async function multiNegocio(refs: string[]) {
  let fugas = 0;
  const palabras = ["anillo", "aretes luna", "corazon", "plata", "collar perla", "oro rosa"];
  await concurrencia("multi-negocio: 60 búsquedas intercaladas (2 negocios)", 60, async (i) => {
    const q = i % 2 === 1;
    const page = await publico.getCatalog({ slug: q ? SLUG_Q : SLUG, context: "retail", q: palabras[i % palabras.length] });
    for (const p of page?.products ?? []) if (p.name.endsWith(" Q") !== q) fugas++;
  });
  await concurrencia("multi-negocio: 60 carritos intercalados, mismas referencias", 60, async (i) => {
    const q = i % 2 === 1;
    const sel = await publico.resolveSelection({ slug: q ? SLUG_Q : SLUG, references: refs.slice(i % 40, (i % 40) + 10) });
    for (const p of sel?.items ?? []) if (p.name.endsWith(" Q") !== q) fugas++;
  });
  const ref = refs[77];
  await supabase.from("dulabs_inventario_productos").update({ stock: 1 }).in("id_tenant", [TENANT, TENANT_Q]).eq("referencia", ref);
  const pedidos = await Promise.all(
    Array.from({ length: 40 }, async (_, i) => {
      const tenantId = i % 2 ? TENANT_Q : TENANT;
      const contact = { phoneNumberId: i % 2 ? "PN-PERF-2" : "PN-PERF", waId: `5730094${String(i).padStart(5, "0")}` };
      const { order } = await engine.createOrder({ tenantId, channel: "retail", source: "agent", contact, items: [{ reference: ref, quantity: 1 }], idempotencyKey: `agent:perf-${randomUUID()}` });
      return { tenantId, contact, order };
    }),
  );
  const t0 = performance.now();
  const r = await Promise.allSettled(pedidos.map(({ tenantId, contact, order }) => engine.confirmOrder({ tenantId, contact, orderId: order.orderId, confirmationId: order.confirmation!.id, actor: "agent" })));
  const ms = performance.now() - t0;
  const okPor = (t: string) => r.filter((x, i) => x.status === "fulfilled" && pedidos[i].tenantId === t).length;
  const { data: stocks } = await supabase.from("dulabs_inventario_productos").select("id_tenant, stock").in("id_tenant", [TENANT, TENANT_Q]).eq("referencia", ref);
  const stock = (t: string) => stocks?.find((x) => x.id_tenant === t)?.stock;
  const nota = `confirmados P ${okPor(TENANT)} / Q ${okPor(TENANT_Q)}; stock final P ${stock(TENANT)} / Q ${stock(TENANT_Q)}; fugas entre negocios ${fugas}`;
  const fila: Resultado = { operacion: "multi-negocio: misma referencia, última unidad en 2 negocios (20+20 clientes)", p50: 0, p95: 0, max: +ms.toFixed(1), consultas: 0, kb_bd: 0, nota };
  resultados.push(fila);
  console.log(JSON.stringify(fila));
  if (okPor(TENANT) !== 1 || okPor(TENANT_Q) !== 1 || stock(TENANT) !== 0 || stock(TENANT_Q) !== 0 || fugas !== 0) throw new Error(`FALLA multi-negocio: ${nota}`);
  for (const [i, x] of r.entries()) if (x.status === "fulfilled") await engine.closeOrder({ tenantId: pedidos[i].tenantId, orderId: pedidos[i].order.orderId, action: "cancel" });
  await supabase.from("dulabs_inventario_productos").update({ stock: 12 }).in("id_tenant", [TENANT, TENANT_Q]).eq("referencia", ref);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
