/**
 * Fase 6 — catálogo -> solicitud de pedido estructurada -> WhatsApp, y el
 * contrato que usará el agente. Servicio REAL sobre el repositorio en memoria:
 * ni red, ni Supabase, ni IA.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { cartReducer, currentRequest, emptyCart, parseStoredCart, requestFingerprint, selectionSnapshot } from "@/lib/catalogo/carrito";
import { PUBLIC_STOCK_VISIBLE } from "@/lib/catalogo/domain";
import { memoryOrderEventSink, orderEventV2Schema } from "@/lib/catalogo/pedidos/eventos";
import { orderRequestSchema, parseOrderMessage, type OrderItem } from "@/lib/catalogo/pedido";
import { canonicalItems, crockford, orderRequestId, orderSigningKey, readQuote, signQuote } from "@/lib/catalogo/pedido-firma";
import { responderPedido, responderSeleccion } from "@/lib/catalogo/pedido-http";
import { createResolucionCatalogo, extractReferences } from "@/lib/catalogo/resolucion";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";

const A: CatalogActor = { tenantId: "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4", userId: "admin" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-000000000002", userId: "otro" };
const KEY = Buffer.alloc(32, 9);

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let sink: ReturnType<typeof memoryOrderEventSink>;
let publico: ReturnType<typeof createPublicCatalogService>;
let slugA: string;
let slugB: string;
let tokenA: string;
const NOW = new Date("2026-09-24T15:00:00Z");

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  sink = memoryOrderEventSink();
  publico = createPublicCatalogService({ repo: mem.repo, orders: { key: KEY, events: sink, now: () => NOW } });
  for (const [actor, name] of [
    [A, "Delacour"],
    [B, "Otra joyería"],
  ] as const) {
    mem.setProfile(actor.tenantId, { name, whatsapp: "573001112233" });
    mem.enableModule(actor.tenantId);
  }
  slugA = (await admin.ensurePublication(A)).slug;
  slugB = (await admin.ensurePublication(B)).slug;
  tokenA = (await admin.getPublication(A, { includeWholesale: true }))!.wholesalePath!.split("/").pop()!;
});

const producto = (actor: CatalogActor, name: string, retail: number, stock: number, wholesale: number | null = null) =>
  admin.createProduct(actor, { name, retailPrice: retail, wholesalePrice: wholesale, stock });

/** La tienda: ver precios (cotización firmada) y pedir con una clave de intento. */
async function pedir(items: OrderItem[], opts: { slug?: string; context?: "retail" | "wholesale"; token?: string; requestKey?: string } = {}) {
  const slug = opts.slug ?? slugA;
  const vista = await publico.resolveSelection({ slug, references: items.map((i) => i.reference), context: opts.context, token: opts.token });
  return publico.prepareOrder({ slug, items, quote: vista?.quote ?? undefined, requestKey: opts.requestKey ?? "intento-00000000001", context: opts.context, token: opts.token });
}

describe("contrato de entrada: el navegador solo envía referencias y cantidades", () => {
  it("carrito vacío => rechazado; precios, nombres, negocio o canal => rechazados", () => {
    assert.equal(orderRequestSchema.safeParse({ items: [] }).success, false);
    for (const extra of [{ price: 1 }, { name: "x" }, { unitPrice: 1 }]) {
      assert.equal(orderRequestSchema.safeParse({ items: [{ reference: "DL-000001", quantity: 1, ...extra }] }).success, false);
    }
    for (const extra of [{ total: 1 }, { business_id: A.tenantId }, { tenantId: A.tenantId }, { channel: "wholesale" }]) {
      assert.equal(orderRequestSchema.safeParse({ items: [{ reference: "DL-000001", quantity: 1 }], ...extra }).success, false);
    }
    assert.equal(orderRequestSchema.safeParse({ items: [{ reference: "DL-000001", quantity: 0 }] }).success, false, "cantidad > 0");
    assert.equal(orderRequestSchema.safeParse({ items: [{ reference: "DL-000001", quantity: 1 }], requestKey: "corta" }).success, false);
  });
});

