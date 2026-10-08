/**
 * CMS comercial — de PUNTA A PUNTA con el SQL REAL (Postgres embebido): la administradora publica una oferta o un combo en la base; el lector verificado de la
 * aplicación lo entrega; el catálogo calcula el precio efectivo; la tienda lo muestra, la cotización lo firma y el pedido lo cobra. Pausar, vencer, apagar el módulo,
 * tocar la base a mano o mirar desde otro negocio: todo contra la base de verdad. Negocios y productos ficticios.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { crearLectorSupabase } from "@/lib/cms-comercial/lector";
import { crearPuertoPreciosCms } from "@/lib/cms-comercial/precios";
import { productoParaCombo } from "@/lib/cms-comercial/publico-supabase";
import { crearDelacourSintetico } from "@/lib/cms-comercial/testing/delacour";
import { TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { cargarVitrinaInicio } from "@/lib/cms-comercial/vitrina-publica";
import { conPrecios } from "@/lib/catalogo/repository";
import { createResolucionCatalogo } from "@/lib/catalogo/resolucion";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

const A: CatalogActor = { tenantId: TENANT_A, userId: "admin-a" };
const B: CatalogActor = { tenantId: TENANT_B, userId: "admin-b" };
const KEY = Buffer.alloc(32, 9);

const abiertas: BaseCms[] = [];
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()?.cerrar();
});

let reloj: number;
let b: BaseCms;
let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let publico: ReturnType<typeof createPublicCatalogService>;
let puerto: ReturnType<typeof crearPuertoPreciosCms>;
let slugA: string;

beforeEach(async () => {
  reloj = Date.parse("2026-10-28T12:00:00-05:00");
  b = await crearDelacourSintetico();
  abiertas.push(b);
  await b.habilitarModulo(TENANT_B);
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  puerto = crearPuertoPreciosCms({ cargar: (tenantId) => crearLectorSupabase(b.supabase).cargar(tenantId), ahora: () => reloj });
  publico = createPublicCatalogService({ repo: conPrecios(mem.repo, puerto), orders: { key: KEY, events: memoryOrderEventSink(), now: () => new Date(reloj) } });
  for (const actor of [A, B]) {
    mem.setProfile(actor.tenantId, { name: "Joyería de prueba", whatsapp: "573001112233" });
    mem.enableModule(actor.tenantId);
  }
  slugA = (await admin.ensurePublication(A)).slug;
});

const ofertaSql = (refs: string[], over: Record<string, unknown> = {}) => ({
  nombre: "Amor y Amistad",
  modalidad: "ambas",
  beneficio: { tipo: "porcentaje", valor: 20 },
  alcance: { todos: false, referencias: refs, categorias: [] },
  vigencia: { desde: "2026-10-25", hasta: "2026-10-31" },
  prioridad: 5,
  ...over,
});

/** Crea y PUBLICA un elemento directamente en SQL (así se prueban también contenidos que la aplicación no dejaría publicar). */
async function publicar(tenant: string, tipo: string, clave: string, contenido: unknown, checksum = checksumDe(contenido)) {
  const [{ r }] = await b.sql<{ r: { entidad: { id: string; rev: number } } }>("select public.dulabs_cms_crear($1, $2, $3, $4::jsonb, null, 'Prueba') as r", [tenant, tipo, clave, JSON.stringify(contenido)]);
  await b.sql("select public.dulabs_cms_publicar($1, $2, $3, 0, $4, null, null, 'Prueba')", [tenant, r.entidad.id, r.entidad.rev, checksum]);
  return r.entidad.id;
}
const producto = (actor: CatalogActor, name: string, retail: number, wholesale: number | null, stock = 10) => admin.createProduct(actor, { name, retailPrice: retail, wholesalePrice: wholesale, stock });
const precioDe = async (reference: string, context: "retail" | "wholesale" = "retail") => (await publico.getProduct({ slug: slugA, reference, context, token: context === "wholesale" ? await tokenMayor() : undefined }))?.price;
const tokenMayor = async () => (await admin.getPublication(A, { includeWholesale: true }))!.wholesalePath!.split("/").pop()!;

