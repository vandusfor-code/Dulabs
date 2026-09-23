/**
 * Tienda pública (detal) y resolución determinista por referencia — sin red
 * ni BD (repositorio en memoria). Garantías:
 *   - la referencia es la identidad del producto (búsqueda exacta, nunca por nombre);
 *   - el backend decide precio vigente y disponibilidad; el navegador solo aporta referencias;
 *   - detal nunca expone el precio mayorista; el mayorista exige su token;
 *   - destacados con política explícita y reemplazable; inicio con consultas acotadas;
 *   - aislamiento por tenant en todo.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createResolucionCatalogo } from "@/lib/catalogo/resolucion";
import { FEATURED_LIMIT, SELECTION_MAX, createCatalogService, createPublicCatalogService, normalizeReferences, type CatalogActor } from "@/lib/catalogo/service";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import type { OrderItem } from "@/lib/catalogo/pedido";
import { createInMemoryCatalogRepository, WEBP_HEAD } from "@/lib/catalogo/testing/in-memory-repository";

const DELACOUR: CatalogActor = { tenantId: "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4", userId: "admin" };
const OTRO: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-000000000002", userId: "otro" };

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let publico: ReturnType<typeof createPublicCatalogService>;
let slug: string;

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  let n = 0;
  admin = createCatalogService({ repo: mem.repo, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  publico = createPublicCatalogService({ repo: mem.repo, orders: { key: Buffer.alloc(32, 7), events: memoryOrderEventSink() } });
  mem.setProfile(DELACOUR.tenantId, { name: "Delacour Joyería", whatsapp: "573183715860" });
  mem.enableModule(DELACOUR.tenantId);
  slug = (await admin.ensurePublication(DELACOUR)).slug;
});

async function foto(actor: CatalogActor, productId: string, makePrimary: boolean) {
  const t = await admin.requestImageUpload(actor, productId, { mimeType: "image/webp", bytes: 10, thumbBytes: 10 });
  mem.putObject(t.image.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
  mem.putObject(t.thumb.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
  await admin.confirmImage(actor, productId, { uploadId: t.uploadId, mimeType: "image/webp", width: 800, height: 800, makePrimary });
  return t;
}

describe("marco de la tienda", () => {
  it("identidad, categorías y WhatsApp desde la BD; 404 si no está publicado o el módulo está apagado", async () => {
    await admin.createCategory(DELACOUR, { name: "Anillos" });
    const t = await publico.getStorefront(slug);
    assert.equal(t?.publicName, "Delacour Joyería");
    assert.equal(t?.whatsapp, "573183715860");
    assert.deepEqual(t?.categories.map((c) => c.name), ["Anillos"]);
    mem.setPublished(DELACOUR.tenantId, false);
    assert.equal(await publico.getStorefront(slug), null);
    mem.setPublished(DELACOUR.tenantId, true);
    mem.enableModule(DELACOUR.tenantId, false);
    assert.equal(await publico.getStorefront(slug), null);
  });
});

describe("inicio: destacados y categorías", () => {
  it("destacados = activos con foto (política explícita), con tope; nunca inactivos", async () => {
    const conFoto = await admin.createProduct(DELACOUR, { stock: 10, name: "Con foto", retailPrice: 10_000 });
    await foto(DELACOUR, conFoto.id, true);
    await admin.createProduct(DELACOUR, { stock: 10, name: "Sin foto", retailPrice: 10_000 });
    const inactivo = await admin.createProduct(DELACOUR, { stock: 10, name: "Inactivo", retailPrice: 10_000 });
    await foto(DELACOUR, inactivo.id, true);
    await admin.updateProduct(DELACOUR, inactivo.id, { status: "INACTIVE" });

    const home = await publico.getHome(slug);
    assert.equal(home?.featuredPolicy, "recent-with-photo");
    assert.deepEqual(home?.featured.map((p) => p.name), ["Con foto"]);
  });

  it("si ningún producto tiene foto, los más recientes (política 'recent'); con tope", async () => {
    for (let i = 0; i < FEATURED_LIMIT + 3; i++) await admin.createProduct(DELACOUR, { stock: 10, name: `Pieza ${i}`, retailPrice: 1_000 });
    const home = await publico.getHome(slug);
    assert.equal(home?.featuredPolicy, "recent");
    assert.equal(home?.featured.length, FEATURED_LIMIT);
  });

  it("cada categoría real con la miniatura pública de uno de sus productos (o null)", async () => {
    const anillos = await admin.createCategory(DELACOUR, { name: "Anillos" });
    await admin.createCategory(DELACOUR, { name: "Dijes" });
    const p = await admin.createProduct(DELACOUR, { stock: 10, name: "Solitario", retailPrice: 50_000, categoryId: anillos.id });
    await foto(DELACOUR, p.id, true);
    const home = await publico.getHome(slug);
    const byName = new Map(home?.categories.map((c) => [c.name, c.coverUrl]));
    assert.match(byName.get("Anillos") ?? "", new RegExp(`^/catalogo/${slug}/productos/${p.reference.toLowerCase()}/thumb\\.webp\\?v=`));
    assert.equal(byName.get("Dijes"), null);
    assert.equal(JSON.stringify(home).includes(DELACOUR.tenantId), false, "sin ids de tenant");
    assert.equal(JSON.stringify(home).includes(p.id), false, "sin ids de producto");
  });

  it("sin productos: inicio vacío, nada inventado", async () => {
    assert.deepEqual(await publico.getHome(slug), { featured: [], featuredPolicy: "recent", categories: [] });
  });
});

describe("ficha de producto por referencia", () => {
  it("resuelve por referencia (sin importar mayúsculas), con galería ordenada (principal primero)", async () => {
    const cat = await admin.createCategory(DELACOUR, { name: "Dijes" });
    const p = await admin.createProduct(DELACOUR, { stock: 10, name: "Dije corazón", retailPrice: 35_000, wholesalePrice: 18_000, material: "Oro laminado", categoryId: cat.id });
    await foto(DELACOUR, p.id, true);
    await foto(DELACOUR, p.id, false);
    await foto(DELACOUR, p.id, false);

    const d = await publico.getProduct({ slug, reference: p.reference.toLowerCase() });
    assert.ok(d);
    assert.equal(d.reference, p.reference);
    assert.equal(d.price, 35_000);
    assert.equal(d.material, "Oro laminado");
    assert.equal(d.categoryId, cat.id);
    assert.equal(d.available, true);
    const base = `/catalogo/${slug}/productos/${p.reference.toLowerCase()}`;
    assert.deepEqual(
      d.gallery.map((g) => [g.imageUrl.split("?")[0], g.thumbUrl.split("?")[0]]),
      [
        [`${base}/main.webp`, `${base}/thumb.webp`],
        [`${base}/2.webp`, `${base}/2-thumb.webp`],
        [`${base}/3.webp`, `${base}/3-thumb.webp`],
      ],
    );
    assert.equal(JSON.stringify(d).includes("18000"), false, "la ficha detal nunca lleva el precio mayorista");
  });

  it("404 (null) para inactivos, inexistentes, referencias inválidas u otro negocio", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 10, name: "Pieza", retailPrice: 1_000 });
    mem.setProfile(OTRO.tenantId, { name: "Otro negocio", whatsapp: null });
    mem.enableModule(OTRO.tenantId);
    const otro = await admin.ensurePublication(OTRO);
    assert.equal(await publico.getProduct({ slug: otro.slug, reference: p.reference }), null, "la referencia es por tenant");
    assert.equal(await publico.getProduct({ slug, reference: "dl-999999" }), null);
    assert.equal(await publico.getProduct({ slug, reference: "dije corazón" }), null, "nunca por nombre");
    await admin.updateProduct(DELACOUR, p.id, { status: "INACTIVE" });
    assert.equal(await publico.getProduct({ slug, reference: p.reference }), null);
  });

  it("contexto mayorista solo con el token exacto", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 10, name: "Pieza", retailPrice: 35_000, wholesalePrice: 18_000 });
    const token = (await admin.getPublication(DELACOUR, { includeWholesale: true }))!.wholesalePath!.split("/").pop()!;
    assert.equal(await publico.getProduct({ slug, reference: p.reference, context: "wholesale" }), null);
    assert.equal((await publico.getProduct({ slug, reference: p.reference, context: "wholesale", token }))?.price, 18_000);
  });
});

describe("disponibilidad (la decide el backend)", () => {
  it("sin control de inventario (legado): disponible; con control: solo si hay stock; nunca se expone el stock exacto", async () => {
    const libre = await admin.createProduct(DELACOUR, { stock: 10, name: "Libre", retailPrice: 1_000 });
    const conStock = await admin.createProduct(DELACOUR, { stock: 10, name: "Con stock", retailPrice: 1_000 });
    const agotado = await admin.createProduct(DELACOUR, { stock: 10, name: "Agotado", retailPrice: 1_000 });
    mem.setStock(libre.id, false, 0);
    mem.setStock(conStock.id, true, 7);
    mem.setStock(agotado.id, true, 0);
    const page = await publico.getCatalog({ slug, context: "retail" });
    const disp = new Map(page?.products.map((p) => [p.name, p.available]));
    assert.deepEqual(Object.fromEntries(disp), { Libre: true, "Con stock": true, Agotado: false });
    assert.equal((await publico.getProduct({ slug, reference: agotado.reference }))?.available, false);
    assert.equal(JSON.stringify(page).includes('"stock"'), false);
  });

  it("estados públicos: Disponible / Últimas unidades / Agotado; lo agotado sigue visible", async () => {
    const mucho = await admin.createProduct(DELACOUR, { stock: 8, name: "Mucho", retailPrice: 1_000 });
    const poco = await admin.createProduct(DELACOUR, { stock: 2, name: "Poco", retailPrice: 1_000 });
    const nada = await admin.createProduct(DELACOUR, { stock: 0, name: "Nada", retailPrice: 1_000 });
    const legado = await admin.createProduct(DELACOUR, { stock: 0, name: "Legado", retailPrice: 1_000 });
    mem.setStock(legado.id, false, 0);
    const page = await publico.getCatalog({ slug, context: "retail" });
    const estados = Object.fromEntries(page!.products.map((p) => [p.name, [p.availability, p.maxQuantity]]));
    assert.deepEqual(estados, { Mucho: ["available", 8], Poco: ["low", 2], Nada: ["sold_out", 0], Legado: ["available", null] });
    const ficha = await publico.getProduct({ slug, reference: nada.reference });
    assert.deepEqual([ficha?.available, ficha?.availability, ficha?.maxQuantity], [false, "sold_out", 0]);
    void mucho;
    void poco;
  });

  it("editar el stock actualiza la disponibilidad sin cambiar la referencia", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 0, name: "Pieza", retailPrice: 1_000 });
    assert.equal((await publico.getProduct({ slug, reference: p.reference }))?.availability, "sold_out");
    const editado = await admin.updateProduct(DELACOUR, p.id, { stock: 5 });
    assert.equal(editado.reference, p.reference);
    assert.equal((await publico.getProduct({ slug, reference: p.reference }))?.availability, "available");
  });
});

describe("resolución de la selección (carrito)", () => {
  it("referencia -> producto real -> precio vigente; desconocidas e inactivas se informan", async () => {
    const a = await admin.createProduct(DELACOUR, { stock: 10, name: "Anillo", retailPrice: 50_000, wholesalePrice: 30_000 });
    const b = await admin.createProduct(DELACOUR, { stock: 10, name: "Aretes", retailPrice: 40_000 });
    await admin.updateProduct(DELACOUR, b.id, { status: "INACTIVE" });
    await admin.updateProduct(DELACOUR, a.id, { retailPrice: 52_000 });

    const r = await publico.resolveSelection({ slug, references: [a.reference.toLowerCase(), a.reference, b.reference, "DL-999999", "basura"] });
    assert.equal(r?.context, "retail");
    assert.deepEqual(r?.items.map((p) => [p.reference, p.price, p.available]), [[a.reference, 52_000, true]]);
    assert.deepEqual(r?.unknown.sort(), [b.reference, "DL-999999"].sort());
    assert.equal(JSON.stringify(r).includes("30000"), false, "la selección detal nunca lleva el precio mayorista");
  });

  it("aislada por tenant, con tope de referencias y mayorista con token", async () => {
    mem.setProfile(OTRO.tenantId, { name: "Otro", whatsapp: null });
    mem.enableModule(OTRO.tenantId);
    await admin.ensurePublication(OTRO);
    const ajeno = await admin.createProduct(OTRO, { stock: 10, name: "Ajeno", retailPrice: 1 });
    const r = await publico.resolveSelection({ slug, references: [ajeno.reference] });
    assert.deepEqual(r?.items, []);
    assert.equal(await publico.resolveSelection({ slug, references: [], context: "wholesale" }), null);
    const muchas = Array.from({ length: SELECTION_MAX + 20 }, (_, i) => `DL-${String(i + 1).padStart(6, "0")}`);
    assert.equal(normalizeReferences(muchas).length, SELECTION_MAX);
    assert.deepEqual(normalizeReferences([" dl-000184 ", "DL-000184", "nombre", "DL-1"]), ["DL-000184"]);
  });
});

describe("fotos de la galería por la ruta pública", () => {
  it("índice 1 = principal, 2.. = galería; fuera de rango => null", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 10, name: "Pieza", retailPrice: 1_000 });
    const principal = await foto(DELACOUR, p.id, true);
    const segunda = await foto(DELACOUR, p.id, false);
    const ref = p.reference.toLowerCase();
    await publico.getImage({ slug, reference: ref, file: { index: 1, variant: "main" } });
    await publico.getImage({ slug, reference: ref, file: { index: 2, variant: "thumb" } });
    assert.deepEqual(mem.opened, [principal.image.path, segunda.thumb.path]);
    assert.equal(await publico.getImage({ slug, reference: ref, file: { index: 3, variant: "main" } }), null);
  });
});

describe("resolución interna determinista (agente / webhook)", () => {
  it("referencia -> ambos precios, inventario, disponibilidad, imagen y estado", async () => {
    const resol = createResolucionCatalogo({ repo: mem.repo });
    const p = await admin.createProduct(DELACOUR, { stock: 10, name: "Dije", retailPrice: 35_000, wholesalePrice: 18_000, color: "Dorado" });
    const t = await foto(DELACOUR, p.id, true);
    mem.setStock(p.id, true, 3);

    const r = await resol.resolverReferencia(DELACOUR.tenantId, ` ${p.reference.toLowerCase()} `);
    assert.deepEqual(
      { ...r, image: r?.image?.storagePath },
      {
        reference: p.reference,
        name: "Dije",
        description: null,
        categoryId: null,
        categoryName: null,
        material: null,
        color: "Dorado",
        prices: { retail: 35_000, wholesale: 18_000 },
        stock: { tracked: true, units: 3 },
        status: "ACTIVE",
        available: true,
        availability: "low",
        maxQuantity: 3,
        image: t.image.path,
      },
    );
  });

  it("nunca por aproximación ni entre negocios; lote en el orden recibido", async () => {
    const resol = createResolucionCatalogo({ repo: mem.repo });
    const a = await admin.createProduct(DELACOUR, { stock: 10, name: "Anillo", retailPrice: 1 });
    const b = await admin.createProduct(DELACOUR, { stock: 10, name: "Aretes", retailPrice: 2 });
    await admin.updateProduct(DELACOUR, b.id, { status: "INACTIVE" });
    assert.equal(await resol.resolverReferencia(DELACOUR.tenantId, "Anillo"), null);
    assert.equal(await resol.resolverReferencia(OTRO.tenantId, a.reference), null);

    const lote = await resol.resolverReferencias(DELACOUR.tenantId, [b.reference, "DL-999999", a.reference, "el anillo", a.reference]);
    assert.deepEqual(
      lote.items.map((i) => [i.reference, i.status, i.available]),
      [
        [b.reference, "INACTIVE", false],
        [a.reference, "ACTIVE", true],
      ],
    );
    assert.deepEqual(lote.unknown, ["DL-999999"]);
    assert.deepEqual(lote.invalid, ["el anillo"]);
  });
});

describe("preparación del pedido (el backend decide)", () => {
  async function tokenMayorista() {
    return (await admin.getPublication(DELACOUR, { includeWholesale: true }))!.wholesalePath!.split("/").pop()!;
  }

  /** Lo que hace la tienda: ver los precios (cotización firmada) y luego pedir. */
  async function pedir(items: OrderItem[], opts: { context?: "retail" | "wholesale"; token?: string } = {}) {
    const vista = await publico.resolveSelection({ slug, references: items.map((i) => i.reference), ...opts });
    return publico.prepareOrder({ slug, items, quote: vista?.quote ?? undefined, requestKey: "clave-de-prueba-0001", ...opts });
  }

  it("pedido válido => ready, con el mensaje armado en el servidor con datos reales", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 5, name: "Dije corazón", retailPrice: 35_000 });
    const r = await pedir([{ reference: p.reference.toLowerCase(), quantity: 2 }]);
    assert.equal(r?.status, "ready");
    assert.deepEqual(r?.order.lines, [{ reference: p.reference, productId: p.id, name: "Dije corazón", quantity: 2, unitPrice: 35_000, subtotal: 70_000 }]);
    const texto = decodeURIComponent((r as { whatsappUrl: string }).whatsappUrl.split("text=")[1]);
    assert.match(texto, new RegExp(`• ${p.reference} · Dije corazón — 2 unidades`));
  });

  it("superar el stock => adjusted, nunca una cantidad imposible ni link de WhatsApp", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 2, name: "Aretes", retailPrice: 42_000 });
    const r = await pedir([{ reference: p.reference, quantity: 5 }]);
    assert.equal(r?.status, "adjusted");
    assert.equal("whatsappUrl" in (r ?? {}), false);
    assert.deepEqual(r?.order.adjustments, [{ kind: "quantity_reduced", reference: p.reference, name: "Aretes", requested: 5, granted: 2 }]);
    assert.deepEqual(r?.selection.items.map((i) => i.maxQuantity), [2]);
  });

  it("stock que baja a 0 después de agregar => adjusted (agotado)", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 3, name: "Anillo", retailPrice: 1_000 });
    await admin.updateProduct(DELACOUR, p.id, { stock: 0 });
    const r = await pedir([{ reference: p.reference, quantity: 1 }]);
    assert.equal(r?.status, "adjusted");
    assert.deepEqual(r?.order.adjustments.map((a) => a.kind), ["sold_out"]);
  });

  it("producto desactivado, inexistente u otro negocio => adjusted (not_found)", async () => {
    mem.setProfile(OTRO.tenantId, { name: "Otro", whatsapp: "573000000000" });
    mem.enableModule(OTRO.tenantId);
    await admin.ensurePublication(OTRO);
    // Referencias por negocio: la 3.ª del otro negocio no existe en Delacour (que solo tiene una).
    await admin.createProduct(OTRO, { stock: 10, name: "Ajeno 1", retailPrice: 1 });
    await admin.createProduct(OTRO, { stock: 10, name: "Ajeno 2", retailPrice: 1 });
    const ajeno = await admin.createProduct(OTRO, { stock: 10, name: "Ajeno", retailPrice: 1 });
    const inactivo = await admin.createProduct(DELACOUR, { stock: 10, name: "Retirado", retailPrice: 1 });
    await admin.updateProduct(DELACOUR, inactivo.id, { status: "INACTIVE" });
    assert.notEqual(ajeno.reference, inactivo.reference);
    const r = await pedir([
      { reference: ajeno.reference, quantity: 1 },
      { reference: inactivo.reference, quantity: 1 },
      { reference: "DL-999999", quantity: 1 },
    ]);
    assert.equal(r?.status, "adjusted");
    assert.deepEqual(r?.order.lines, []);
    assert.deepEqual(
      r?.order.adjustments.map((a) => [a.kind, a.reference]),
      [
        ["not_found", ajeno.reference],
        ["not_found", inactivo.reference],
        ["not_found", "DL-999999"],
      ],
    );
  });

  it("precio cambiado después de que el cliente lo vio => adjusted (price_changed); al confirmar, el precio vigente", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 5, name: "Pulsera", retailPrice: 20_000 });
    const items = [{ reference: p.reference, quantity: 2 }];
    const vista = await publico.resolveSelection({ slug, references: [p.reference] });
    await admin.updateProduct(DELACOUR, p.id, { retailPrice: 25_000 });
    const r = await publico.prepareOrder({ slug, items, quote: vista!.quote! });
    assert.equal(r?.status, "adjusted");
    assert.deepEqual(r?.order.adjustments, [{ kind: "price_changed", reference: p.reference, name: "Pulsera", before: 20_000, after: 25_000 }]);
    assert.equal("whatsappUrl" in (r ?? {}), false, "no se abre WhatsApp con un precio que el cliente no vio");
    const ok = await publico.prepareOrder({ slug, items, quote: r!.selection.quote! });
    assert.equal(ok?.status, "ready");
    assert.equal(ok?.order.total, 50_000);
  });

  it("sin WhatsApp configurado => no_whatsapp (sin link)", async () => {
    mem.setProfile(DELACOUR.tenantId, { name: "Delacour Joyería", whatsapp: null });
    const p = await admin.createProduct(DELACOUR, { stock: 5, name: "Dije", retailPrice: 1_000 });
    const r = await pedir([{ reference: p.reference, quantity: 1 }]);
    assert.equal(r?.status, "no_whatsapp");
    assert.equal("whatsappUrl" in (r ?? {}), false);
  });

  it("mayorista solo con el token exacto, con el precio mayorista", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 5, name: "Dije", retailPrice: 35_000, wholesalePrice: 18_000 });
    const items = [{ reference: p.reference, quantity: 1 }];
    assert.equal(await publico.prepareOrder({ slug, items, context: "wholesale" }), null);
    assert.equal(await publico.prepareOrder({ slug, items, context: "wholesale", token: "x".repeat(32) }), null);
    const r = await pedir(items, { context: "wholesale", token: await tokenMayorista() });
    assert.equal(r?.status, "ready");
    assert.equal(r?.order.total, 18_000);
    assert.match(decodeURIComponent((r as { whatsappUrl: string }).whatsappUrl), /precio mayorista/);
  });

  it("catálogo no publicado => null", async () => {
    const p = await admin.createProduct(DELACOUR, { stock: 5, name: "Dije", retailPrice: 1_000 });
    mem.setPublished(DELACOUR.tenantId, false);
    assert.equal(await publico.prepareOrder({ slug, items: [{ reference: p.reference, quantity: 1 }] }), null);
  });
});