describe("solicitud de pedido (OrderDraft) validada en el servidor", () => {
  it("un producto: borrador con precio, subtotal, total y moneda calculados por el backend", async () => {
    const p = await producto(A, "Anillo Corazón", 129_900, 5);
    const r = await pedir([{ reference: p.reference, quantity: 2 }]);
    assert.equal(r?.status, "ready");
    if (r?.status !== "ready") return;
    assert.deepEqual(r.draft, {
      requestId: r.draft.requestId,
      businessId: A.tenantId,
      publication: { slug: slugA, publicName: r.draft.publication.publicName },
      channel: "retail",
      currency: "COP",
      items: [{ reference: p.reference, productId: p.id, name: "Anillo Corazón", quantity: 2, unitPrice: 129_900, subtotal: 259_800 }],
      totalProducts: 1,
      totalUnits: 2,
      total: 259_800,
      unpricedUnits: 0,
      createdAt: NOW.toISOString(),
    });
    assert.match(r.draft.requestId, /^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it("varios productos y cantidades (duplicados sumados); mensaje con REFERENCIA + PRODUCTO + CANTIDAD", async () => {
    const a = await producto(A, "Anillo Corazón", 100_000, 10);
    const b = await producto(A, "Aretes Perla", 50_000, 10);
    const c = await producto(A, "Dije Luna", 30_000, 10);
    const r = await pedir([
      { reference: a.reference, quantity: 1 },
      { reference: b.reference, quantity: 1 },
      { reference: a.reference, quantity: 1 },
      { reference: c.reference, quantity: 3 },
    ]);
    assert.equal(r?.status, "ready");
    if (r?.status !== "ready") return;
    assert.equal(r.draft.total, 2 * 100_000 + 50_000 + 3 * 30_000);
    assert.equal(
      r.message,
      [
        "Hola, me interesan estos productos:",
        "",
        `• ${a.reference} · Anillo Corazón — 2 unidades`,
        `• ${b.reference} · Aretes Perla — 1 unidad`,
        `• ${c.reference} · Dije Luna — 3 unidades`,
        "",
        "Total de productos: 3",
        "Unidades: 6",
        "Total estimado: $340.000",
        "",
        `Solicitud: ${r.draft.requestId}`,
        "Quisiera información para realizar el pedido.",
      ].join("\n"),
    );
    // El webhook/agente lo lee de vuelta de forma determinista.
    assert.deepEqual(parseOrderMessage(r.message), {
      context: "retail",
      items: [
        { reference: a.reference, quantity: 2 },
        { reference: b.reference, quantity: 1 },
        { reference: c.reference, quantity: 3 },
      ],
      requestId: r.draft.requestId,
    });
    assert.equal(decodeURIComponent(r.whatsappUrl.split("text=")[1]), r.message);
  });

  it("validación ATÓMICA: stock insuficiente, desactivado, eliminado o inexistente => NADA se envía y se dice qué pasó", async () => {
    const ok = await producto(A, "Aretes", 10_000, 10);
    const poco = await producto(A, "Anillo Corazón", 10_000, 2);
    const retirado = await producto(A, "Dije", 10_000, 5);
    await admin.updateProduct(A, retirado.id, { status: "INACTIVE" });
    const r = await pedir([
      { reference: ok.reference, quantity: 1 },
      { reference: poco.reference, quantity: 5 },
      { reference: retirado.reference, quantity: 1 },
      { reference: "DL-999999", quantity: 1 },
    ]);
    assert.equal(r?.status, "adjusted");
    assert.equal("whatsappUrl" in (r ?? {}), false);
    assert.deepEqual(r?.order.adjustments, [
      { kind: "quantity_reduced", reference: poco.reference, name: "Anillo Corazón", requested: 5, granted: 2 },
      { kind: "not_found", reference: retirado.reference, requested: 1 },
      { kind: "not_found", reference: "DL-999999", requested: 1 },
    ]);
    assert.equal(sink.events.length, 0, "sin solicitud no hay evento");
  });

  it("agotado => no se puede pedir", async () => {
    const p = await producto(A, "Anillo", 10_000, 1);
    await admin.updateProduct(A, p.id, { stock: 0 });
    const r = await pedir([{ reference: p.reference, quantity: 1 }]);
    assert.deepEqual(r?.order.adjustments.map((a) => a.kind), ["sold_out"]);
  });

  it("precio cambiado: se detecta con la cotización FIRMADA; una alterada no sirve", async () => {
    const p = await producto(A, "Anillo Corazón", 100_000, 5);
    const items = [{ reference: p.reference, quantity: 1 }];
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    await admin.updateProduct(A, p.id, { retailPrice: 120_000 });
    const cambio = await publico.prepareOrder({ slug: slugA, items, quote: vista!.quote! });
    assert.deepEqual(cambio?.order.adjustments, [{ kind: "price_changed", reference: p.reference, name: "Anillo Corazón", before: 100_000, after: 120_000 }]);

    // Un cliente que "baja" el precio en la cotización: la firma no coincide => se le muestran los precios vigentes (review).
    const [v, payload, firma] = vista!.quote!.split(".");
    const falso = JSON.parse(Buffer.from(payload, "base64url").toString());
    falso.p[0][1] = 1;
    const alterada = [v, Buffer.from(JSON.stringify(falso)).toString("base64url"), firma].join(".");
    assert.equal((await publico.prepareOrder({ slug: slugA, items, quote: alterada }))?.status, "review");
    assert.equal((await publico.prepareOrder({ slug: slugA, items }))?.status, "review", "sin cotización: revisar antes de enviar");
  });

  it("retail y wholesale nunca se mezclan: cada canal su precio; el mayorista exige el token de la ruta", async () => {
    const p = await producto(A, "Dije", 35_000, 5, 18_000);
    const items = [{ reference: p.reference, quantity: 2 }];
    const detal = await pedir(items);
    const mayor = await pedir(items, { context: "wholesale", token: tokenA });
    assert.equal(detal?.status === "ready" && detal.draft.total, 70_000);
    assert.equal(mayor?.status === "ready" && mayor.draft.total, 36_000);
    assert.equal(mayor?.status === "ready" && mayor.draft.channel, "wholesale");
    assert.match(mayor?.status === "ready" ? mayor.message : "", /precio mayorista/);
    assert.equal(await pedir(items, { context: "wholesale" }), null, "sin token: no existe");
    assert.equal(await pedir(items, { context: "wholesale", token: "f".repeat(64) }), null, "token equivocado: no existe");
    // Canal incorrecto: una cotización del detal no vale para el mayorista.
    const vistaDetal = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    assert.equal((await publico.prepareOrder({ slug: slugA, items, context: "wholesale", token: tokenA, quote: vistaDetal!.quote! }))?.status, "review");
  });

  it("stock discreto: el público no ve 37, pero el backend valida contra 37", async () => {
    const p = await producto(A, "Cadena", 10_000, 37);
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    assert.equal(vista!.items[0].maxQuantity, null);
    assert.ok(37 > PUBLIC_STOCK_VISIBLE);
    const r = await pedir([{ reference: p.reference, quantity: 40 }]);
    assert.deepEqual(r?.order.adjustments, [{ kind: "quantity_reduced", reference: p.reference, name: "Cadena", requested: 40, granted: 37 }]);
  });
});

describe("idempotencia: doble envío, reintento y evento", () => {
  it("mismo carrito + misma clave => MISMA solicitud y MISMO evento (una sola vez); otra clave => otra solicitud", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    const items = [{ reference: p.reference, quantity: 2 }];
    const r1 = await pedir(items, { requestKey: "clave-intento-aaaa-0001" });
    const r2 = await pedir(items, { requestKey: "clave-intento-aaaa-0001" });
    assert.equal(r1?.status === "ready" && r2?.status === "ready" && r1.draft.requestId === r2.draft.requestId, true);
    assert.equal(sink.published, 2, "se intentó publicar dos veces…");
    assert.equal(sink.events.length, 1, "…pero el evento es uno solo (event_id determinista)");
    const r3 = await pedir(items, { requestKey: "clave-intento-bbbb-0002" });
    assert.notEqual(r3?.status === "ready" && r3.draft.requestId, r1?.status === "ready" && r1.draft.requestId);
    assert.equal(sink.events.length, 2);
  });

  it("el evento cumple su contrato (validado con zod) y no trae nada que no deba", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    await pedir([{ reference: p.reference, quantity: 1 }]);
    const [e] = sink.events;
    // Contrato v2 (Fase 7): mismo evento canónico que emite el motor de pedidos.
    assert.equal(orderEventV2Schema.safeParse(e).success, true);
    assert.equal(e.event_type, "catalog.order_request.created");
    assert.equal(e.version, 2);
    assert.equal(e.business.id, A.tenantId);
    assert.equal(e.customer, null, "aún no hay conversación: sin datos del cliente");
    assert.equal(e.source, "catalog");
    assert.equal(e.order.status, "validated");
    assert.deepEqual(e.order.lines, [{ reference: p.reference, product_name: "Anillo", quantity: 1, unit_price: 10_000, subtotal: 10_000 }]);
    assert.match(e.event_id, /^evt_[0-9a-z]{26}$/);
  });

  it("el id cambia si cambian las líneas aunque la clave sea la misma; el orden de agregado no importa", () => {
    const base = { businessId: A.tenantId, channel: "retail" as const, requestKey: "clave-intento-aaaa-0001" };
    const x = orderRequestId(KEY, { ...base, items: [{ reference: "DL-000001", quantity: 1 }, { reference: "DL-000002", quantity: 1 }] });
    const y = orderRequestId(KEY, { ...base, items: [{ reference: "DL-000002", quantity: 1 }, { reference: "DL-000001", quantity: 1 }] });
    const z = orderRequestId(KEY, { ...base, items: [{ reference: "DL-000001", quantity: 2 }, { reference: "DL-000002", quantity: 1 }] });
    assert.equal(x, y);
    assert.notEqual(x, z);
    assert.equal(canonicalItems([{ reference: "DL-2", quantity: 1 }, { reference: "DL-1", quantity: 3 }]), "DL-1:3,DL-2:1");
    assert.equal(crockford(Buffer.from([0xff, 0xff, 0xff, 0xff]), 6), "ZZZZZZ");
  });

  it("el carrito conserva la clave mientras no cambie; al cambiar (o eliminar), empieza un intento nuevo", () => {
    let s = emptyCart("delacour", "retail");
    s = cartReducer(s, { type: "add", product: { reference: "DL-000001", name: "Anillo", price: 1, imageUrl: null }, quantity: 2 });
    s = cartReducer(s, { type: "add", product: { reference: "DL-000002", name: "Aretes", price: 1, imageUrl: null } });
    s = cartReducer(s, { type: "setRequest", request: { key: "k".repeat(20), items: requestFingerprint(s.lines), requestId: "DL-ORD-7F42KQ" } });
    assert.equal(currentRequest(s)?.requestId, "DL-ORD-7F42KQ");
    // Sobrevive a recargar la página.
    const recargado = parseStoredCart(JSON.stringify(s), "delacour", "retail");
    assert.equal(currentRequest(recargado)?.key, "k".repeat(20));
    assert.equal(currentRequest(cartReducer(s, { type: "remove", reference: "DL-000002" })), null);
    assert.equal(currentRequest(cartReducer(s, { type: "setQuantity", reference: "DL-000001", quantity: 3 })), null);
    assert.deepEqual(selectionSnapshot(s).items, [
      { reference: "DL-000001", quantity: 2 },
      { reference: "DL-000002", quantity: 1 },
    ]);
  });
});

describe("firma: clave del backend", () => {
  it("clave propia o derivada de la de servicio (nunca la de Supabase tal cual); sin ninguna => null", () => {
    const derivada = orderSigningKey({ SUPABASE_SERVICE_ROLE_KEY: "service-role-de-prueba" });
    assert.ok(derivada && derivada.length === 32);
    assert.notEqual(derivada!.toString("utf8"), "service-role-de-prueba");
    assert.notDeepEqual(orderSigningKey({ CATALOG_ORDER_SECRET: "x".repeat(40), SUPABASE_SERVICE_ROLE_KEY: "service-role-de-prueba" }), derivada);
    assert.equal(orderSigningKey({}), null);
  });

  it("una cotización de OTRO negocio no vale aquí", () => {
    const precios = new Map([["DL-000001", 10_000]]);
    const q = signQuote(KEY, { businessId: B.tenantId, channel: "retail" }, precios);
    assert.deepEqual(readQuote(KEY, { businessId: B.tenantId, channel: "retail" }, q), precios);
    assert.equal(readQuote(KEY, { businessId: A.tenantId, channel: "retail" }, q), null);
    assert.equal(readQuote(KEY, { businessId: B.tenantId, channel: "wholesale" }, q), null);
    assert.equal(readQuote(KEY, { businessId: B.tenantId, channel: "retail" }, "basura"), null);
  });
});

describe("multi-tenant", () => {
  it("el negocio A no puede resolver ni pedir productos del negocio B", async () => {
    await producto(A, "Relleno A", 1, 1);
    const deB = await producto(B, "Collar de B", 90_000, 5);
    await producto(B, "Otro de B", 1, 1);
    const resol = createResolucionCatalogo({ repo: mem.repo });
    // Misma forma de referencia, otro negocio: para A no existe.
    const refB2 = (await producto(B, "Tercero de B", 1, 1)).reference;
    assert.equal((await resol.resolveByReference(A.tenantId, refB2)).status, "not_found");
    assert.equal((await resol.resolveByReference(B.tenantId, deB.reference)).status, "found");
    const r = await pedir([{ reference: refB2, quantity: 1 }]);
    assert.deepEqual(r?.order.adjustments.map((a) => a.kind), ["not_found"]);
    // Y por el catálogo de B sí existe (con los precios de B).
    const rb = await pedir([{ reference: deB.reference, quantity: 1 }], { slug: slugB });
    assert.equal(rb?.status === "ready" && rb.draft.businessId, B.tenantId);
  });
});

describe("herramientas deterministas para el futuro agente", () => {
  it("resolveByReference: exacta; inexistente => mensaje claro; texto libre => referencia inválida (sin adivinar)", async () => {
    const p = await producto(A, "Anillo Corazón", 129_900, 4, 70_000);
    const resol = createResolucionCatalogo({ repo: mem.repo });
    const found = await resol.resolveByReference(A.tenantId, ` ${p.reference.toLowerCase()} `);
    assert.equal(found.status, "found");
    if (found.status === "found") {
      assert.deepEqual(
        { ref: found.product.reference, retail: found.product.prices.retail, wholesale: found.product.prices.wholesale, stock: found.product.stock, availability: found.product.availability },
        { ref: p.reference, retail: 129_900, wholesale: 70_000, stock: { tracked: true, units: 4 }, availability: "available" },
      );
    }
    assert.deepEqual(await resol.resolveByReference(A.tenantId, "DL-999999"), { status: "not_found", reference: "DL-999999", message: "No encontramos la referencia DL-999999." });
    assert.equal((await resol.resolveByReference(A.tenantId, "el anillo corazón")).status, "invalid_reference");
  });

  it("resolveByExactAttributes: igualdad exacta sin tildes; varios => ambiguo; parecido => no encontrado", async () => {
    await producto(A, "Anillo Corazón", 1, 1);
    await admin.createProduct(A, { name: "Aro", color: "Dorado", retailPrice: 1, stock: 1 });
    await admin.createProduct(A, { name: "Aro", color: "Plateado", retailPrice: 1, stock: 1 });
    const resol = createResolucionCatalogo({ repo: mem.repo });
    assert.equal((await resol.resolveByExactAttributes(A.tenantId, { name: "anillo corazon" })).status, "found");
    assert.equal((await resol.resolveByExactAttributes(A.tenantId, { name: "anillo corazones" })).status, "not_found");
    const aro = await resol.resolveByExactAttributes(A.tenantId, { name: "ARO" });
    assert.equal(aro.status, "ambiguous");
    assert.equal(aro.status === "ambiguous" && aro.candidates.length, 2);
    const dorado = await resol.resolveByExactAttributes(A.tenantId, { name: "aro", color: "dorado" });
    assert.equal(dorado.status === "found" && dorado.product.color, "Dorado");
  });

  it("searchProducts: solo CANDIDATOS activos, acotados; nunca una selección", async () => {
    await producto(A, "Anillo Corazón", 1, 1);
    const inactivo = await producto(A, "Anillo Viejo", 1, 1);
    await admin.updateProduct(A, inactivo.id, { status: "INACTIVE" });
    const resol = createResolucionCatalogo({ repo: mem.repo });
    const r = await resol.searchProducts(A.tenantId, "anillo");
    assert.equal(r.status, "candidates");
    assert.deepEqual(r.candidates.map((c) => c.name), ["Anillo Corazón"]);
  });

  it("resolveOrder: el pedido leído de WhatsApp se valida con la verdad ACTUAL del canal", async () => {
    const p = await producto(A, "Dije", 35_000, 3, 18_000);
    const resol = createResolucionCatalogo({ repo: mem.repo });
    const leido = parseOrderMessage(`Hola, me interesan estos productos (precio mayorista):\n\n• ${p.reference} · Dije — 5 unidades`);
    const r = await resol.resolveOrder(A.tenantId, "wholesale", leido.items);
    assert.deepEqual(r.order.lines.map((l) => [l.reference, l.quantity, l.unitPrice]), [[p.reference, 3, 18_000]]);
    assert.deepEqual(r.order.adjustments.map((a) => a.kind), ["quantity_reduced"]);
  });

  it("extractReferences: solo lo escrito literalmente", () => {
    assert.deepEqual(extractReferences("Quiero el dl-000184 y el DL-000231, y el anillo corazón. DL-ORD-7F42KQ"), ["DL-000184", "DL-000231"]);
    assert.deepEqual(extractReferences("quiero el anillo corazón"), []);
  });
});

describe("adaptador HTTP (detal y mayor con el mismo código)", () => {
  const req = (body: unknown, raw?: string) => new Request("https://x.test/catalogo/x/pedido", { method: "POST", body: raw ?? JSON.stringify(body) });

  it("respuesta pública: sin ids internos ni negocio; canal fijado por la ruta", async () => {
    const p = await producto(A, "Anillo", 10_000, 5);
    const sel = await responderSeleccion(new Request(`https://x.test/catalogo/${slugA}/seleccion?ref=${p.reference}`), { slug: slugA, context: "retail" }, () => publico);
    const vista = (await sel.json()) as { quote: string };
    const res = await responderPedido(req({ items: [{ reference: p.reference, quantity: 1 }], quote: vista.quote, requestKey: "clave-http-0000000001" }), { slug: slugA, context: "retail" }, () => publico);
    const texto = await res.text();
    const data = JSON.parse(texto) as { status: string; request: { requestId: string; total: number }; whatsappUrl: string };
    assert.equal(data.status, "ready");
    assert.equal(data.request.total, 10_000);
    assert.ok(!texto.includes(A.tenantId) && !texto.includes(p.id), "nunca negocio ni id interno");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });

  it("errores: JSON inválido 400, pedido inválido 400, demasiado grande 413, sin clave de firma 503, catálogo inexistente 404", async () => {
    const canal = { slug: slugA, context: "retail" as const };
    assert.equal((await responderPedido(req(null, "{"), canal, () => publico)).status, 400);
    assert.equal((await responderPedido(req({ items: [] }), canal, () => publico)).status, 400);
    assert.equal((await responderPedido(req(null, "x".repeat(30_000)), canal, () => publico)).status, 413);
    const sinClave = createPublicCatalogService({ repo: mem.repo, orders: { key: null } });
    assert.equal((await responderPedido(req({ items: [{ reference: "DL-000001", quantity: 1 }] }), canal, () => sinClave)).status, 503);
    assert.equal((await responderPedido(req({ items: [{ reference: "DL-000001", quantity: 1 }] }), { slug: "no-existe", context: "retail" }, () => publico)).status, 404);
  });

  it("la selección mayorista nunca va a cachés compartidas", async () => {
    const res = await responderSeleccion(new Request("https://x.test/?ref=DL-000001"), { slug: slugA, context: "wholesale", token: tokenA }, () => publico);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const detal = await responderSeleccion(new Request("https://x.test/?ref=DL-000001"), { slug: slugA, context: "retail" }, () => publico);
    assert.match(detal.headers.get("Cache-Control") ?? "", /s-maxage/);
  });
});