describe("oferta publicada en la base => precio efectivo en la tienda, la cotización y el pedido", () => {
  it("publicar baja el precio en la tienda de inmediato; pausar lo devuelve al de lista; reanudar lo baja otra vez", async () => {
    const p = await producto(A, "Aretes", 100_000, 70_000);
    assert.equal(await precioDe(p.reference), 100_000, "antes de publicar");
    const id = await publicar(TENANT_A, "oferta", "amor", ofertaSql([p.reference]));
    assert.equal(await precioDe(p.reference), 80_000, "publicada");
    await b.sql("select public.dulabs_cms_pausar($1, $2, null, 'Prueba')", [TENANT_A, id]);
    assert.equal(await precioDe(p.reference), 100_000, "pausada");
    await b.sql("select public.dulabs_cms_reanudar($1, $2, null, 'Prueba')", [TENANT_A, id]);
    assert.equal(await precioDe(p.reference), 80_000, "reanudada");
    await b.sql("select public.dulabs_cms_despublicar($1, $2, null, 'Prueba')", [TENANT_A, id]);
    assert.equal(await precioDe(p.reference), 100_000, "despublicada: el borrador nunca afecta la tienda");
  });

  it("el pedido cobra lo mostrado y firmado; si la oferta se pausa antes de pedir, el pedido se ajusta con el precio nuevo", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    const id = await publicar(TENANT_A, "oferta", "amor", ofertaSql([p.reference]));
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    assert.equal(vista!.items[0].price, 80_000);
    const listo = await publico.prepareOrder({ slug: slugA, items: [{ reference: p.reference, quantity: 2 }], quote: vista!.quote ?? undefined, requestKey: "intento-00000000001" });
    assert.equal(listo?.status, "ready");
    if (listo?.status === "ready") assert.equal(listo.order.total, 160_000);
    await b.sql("select public.dulabs_cms_pausar($1, $2, null, 'Prueba')", [TENANT_A, id]);
    const ajustado = await publico.prepareOrder({ slug: slugA, items: [{ reference: p.reference, quantity: 2 }], quote: vista!.quote ?? undefined, requestKey: "intento-00000000002" });
    assert.equal(ajustado?.status, "adjusted");
    assert.deepEqual(ajustado?.order.adjustments, [{ kind: "price_changed", reference: p.reference, name: "Aretes", before: 80_000, after: 100_000 }]);
  });

  it("vencida por el reloj (hora de Bogotá, [desde, hasta)): el último minuto del día final todavía vale; el siguiente, no", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    await publicar(TENANT_A, "oferta", "amor", ofertaSql([p.reference]));
    reloj = Date.parse("2026-10-31T23:59:00-05:00");
    assert.equal(await precioDe(p.reference), 80_000);
    reloj = Date.parse("2026-11-01T00:00:00-05:00");
    assert.equal(await precioDe(p.reference), 100_000);
  });

  it("CONTRATO DE MODALIDAD con el SQL real: la oferta mayorista no toca el detal y la detal no toca el mayorista", async () => {
    const p = await producto(A, "Aretes", 100_000, 70_000);
    await publicar(TENANT_A, "oferta", "mayor", ofertaSql([p.reference], { modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 10 } }));
    assert.equal(await precioDe(p.reference, "retail"), 100_000);
    assert.equal(await precioDe(p.reference, "wholesale"), 63_000);
    await publicar(TENANT_A, "oferta", "detal", ofertaSql([p.reference], { modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 50 }, prioridad: 9 }));
    assert.equal(await precioDe(p.reference, "retail"), 50_000);
    assert.equal(await precioDe(p.reference, "wholesale"), 63_000, "la oferta detal no cambia el precio mayorista");
  });

  it("NO se acumulan: dos ofertas publicadas dejan UNA sola (la de mayor prioridad)", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    await publicar(TENANT_A, "oferta", "uno", ofertaSql([p.reference], { prioridad: 1, beneficio: { tipo: "porcentaje", valor: 30 } }));
    await publicar(TENANT_A, "oferta", "dos", ofertaSql([p.reference], { prioridad: 8, beneficio: { tipo: "porcentaje", valor: 10 } }));
    assert.equal(await precioDe(p.reference), 90_000);
  });

  it("MÓDULO APAGADO: aunque la oferta siga publicada en la base, la tienda cobra el precio de lista (regresión con el módulo apagado)", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    await publicar(TENANT_A, "oferta", "amor", ofertaSql([p.reference]));
    assert.equal(await precioDe(p.reference), 80_000);
    await b.habilitarModulo(TENANT_A, false);
    assert.equal(await precioDe(p.reference), 100_000);
    const vista = await publico.resolveSelection({ slug: slugA, references: [p.reference] });
    assert.ok(!("dynamicPricing" in vista!), "sin módulo, la selección queda como siempre");
  });

  it("AISLAMIENTO: la oferta de otro negocio no baja el precio de este aunque tengan la misma referencia", async () => {
    const pa = await producto(A, "Aretes A", 100_000, null);
    const pb = await producto(B, "Aretes B", 100_000, null);
    assert.equal(pa.reference, pb.reference);
    await publicar(TENANT_B, "oferta", "de-b", ofertaSql([pb.reference]));
    assert.equal(await precioDe(pa.reference), 100_000);
  });

  it("si alguien toca el contenido publicado a mano en la base (el checksum ya no coincide) la oferta NO se aplica: se descarta y la tienda sigue con el precio de lista", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    const contenido = ofertaSql([p.reference]);
    await publicar(TENANT_A, "oferta", "adulterada", { ...contenido, beneficio: { tipo: "porcentaje", valor: 90 } }, checksumDe(contenido));
    const original = console.warn;
    console.warn = () => {};
    try {
      assert.equal(await precioDe(p.reference), 100_000);
    } finally {
      console.warn = original;
    }
  });

  it("una oferta que NO cumple el esquema estricto (llegó a la base sin pasar por la validación) tampoco se aplica", async () => {
    const p = await producto(A, "Aretes", 100_000, null);
    await publicar(TENANT_A, "oferta", "mala", { ...ofertaSql([p.reference]), beneficio: { tipo: "porcentaje", valor: 99 } });
    const original = console.warn;
    console.warn = () => {};
    try {
      assert.equal(await precioDe(p.reference), 100_000, "99% supera el tope permitido: se descarta, no se aplica");
    } finally {
      console.warn = original;
    }
  });
});

