/**
 * Resolución interna (motor de pedidos y ARIA) con ofertas: los precios que entrega son los EFECTIVOS (los mismos que se muestran y se cobran), los de lista y la oferta solo existen
 * cuando una oferta vigente fija el precio de ese canal, el precio y la oferta del otro canal nunca se cuelan, y si no se pueden verificar las ofertas NO se sigue con un precio sin verificar.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { CatalogProduct } from "@/lib/catalogo/domain";
import type { EvaluadorPrecios, OfertaDePrecio, PuertoPrecios } from "@/lib/catalogo/precios";
import { PreciosNoDisponibles } from "@/lib/catalogo/precios";
import { conPrecios } from "@/lib/catalogo/repository";
import { createResolucionCatalogo, toOrderProduct, type ProductoResuelto } from "@/lib/catalogo/resolucion";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };

const oferta = (clave: string, over: Partial<OfertaDePrecio> = {}): OfertaDePrecio => ({
  clave,
  nombre: "Amor y Amistad",
  version: 3,
  beneficio: "20% de descuento",
  etiqueta: "-20%",
  ahorro: 0,
  vigencia: "hasta el 31 de octubre de 2026",
  condiciones: null,
  ...over,
});

const base = (over: Partial<ProductoResuelto> = {}): ProductoResuelto & { productId?: string } =>
  ({
    reference: "DL-000184",
    name: "Dije corazón",
    description: null,
    categoryId: null,
    categoryName: null,
    material: null,
    color: null,
    prices: { retail: 80_000, wholesale: 70_000 },
    stock: { tracked: false, units: null },
    status: "ACTIVE",
    available: true,
    availability: "available",
    maxQuantity: null,
    image: null,
    ...over,
  }) as ProductoResuelto;

describe("toOrderProduct — la verdad de un producto para un pedido de UN canal", () => {
  it("con la oferta del canal: el precio efectivo, el de lista de ESE canal y la oferta con su versión (sin el texto de la administradora)", () => {
    const p = base({ listPrices: { retail: 100_000, wholesale: 70_000 }, offers: { retail: oferta("amor"), wholesale: null } });
    assert.deepEqual(toOrderProduct(p, "retail"), {
      reference: "DL-000184",
      name: "Dije corazón",
      price: 80_000,
      listPrice: 100_000,
      offer: { key: "amor", name: "Amor y Amistad", version: 3 },
      availability: "available",
      maxQuantity: null,
    });
  });

  it("la oferta del OTRO canal nunca entra: el pedido mayorista no lleva la oferta del detal ni su precio de lista", () => {
    const p = base({ listPrices: { retail: 100_000, wholesale: 70_000 }, offers: { retail: oferta("amor"), wholesale: null } });
    const mayor = toOrderProduct(p, "wholesale");
    assert.equal(mayor.price, 70_000);
    assert.ok(!("listPrice" in mayor) && !("offer" in mayor));
    const soloMayor = base({ listPrices: { retail: 100_000, wholesale: 70_000 }, offers: { retail: null, wholesale: oferta("mayor", { nombre: "Mayoristas" }) } });
    assert.ok(!("offer" in toOrderProduct(soloMayor, "retail")));
    const pedidoMayor = toOrderProduct(soloMayor, "wholesale");
    assert.deepEqual(pedidoMayor.offer, { key: "mayor", name: "Mayoristas", version: 3 });
    assert.equal(pedidoMayor.listPrice, 70_000, "el precio de lista que queda como evidencia es el MAYORISTA, no el del detal");
  });

  it("sin ofertas el resultado es EXACTAMENTE el de siempre (ni siquiera existen las propiedades de evidencia)", () => {
    const r = toOrderProduct(base(), "retail");
    assert.deepEqual(Object.keys(r).sort(), ["availability", "maxQuantity", "name", "price", "reference"]);
  });

  it("una oferta sin su precio de lista no deja evidencia a medias", () => {
    const r = toOrderProduct(base({ offers: { retail: oferta("amor"), wholesale: null } }), "retail");
    assert.ok(!("offer" in r) && !("listPrice" in r));
  });

  it("el id interno se conserva solo para el backend", () => {
    assert.equal(toOrderProduct({ ...base(), productId: "p-1" }, "retail").productId, "p-1");
  });
});

describe("createResolucionCatalogo con el puerto de precios", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let admin: ReturnType<typeof createCatalogService>;
  let referencia: string;
  let modo: "ofertas" | "sin-ofertas" | "apagado" | "falla";
  let consultasDelPuerto: string[];

  const evaluador = (): EvaluadorPrecios => ({
    de: (producto: Pick<CatalogProduct, "reference" | "pricing">, canal) => {
      const lista = canal === "retail" ? producto.pricing.retail : producto.pricing.wholesale;
      if (modo === "ofertas" && canal === "retail" && lista !== null && producto.reference === referencia) return { precio: Math.round(lista * 0.8), precioLista: lista, oferta: oferta("amor") };
      return { precio: lista, precioLista: lista, oferta: null };
    },
  });
  const puerto: PuertoPrecios = {
    async paraNegocio(tenantId) {
      consultasDelPuerto.push(tenantId);
      if (modo === "falla") throw new PreciosNoDisponibles("base caída");
      return modo === "apagado" ? null : evaluador();
    },
  };

  beforeEach(async () => {
    mem = createInMemoryCatalogRepository();
    admin = createCatalogService({ repo: mem.repo });
    mem.enableModule(A.tenantId);
    modo = "ofertas";
    consultasDelPuerto = [];
    referencia = (await admin.createProduct(A, { stock: 10, name: "Dije", retailPrice: 100_000, wholesalePrice: 70_000 })).reference;
  });

  it("con una oferta vigente: los precios son los efectivos, y llegan los de lista y la oferta de cada canal", async () => {
    const resol = createResolucionCatalogo({ repo: conPrecios(mem.repo, puerto) });
    const r = await resol.resolverReferencia(A.tenantId, referencia);
    assert.ok(r);
    assert.deepEqual(r.prices, { retail: 80_000, wholesale: 70_000 });
    assert.deepEqual(r.listPrices, { retail: 100_000, wholesale: 70_000 });
    assert.equal(r.offers?.retail?.clave, "amor");
    assert.equal(r.offers?.wholesale, null);
    assert.deepEqual(consultasDelPuerto, [A.tenantId], "una consulta del negocio dueño de los productos");
  });

  it("la herramienta del agente (por referencia) entrega el mismo precio efectivo", async () => {
    const resol = createResolucionCatalogo({ repo: conPrecios(mem.repo, puerto) });
    const r = await resol.resolveByReference(A.tenantId, referencia);
    assert.equal(r.status, "found");
    if (r.status === "found") assert.deepEqual(r.product.prices, { retail: 80_000, wholesale: 70_000 });
  });

  it("el pedido que prepara el motor sale con el precio efectivo y la evidencia de la oferta", async () => {
    const resol = createResolucionCatalogo({ repo: conPrecios(mem.repo, puerto) });
    const { order } = await resol.resolveOrder(A.tenantId, "retail", [{ reference: referencia, quantity: 2 }]);
    assert.deepEqual(order.lines.map((l) => [l.unitPrice, l.subtotal, l.listPrice, l.offer?.key]), [[80_000, 160_000, 100_000, "amor"]]);
    assert.equal(order.savings, 40_000);
    const mayor = await resol.resolveOrder(A.tenantId, "wholesale", [{ reference: referencia, quantity: 2 }]);
    assert.deepEqual(mayor.order.lines.map((l) => [l.unitPrice, l.listPrice]), [[70_000, undefined]]);
    assert.equal(mayor.order.savings, 0);
  });

  it("sin ofertas vigentes (módulo encendido, nada publicado) el producto queda exactamente como siempre", async () => {
    modo = "sin-ofertas";
    const resol = createResolucionCatalogo({ repo: conPrecios(mem.repo, puerto) });
    const r = await resol.resolverReferencia(A.tenantId, referencia);
    assert.ok(r);
    assert.deepEqual(r.prices, { retail: 100_000, wholesale: 70_000 });
    assert.ok(!("listPrices" in r) && !("offers" in r));
  });

  it("MÓDULO APAGADO (el puerto no entrega evaluador) o sin puerto: precio de lista, igual que antes del CMS", async () => {
    modo = "apagado";
    for (const repo of [conPrecios(mem.repo, puerto), mem.repo]) {
      const r = await createResolucionCatalogo({ repo }).resolverReferencia(A.tenantId, referencia);
      assert.ok(r);
      assert.deepEqual(r.prices, { retail: 100_000, wholesale: 70_000 });
      assert.ok(!("listPrices" in r) && !("offers" in r));
    }
  });

  it("FALLA CERRADO: si el negocio usa ofertas y no se pudieron verificar, la resolución lanza (ni el motor ni ARIA siguen con un precio sin verificar)", async () => {
    modo = "falla";
    const resol = createResolucionCatalogo({ repo: conPrecios(mem.repo, puerto) });
    await assert.rejects(resol.resolverReferencia(A.tenantId, referencia), PreciosNoDisponibles);
    await assert.rejects(resol.resolveByReference(A.tenantId, referencia), PreciosNoDisponibles);
    await assert.rejects(resol.resolveOrder(A.tenantId, "retail", [{ reference: referencia, quantity: 1 }]), PreciosNoDisponibles);
    await assert.rejects(resol.resolverReferencias(A.tenantId, [referencia]), PreciosNoDisponibles);
  });
});
