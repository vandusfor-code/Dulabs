/**
 * Precio EFECTIVO en la tienda, el carrito, la cotización firmada y el pedido: lo que se MUESTRA, lo que se FIRMA y lo que se COBRA salen del mismo cálculo.
 * Servicio REAL sobre el repositorio en memoria y el puerto REAL del CMS con instantáneas controladas (ni red ni base de datos). Tenants FICTICIOS.
 *
 * Reglas que se prueban (decisiones del negocio): las ofertas modifican el precio real; una por producto (no se acumulan); el detal nunca ve ofertas mayoristas;
 * si el negocio usa ofertas y no se pudieron verificar, NADA que cobre sigue con un precio sin verificar; con el módulo apagado todo es idéntico a antes.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { cartReducer, emptyCart } from "@/lib/catalogo/carrito";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { readQuote } from "@/lib/catalogo/pedido-firma";
import { responderSeleccion } from "@/lib/catalogo/pedido-http";
import { sinLimitePublico } from "@/lib/catalogo/limites-publicos";
import { PreciosNoDisponibles } from "@/lib/catalogo/precios";
import { conPrecios } from "@/lib/catalogo/repository";
import { createCatalogService, createPublicCatalogService, type CatalogActor, type OrderDeps } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import type { InstantaneaCms, PublicadaCms } from "@/lib/cms-comercial/publicado";
import { crearPuertoPreciosCms } from "@/lib/cms-comercial/precios";
import { AHORA, campana, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const KEY = Buffer.alloc(32, 9);

let reloj: number;
let snaps: Record<string, InstantaneaCms | Error | null>;
let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let sink: ReturnType<typeof memoryOrderEventSink>;
let registradas: Array<{ lines: ReadonlyArray<Record<string, unknown>> }>;
let publico: ReturnType<typeof createPublicCatalogService>;
let sinPuerto: ReturnType<typeof createPublicCatalogService>;
let slugA: string;
let slugB: string;
let tokenA: string;

const puerto = crearPuertoPreciosCms({
  cargar: async (tenantId) => {
    const s = snaps[tenantId] ?? null;
    if (s instanceof Error) throw s;
    return s;
  },
  ahora: () => reloj,
});

beforeEach(async () => {
  reloj = AHORA;
  snaps = {};
  registradas = [];
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  sink = memoryOrderEventSink();
  const orders = (): OrderDeps => ({
    key: KEY,
    events: sink,
    now: () => new Date(reloj),
    engine: {
      async recordCatalogRequest(input) {
        registradas.push({ lines: input.lines as unknown as Array<Record<string, unknown>> });
        return null;
      },
    },
  });
  publico = createPublicCatalogService({ repo: conPrecios(mem.repo, puerto), orders: orders() });
  sinPuerto = createPublicCatalogService({ repo: mem.repo, orders: orders() });
  for (const [actor, nombre] of [[A, "Joyería A"], [B, "Joyería B"]] as const) {
    mem.setProfile(actor.tenantId, { name: nombre, whatsapp: "573001112233" });
    mem.enableModule(actor.tenantId);
  }
  slugA = (await admin.ensurePublication(A)).slug;
  slugB = (await admin.ensurePublication(B)).slug;
  tokenA = (await admin.getPublication(A, { includeWholesale: true }))!.wholesalePath!.split("/").pop()!;
});

const producto = (actor: CatalogActor, name: string, retail: number, wholesale: number | null, stock = 10) => admin.createProduct(actor, { name, retailPrice: retail, wholesalePrice: wholesale, stock });
const conOfertas = (...ofertas: PublicadaCms<"oferta">[]) => instantanea({ ofertas });
const veinte = (refs: string[], over: Parameters<typeof oferta>[0] = {}) => publicada("amor", oferta({ alcance: { todos: false, referencias: refs, categorias: [] }, ...over }));

async function pedir(items: Array<{ reference: string; quantity: number }>, opts: { slug?: string; context?: "retail" | "wholesale"; token?: string; servicio?: typeof publico } = {}) {
  const servicio = opts.servicio ?? publico;
  const slug = opts.slug ?? slugA;
  const vista = await servicio.resolveSelection({ slug, references: items.map((i) => i.reference), context: opts.context, token: opts.token });
  return { vista, resultado: await servicio.prepareOrder({ slug, items, quote: vista?.quote ?? undefined, requestKey: "intento-00000000001", context: opts.context, token: opts.token }) };
}

describe("la tienda muestra el precio efectivo (y el de lista tachado)", () => {
  it("listado, ficha e inicio: con oferta, el precio es el de la oferta y llegan el precio de lista y la oferta; sin oferta, nada cambia", async () => {
    const con = await producto(A, "Aretes", 100_000, 70_000);
    const sin = await producto(A, "Cadena", 50_000, 35_000);
    snaps[A.tenantId] = conOfertas(veinte([con.reference], { nombre: "Amor y Amistad" }));

    const lista = await publico.getCatalog({ slug: slugA, context: "retail" });
    const [pCon, pSin] = [lista!.products.find((p) => p.reference === con.reference)!, lista!.products.find((p) => p.reference === sin.reference)!];
    assert.equal(pCon.price, 80_000);
    assert.equal(pCon.listPrice, 100_000);
    assert.deepEqual(pCon.offer, { name: "Amor y Amistad", benefit: "20% de descuento", label: "-20%", until: "hasta el 31 de octubre de 2026", conditions: null });
    assert.equal(pSin.price, 50_000);
    assert.ok(!("listPrice" in pSin) && !("offer" in pSin), "sin oferta la proyección queda exactamente como siempre");

    const ficha = await publico.getProduct({ slug: slugA, reference: con.reference });
    assert.equal(ficha?.price, 80_000);
    assert.equal(ficha?.listPrice, 100_000);

    const home = await publico.getHome(slugA);
    assert.equal(home?.featured.find((p) => p.reference === con.reference)?.price, 80_000);
  });

  it("el inicio con destacados y campaña elegidos en el CMS también lleva los precios efectivos", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    const home = await publico.getHome(slugA, { destacadas: [p.reference], campana: [p.reference] });
    assert.equal(home?.featured[0].price, 80_000);
    assert.equal(home?.campana?.[0].price, 80_000);
    assert.equal(home?.campana?.[0].listPrice, 100_000);
  });

  it("CONTRATO DE MODALIDAD: la tienda detal nunca ve una oferta mayorista ni su precio; la mayorista sí ve la suya", async () => {
    const p = await producto(A, "Aretes", 100_000, 70_000);
    snaps[A.tenantId] = conOfertas(publicada("mayor", oferta({ modalidad: "mayorista", alcance: { todos: false, referencias: [p.reference], categorias: [] }, beneficio: { tipo: "porcentaje", valor: 10 } })));
    const detal = await publico.getCatalog({ slug: slugA, context: "retail" });
    assert.equal(detal!.products[0].price, 100_000);
    assert.ok(!("offer" in detal!.products[0]));
    assert.ok(!JSON.stringify(detal).includes("63000"), "ni el precio mayorista con oferta");
    const mayor = await publico.getCatalog({ slug: slugA, context: "wholesale", token: tokenA });
    assert.equal(mayor!.products[0].price, 63_000);
    assert.equal(mayor!.products[0].listPrice, 70_000);
  });

  it("una oferta pausada, vencida o programada no existe para la tienda", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    assert.equal((await publico.getProduct({ slug: slugA, reference: p.reference }))?.price, 80_000);
    snaps[A.tenantId] = instantanea(); // pausada: ya no está publicada
    assert.equal((await publico.getProduct({ slug: slugA, reference: p.reference }))?.price, 100_000);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    reloj = Date.parse("2026-11-01T00:00:00-05:00"); // vencida
    assert.equal((await publico.getProduct({ slug: slugA, reference: p.reference }))?.price, 100_000);
    reloj = Date.parse("2026-10-24T12:00:00-05:00"); // todavía no empieza
    assert.equal((await publico.getProduct({ slug: slugA, reference: p.reference }))?.price, 100_000);
  });

  it("una oferta de una campaña apagada no baja el precio; con la campaña activa, sí", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    const of = veinte([p.reference], { campana: "navidad" });
    snaps[A.tenantId] = instantanea({ ofertas: [of] });
    assert.equal((await publico.getProduct({ slug: slugA, reference: p.reference }))?.price, 100_000);
    snaps[A.tenantId] = instantanea({ ofertas: [of], campanas: [publicada("navidad", campana())] });
    assert.equal((await publico.getProduct({ slug: slugA, reference: p.reference }))?.price, 80_000);
  });

  it("un producto con «precio a consultar» (mayorista sin definir) sigue siendo null aunque haya una oferta para toda la tienda", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(publicada("todo", oferta({ alcance: { todos: true, referencias: [], categorias: [] } })));
    const mayor = await publico.getCatalog({ slug: slugA, context: "wholesale", token: tokenA });
    assert.equal(mayor!.products.find((x) => x.reference === p.reference)?.price, null);
  });

  it("si no se pudieron verificar las ofertas, la TIENDA no se cae: muestra el precio de lista", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = new Error("base de datos caída");
    const original = console.error;
    const avisos: unknown[][] = [];
    console.error = (...a: unknown[]) => void avisos.push(a);
    try {
      assert.equal((await publico.getProduct({ slug: slugA, reference: p.reference }))?.price, 100_000);
      assert.equal((await publico.getCatalog({ slug: slugA, context: "retail" }))!.products[0].price, 100_000);
      assert.equal((await publico.getHome(slugA))?.featured[0].price, 100_000);
    } finally {
      console.error = original;
    }
    assert.equal(avisos.length, 3, "cada vez deja el aviso en el registro");
    assert.match(String(avisos[0].join(" ")), /precio de lista/);
  });
});

describe("la cotización firmada y el pedido: lo cobrado es lo mostrado", () => {
  it("la selección trae el precio efectivo y la cotización firma EXACTAMENTE esos precios", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    const q = await producto(A, "Cadena", 50_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference, q.reference] });
    assert.deepEqual(
      vista!.items.map((i) => [i.reference, i.price]),
      [[p.reference, 80_000], [q.reference, 50_000]],
    );
    const firmados = readQuote(KEY, { businessId: A.tenantId, channel: "retail" }, vista!.quote ?? undefined)!;
    assert.deepEqual([...firmados.entries()].sort(), [[p.reference, 80_000], [q.reference, 50_000]].sort());
    assert.equal(vista!.dynamicPricing, true);
  });

  it("el pedido cobra el precio de la oferta; el borrador, el total y el mensaje salen del mismo cálculo y la evidencia llega al motor", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    const q = await producto(A, "Cadena", 50_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference], { nombre: "Amor y Amistad" }));
    const { resultado } = await pedir([{ reference: p.reference, quantity: 2 }, { reference: q.reference, quantity: 1 }]);
    assert.equal(resultado?.status, "ready");
    if (resultado?.status !== "ready") return;
    assert.equal(resultado.order.total, 2 * 80_000 + 50_000);
    assert.equal(resultado.order.savings, 2 * 20_000);
    assert.deepEqual(
      resultado.draft.items.map((i) => [i.reference, i.unitPrice, i.subtotal]),
      [[p.reference, 80_000, 160_000], [q.reference, 50_000, 50_000]],
    );
    assert.equal(resultado.draft.total, 210_000);
    // El mensaje de WhatsApp: el total efectivo y el ahorro como monto, sin ningún texto escrito por la administradora.
    assert.match(resultado.message, /Total estimado: \$210\.000/);
    assert.match(resultado.message, /Incluye ofertas vigentes \(ahorro: \$40\.000\)/);
    assert.ok(!resultado.message.includes("Amor y Amistad"), "el nombre de la oferta (texto de la administradora) no entra al mensaje que lee el webhook");
    // La solicitud guardada en el motor lleva el precio efectivo y la evidencia (lista + oferta con su versión).
    assert.equal(registradas.length, 1);
    const [lineaP, lineaQ] = registradas[0].lines;
    assert.deepEqual([lineaP.unitPrice, lineaP.subtotal, lineaP.listPrice, lineaP.offer], [80_000, 160_000, 100_000, { key: "amor", name: "Amor y Amistad", version: 1 }]);
    assert.ok(!("listPrice" in lineaQ) && !("offer" in lineaQ), "sin oferta la línea queda como siempre");
  });

  it("si la oferta se PAUSA entre la cotización y el pedido, el pedido NO sale con el precio viejo: el cliente ve el cambio y confirma de nuevo", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    snaps[A.tenantId] = instantanea(); // la administradora pausa la oferta
    const r = await publico.prepareOrder({ slug: slugA, items: [{ reference: p.reference, quantity: 1 }], quote: vista!.quote ?? undefined, requestKey: "intento-00000000001" });
    assert.equal(r?.status, "adjusted");
    assert.deepEqual(r?.order.adjustments, [{ kind: "price_changed", reference: p.reference, name: "Aretes", before: 80_000, after: 100_000 }]);
    assert.equal(registradas.length, 0, "no se guardó ninguna solicitud");
    assert.ok(!sink.events.some((e) => e.event_type === "catalog.order_request.created"));
    // Con la cotización nueva (la del precio vigente) sí sale, al precio de lista.
    const { resultado } = await pedir([{ reference: p.reference, quantity: 1 }]);
    assert.equal(resultado?.status, "ready");
    if (resultado?.status === "ready") assert.equal(resultado.order.total, 100_000);
    assert.ok(sink.events.some((e) => e.event_type === "catalog.order_request.created"), "control: cuando el pedido SÍ sale, el evento SÍ se publica (la aserción de arriba no es vacía)");
  });

  it("si la oferta VENCE entre la cotización y el pedido (el reloj avanza) pasa lo mismo", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference], { vigencia: { desde: "2026-10-25", hasta: "2026-10-31" } }));
    reloj = Date.parse("2026-10-31T23:58:00-05:00");
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    assert.equal(vista!.items[0].price, 80_000);
    reloj = Date.parse("2026-11-01T00:01:00-05:00");
    const r = await publico.prepareOrder({ slug: slugA, items: [{ reference: p.reference, quantity: 1 }], quote: vista!.quote ?? undefined, requestKey: "intento-00000000001" });
    assert.equal(r?.status, "adjusted");
    assert.equal(r?.order.adjustments[0]?.kind, "price_changed");
  });

  it("si cambia el porcentaje (20% → 25%) el pedido con la cotización vieja se ajusta y no se cobra lo que el cliente no vio", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    snaps[A.tenantId] = conOfertas(veinte([p.reference], { beneficio: { tipo: "porcentaje", valor: 25 } }));
    const r = await publico.prepareOrder({ slug: slugA, items: [{ reference: p.reference, quantity: 1 }], quote: vista!.quote ?? undefined, requestKey: "intento-00000000001" });
    assert.equal(r?.status, "adjusted");
    assert.deepEqual(r?.order.adjustments, [{ kind: "price_changed", reference: p.reference, name: "Aretes", before: 80_000, after: 75_000 }]);
  });

  it("un pedido SIN cotización válida (alterada o de otro negocio) no se envía: el cliente revisa los precios vigentes", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    const alterada = `${vista!.quote!.slice(0, -4)}AAAA`;
    for (const quote of [undefined, alterada, "q1.xxx.yyy"]) {
      const r = await publico.prepareOrder({ slug: slugA, items: [{ reference: p.reference, quantity: 1 }], quote, requestKey: "intento-00000000001" });
      assert.equal(r?.status, "review", String(quote));
    }
  });

  it("un cliente no puede forzar un precio: lo único que acepta el servicio son referencias y cantidades", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    const r = await publico.prepareOrder({ slug: slugA, items: [{ reference: p.reference, quantity: 1, price: 1 } as never], quote: undefined, requestKey: "intento-00000000001" });
    assert.equal(r?.status, "review");
    assert.ok(r?.order.lines.every((l) => l.unitPrice === 80_000));
  });

  it("MAYORISTA: se cobra el precio mayorista con SU oferta; una oferta detal no lo afecta", async () => {
    const p = await producto(A, "Aretes", 100_000, 70_000);
    snaps[A.tenantId] = conOfertas(
      publicada("detal", oferta({ modalidad: "detal", alcance: { todos: false, referencias: [p.reference], categorias: [] }, beneficio: { tipo: "porcentaje", valor: 50 } })),
      publicada("mayor", oferta({ modalidad: "mayorista", alcance: { todos: false, referencias: [p.reference], categorias: [] }, beneficio: { tipo: "porcentaje", valor: 10 } })),
    );
    const { resultado } = await pedir([{ reference: p.reference, quantity: 3 }], { context: "wholesale", token: tokenA });
    assert.equal(resultado?.status, "ready");
    if (resultado?.status !== "ready") return;
    assert.equal(resultado.order.total, 3 * 63_000);
    assert.equal(resultado.order.savings, 3 * 7_000);
    const detal = await pedir([{ reference: p.reference, quantity: 1 }]);
    assert.equal(detal.resultado?.status === "ready" ? detal.resultado.order.total : -1, 50_000);
  });

  it("FALLA CERRADO: si el negocio usa ofertas y no se pudieron verificar, el pedido NO se prepara (no se cobra un precio sin verificar)", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    snaps[A.tenantId] = new Error("base de datos caída");
    await assert.rejects(publico.prepareOrder({ slug: slugA, items: [{ reference: p.reference, quantity: 1 }], quote: vista!.quote ?? undefined, requestKey: "intento-00000000001" }), PreciosNoDisponibles);
    assert.equal(registradas.length, 0);
    assert.equal(sink.events.length, 0);
  });

  it("la selección (el carrito) con ofertas sin verificar muestra el precio de lista y NO marca precios dinámicos; el pedido que siga fallará cerrado", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = new Error("base de datos caída");
    const original = console.error;
    console.error = () => {};
    try {
      const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
      assert.equal(vista!.items[0].price, 100_000);
      assert.ok(!("dynamicPricing" in vista!));
    } finally {
      console.error = original;
    }
  });
});

describe("regresión con el módulo APAGADO y aislamiento entre negocios", () => {
  it("con el módulo apagado (el puerto devuelve null) todo es IDÉNTICO a un catálogo sin puerto: listado, ficha, inicio, selección y pedido", async () => {
    const p = await producto(A, "Aretes", 129_900, 90_000);
    const q = await producto(A, "Cadena", 54_000, null);
    snaps[A.tenantId] = null;
    const items = [{ reference: p.reference, quantity: 2 }, { reference: q.reference, quantity: 1 }];
    const [con, sin] = await Promise.all([pedir(items), pedir(items, { servicio: sinPuerto })]);
    assert.deepEqual(con.vista, sin.vista);
    assert.deepEqual(con.resultado, sin.resultado);
    assert.ok(!("dynamicPricing" in con.vista!));
    for (const consulta of [
      (s: typeof publico) => s.getCatalog({ slug: slugA, context: "retail" }),
      (s: typeof publico) => s.getCatalog({ slug: slugA, context: "wholesale", token: tokenA }),
      (s: typeof publico) => s.getProduct({ slug: slugA, reference: p.reference }),
      (s: typeof publico) => s.getHome(slugA),
    ]) assert.deepEqual(await consulta(publico), await consulta(sinPuerto));
  });

  it("con el módulo encendido pero SIN ofertas publicadas los precios son los de lista (y los datos, los mismos de siempre)", async () => {
    const p = await producto(A, "Aretes", 129_900, 90_000);
    snaps[A.tenantId] = instantanea({ tenantId: A.tenantId });
    const [con, sin] = await Promise.all([pedir([{ reference: p.reference, quantity: 1 }]), pedir([{ reference: p.reference, quantity: 1 }], { servicio: sinPuerto })]);
    // Lo único distinto es la marca «precios dinámicos» (con el módulo encendido la tienda no guarda precios en cachés compartidas).
    assert.equal(con.resultado?.selection.dynamicPricing, true);
    const { dynamicPricing: _marca, ...seleccion } = con.resultado!.selection;
    void _marca;
    assert.deepEqual({ ...con.resultado, selection: seleccion }, sin.resultado);
    assert.deepEqual(con.vista!.items, sin.vista!.items);
  });

  it("AISLAMIENTO: las ofertas de un negocio no tocan los precios de otro ni se mezclan por tener la misma referencia", async () => {
    const pa = await producto(A, "Aretes A", 100_000, null);
    const pb = await producto(B, "Aretes B", 100_000, null);
    assert.equal(pa.reference, pb.reference, "la misma referencia en dos negocios");
    snaps[A.tenantId] = conOfertas(veinte([pa.reference]));
    snaps[B.tenantId] = instantanea({ tenantId: B.tenantId });
    assert.equal((await publico.getProduct({ slug: slugA, reference: pa.reference }))?.price, 80_000);
    assert.equal((await publico.getProduct({ slug: slugB, reference: pb.reference }))?.price, 100_000);
    const { resultado } = await pedir([{ reference: pb.reference, quantity: 1 }], { slug: slugB });
    assert.equal(resultado?.status === "ready" ? resultado.order.total : -1, 100_000);
  });
});

describe("el carrito del navegador muestra el ahorro pero nunca decide el precio", () => {
  it("la línea guarda el precio de lista y la etiqueta solo para mostrar; al reconciliar con el catálogo se corrigen o se retiran", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    const { cartProductOf } = await import("@/lib/catalogo/pedido-http");
    const producto1 = cartProductOf(vista!.items[0]);
    assert.equal(producto1.price, 80_000);
    assert.equal(producto1.listPrice, 100_000);
    assert.equal(producto1.offerLabel, "-20%");
    let estado = cartReducer(emptyCart(slugA, "retail"), { type: "add", product: producto1, quantity: 2 });
    assert.equal(estado.lines[0].listPrice, 100_000);
    // La oferta termina: la reconciliación corrige el precio y quita el ahorro.
    snaps[A.tenantId] = instantanea();
    const nueva = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    estado = cartReducer(estado, { type: "reconcile", resolved: nueva!.items.map(cartProductOf), unknown: nueva!.unknown });
    assert.equal(estado.lines[0].unitPrice, 100_000);
    assert.ok(!("listPrice" in estado.lines[0]) && !("offerLabel" in estado.lines[0]));
  });
});

describe("HTTP: nada de precios viejos en cachés compartidas cuando hay ofertas", () => {
  const pedirSeleccion = async (servicio: typeof publico, canal: { slug: string; context: "retail" | "wholesale"; token?: string }, ref: string) =>
    responderSeleccion(new Request(`http://localhost/catalogo/x/seleccion?ref=${ref}`), canal, () => servicio, sinLimitePublico);

  it("con ofertas (módulo encendido) la selección responde private, no-store; con el módulo apagado queda la caché corta de siempre", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference]));
    const dinamica = await pedirSeleccion(publico, { slug: slugA, context: "retail" }, p.reference);
    assert.equal(dinamica.headers.get("cache-control"), "private, no-store");
    assert.equal(((await dinamica.json()) as { items: Array<{ price: number }> }).items[0].price, 80_000);
    snaps[A.tenantId] = null;
    const normal = await pedirSeleccion(publico, { slug: slugA, context: "retail" }, p.reference);
    assert.equal(normal.headers.get("cache-control"), "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
    const sin = await pedirSeleccion(sinPuerto, { slug: slugA, context: "retail" }, p.reference);
    assert.equal(sin.headers.get("cache-control"), "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
  });

  it("la respuesta de la selección lleva el precio de lista y la etiqueta (para el ahorro del carrito) y nada interno", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    snaps[A.tenantId] = conOfertas(veinte([p.reference], { nombre: "Amor y Amistad" }));
    const r = await pedirSeleccion(publico, { slug: slugA, context: "retail" }, p.reference);
    const cuerpo = (await r.json()) as { items: Array<Record<string, unknown>>; quote: string };
    assert.deepEqual(Object.keys(cuerpo.items[0]).sort(), ["available", "imageUrl", "listPrice", "maxQuantity", "name", "offerLabel", "price", "reference"].sort());
    const texto = JSON.stringify(cuerpo);
    assert.ok(!texto.includes(A.tenantId) && !texto.includes("amor"), "ni el negocio ni el código interno de la oferta");
  });
});