describe("combo publicado en la base => se muestra en la tienda con su disponibilidad real (Etapa 1: se consulta con una asesora, no se compra)", () => {
  it("el combo sale armado con los datos reales del catálogo; si un componente se agota, deja de estar disponible y pierde el enlace de pedido", async () => {
    const p = await producto(A, "Aretes dorados", 90_000, null, 5);
    const q = await producto(A, "Cadena fina", 50_000, null, 5);
    const homeSql = {
      portada: { visible: true, titulo: "Portada de prueba", imagen: { origen: "estatico", src: "/catalogo/prueba/portada.png", ancho: 1600, alto: 900, alt: "Portada de prueba" } },
      secciones: [{ tipo: "portada", visible: true }, { tipo: "combos", visible: true }],
      categorias_destacadas: [],
      productos_destacados: [],
    };
    await publicar(TENANT_A, "home", "home", homeSql);
    await publicar(TENANT_A, "combo", "regalo", {
      nombre: "Regalo completo",
      modalidad: "ambas",
      componentes: [{ referencia: p.reference, cantidad: 1 }, { referencia: q.reference, cantidad: 2 }],
      precio: { detal: 150_000, mayorista: 110_000 },
      vigencia: { desde: "2026-10-25", hasta: "2026-10-31" },
      prioridad: 1,
    });
    const resolucion = () => createResolucionCatalogo({ repo: conPrecios(mem.repo, puerto) });
    const cargar = () =>
      cargarVitrinaInicio(
        {
          tenantDe: async (slug) => (slug === slugA ? TENANT_A : null),
          cargar: (tenantId) => crearLectorSupabase(b.supabase).cargar(tenantId),
          productosDeCombos: async (tenantId, referencias) => {
            const lote = await resolucion().resolverReferencias(tenantId, referencias);
            return new Map(lote.items.map((x) => [x.reference, productoParaCombo(x)]));
          },
          ahora: () => reloj,
        },
        storefrontConfigFor("tienda-sin-registro"),
        { slug: slugA, basePath: `/catalogo/${slugA}`, listPath: `/catalogo/${slugA}?todo=1`, whatsapp: "573001112233", categorias: new Set() },
      );

    const v = await cargar();
    assert.equal(v.origen, "cms");
    assert.deepEqual(v.config.combos?.map((c) => [c.clave, c.disponible, c.precioNormal, c.precioCombo, c.ahorro]), [["regalo", true, 190_000, 150_000, 40_000]]);
    assert.ok(v.config.combos?.[0].consultaHref?.startsWith("https://wa.me/573001112233?text="));

    await admin.updateProduct(A, q.id, { stock: 1 }); // el combo pide 2 de la cadena: ya no alcanza
    const sinStock = (await cargar()).config.combos?.[0];
    assert.equal(sinStock?.disponible, false);
    assert.equal(sinStock?.consultaHref, null);
    assert.deepEqual(sinStock?.componentes.map((c) => c.disponible), [true, false]);
    assert.ok(!JSON.stringify(sinStock).includes("maxCantidad"));
  });

  it("si un componente tiene una oferta vigente, el «precio normal» del combo suma lo que se paga HOY por separado (nunca promete un descuento que no existe)", async () => {
    const p = await producto(A, "Aretes dorados", 100_000, null, 5);
    const q = await producto(A, "Cadena fina", 50_000, null, 5);
    await publicar(TENANT_A, "home", "home", {
      portada: { visible: true, titulo: "Portada de prueba", imagen: { origen: "estatico", src: "/catalogo/prueba/portada.png", ancho: 1600, alto: 900, alt: "Portada de prueba" } },
      secciones: [{ tipo: "portada", visible: true }, { tipo: "combos", visible: true }],
      categorias_destacadas: [],
      productos_destacados: [],
    });
    await publicar(TENANT_A, "oferta", "amor", ofertaSql([p.reference]));
    await publicar(TENANT_A, "combo", "regalo", {
      nombre: "Regalo completo",
      modalidad: "ambas",
      componentes: [{ referencia: p.reference, cantidad: 1 }, { referencia: q.reference, cantidad: 1 }],
      precio: { detal: 120_000, mayorista: 90_000 },
      vigencia: { desde: "2026-10-25", hasta: "2026-10-31" },
      prioridad: 1,
    });
    const resolucion = createResolucionCatalogo({ repo: conPrecios(mem.repo, puerto) });
    const v = await cargarVitrinaInicio(
      {
        tenantDe: async () => TENANT_A,
        cargar: (tenantId) => crearLectorSupabase(b.supabase).cargar(tenantId),
        productosDeCombos: async (tenantId, referencias) => {
          const lote = await resolucion.resolverReferencias(tenantId, referencias);
          return new Map(lote.items.map((x) => [x.reference, productoParaCombo(x)]));
        },
        ahora: () => reloj,
      },
      storefrontConfigFor("tienda-sin-registro"),
      { slug: slugA, basePath: `/catalogo/${slugA}`, listPath: `/catalogo/${slugA}?todo=1`, whatsapp: "573001112233", categorias: new Set() },
    );
    // Por separado hoy: 80.000 (con la oferta del 20%) + 50.000 = 130.000; el combo a 120.000 ahorra 10.000 (no 30.000 contra los precios de lista).
    assert.deepEqual(v.config.combos?.map((c) => [c.precioNormal, c.precioCombo, c.ahorro]), [[130_000, 120_000, 10_000]]);
  });
});
