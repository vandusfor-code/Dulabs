/**
 * Bloque 15 — búsqueda de la TIENDA PÚBLICA (detal y mayor) con la búsqueda real del catálogo.
 *
 * Antes: la tienda buscaba la frase completa dentro del nombre o la referencia, así que
 * "aretes oro" o "corazon" (sin tilde) no encontraban nada. Ahora usa la misma búsqueda de
 * texto completo del agente (dulabs_catalogo_buscar: sin tildes, plurales, varias palabras,
 * categoría/material/color/descripción), con los mismos topes de la BD.
 *
 * El repositorio en memoria emula la función SQL (su prueba con ~2.000 productos está en
 * supabase/tests/20261111000000_dulabs_catalogo_busqueda.test.sql). Nada toca Supabase.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { parseOrderMessage } from "@/lib/catalogo/pedido";
import { parseWhatsappOrderText } from "@/lib/catalogo/pedidos/whatsapp";
import { PUBLIC_PAGE_SIZE, PUBLIC_SEARCH_MAX_RESULTS, PUBLIC_SEARCH_PAGE_SIZE } from "@/lib/catalogo/publicacion";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let publico: ReturnType<typeof createPublicCatalogService>;
let slugA: string;

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  let n = 0;
  admin = createCatalogService({ repo: mem.repo, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  publico = createPublicCatalogService({ repo: mem.repo });
  for (const actor of [A, B]) {
    mem.enableModule(actor.tenantId);
    mem.setProfile(actor.tenantId, { name: `Negocio ${actor.userId}`, whatsapp: "573001112233" });
  }
  slugA = (await admin.ensurePublication(A)).slug;
  await admin.ensurePublication(B);
});

const buscar = (q: string, extra: { page?: number; categoryId?: string } = {}) => publico.getCatalog({ slug: slugA, context: "retail", q, ...extra });
const nombres = (page: Awaited<ReturnType<typeof buscar>>) => page!.products.map((p) => p.name);

describe("tienda pública: búsqueda por texto", () => {
  it("encuentra por palabras sueltas, sin tildes ni plurales, en nombre, categoría y material", async () => {
    const aretes = await admin.createCategory(A, { name: "Aretes" });
    await admin.createProduct(A, { stock: 5, name: "Luna", retailPrice: 90_000, material: "Oro laminado", categoryId: aretes.id });
    await admin.createProduct(A, { stock: 5, name: "Dije Corazón", retailPrice: 50_000, material: "Plata" });
    await admin.createProduct(A, { stock: 5, name: "Anillo Sol", retailPrice: 70_000, material: "Plata" });

    assert.deepEqual(nombres(await buscar("aretes oro")), ["Luna"], "categoría + material (la frase completa no está en ningún nombre)");
    assert.deepEqual(nombres(await buscar("arete")), ["Luna"], "singular / plural");
    assert.deepEqual(nombres(await buscar("corazon")), ["Dije Corazón"], "sin tilde");
    const plata = await buscar("plata");
    assert.deepEqual(nombres(plata).sort(), ["Anillo Sol", "Dije Corazón"]);
    assert.equal(plata!.pageSize, PUBLIC_SEARCH_PAGE_SIZE);
    assert.deepEqual(plata!.search, { relaxed: false, capped: false });
    assert.equal(mem.searchCalls.at(-1)?.mode, "all");
  });

  it("más relevante primero: el nombre pesa más que la descripción", async () => {
    await admin.createProduct(A, { stock: 5, name: "Cadena fina", retailPrice: 40_000, description: "Combina con un dije de estrella" });
    await admin.createProduct(A, { stock: 5, name: "Dije estrella", retailPrice: 40_000 });
    assert.deepEqual(nombres(await buscar("estrella")), ["Dije estrella", "Cadena fina"]);
  });

  it("solo productos ACTIVOS de ESTE negocio (el otro negocio nunca aparece)", async () => {
    await admin.createProduct(A, { stock: 5, name: "Pulsera Luna", retailPrice: 30_000 });
    const off = await admin.createProduct(A, { stock: 5, name: "Pulsera Retirada", retailPrice: 30_000 });
    await admin.updateProduct(A, off.id, { status: "INACTIVE" });
    await admin.createProduct(B, { stock: 5, name: "Pulsera Ajena", retailPrice: 30_000 });
    assert.deepEqual(nombres(await buscar("pulsera")), ["Pulsera Luna"]);
    assert.ok(mem.searchCalls.every((c) => c.channel === "retail"));
  });

  it("si ningún producto tiene TODAS las palabras, muestra los que tienen alguna y lo avisa", async () => {
    await admin.createProduct(A, { stock: 5, name: "Anillo Sol", retailPrice: 70_000 });
    const r = await buscar("anillo esmeralda");
    assert.deepEqual(nombres(r), ["Anillo Sol"]);
    assert.deepEqual(r!.search, { relaxed: true, capped: false });
    const nada = await buscar("esmeralda");
    assert.equal(nada!.products.length, 0);
    assert.deepEqual(nada!.search, { relaxed: false, capped: false }, "una sola palabra sin resultados: no se inventan parecidos");
  });

  it("filtra por la categoría elegida", async () => {
    const aretes = await admin.createCategory(A, { name: "Aretes" });
    const anillos = await admin.createCategory(A, { name: "Anillos" });
    await admin.createProduct(A, { stock: 5, name: "Luna dorada", retailPrice: 1_000, categoryId: aretes.id });
    await admin.createProduct(A, { stock: 5, name: "Luna plateada", retailPrice: 1_000, categoryId: anillos.id });
    assert.deepEqual(nombres(await buscar("luna", { categoryId: anillos.id })), ["Luna plateada"]);
  });
});

describe("tienda pública: referencias", () => {
  it("una referencia completa (con o sin guion, en minúsculas) lleva a ESE producto; retirado u otra categoría => nada", async () => {
    const cat = await admin.createCategory(A, { name: "Dijes" });
    const p = await admin.createProduct(A, { stock: 5, name: "Dije Luna", retailPrice: 10_000, categoryId: cat.id });
    await admin.createProduct(A, { stock: 5, name: `Otro ${p.reference}`, retailPrice: 10_000 });
    const digits = p.reference.split("-")[1];
    for (const q of [p.reference, p.reference.toLowerCase(), `dl${digits}`, `DL ${digits}`]) {
      const r = await buscar(q);
      assert.deepEqual(r!.products.map((x) => x.reference), [p.reference], q);
      assert.equal(r!.pageCount, 1);
    }
    const otraCat = await admin.createCategory(A, { name: "Aretes" });
    assert.equal((await buscar(p.reference, { categoryId: otraCat.id }))!.products.length, 0);
    await admin.updateProduct(A, p.id, { status: "INACTIVE" });
    assert.equal((await buscar(p.reference))!.products.length, 0);
  });

  it("un fragmento de referencia (\"000002\") busca en las referencias", async () => {
    await admin.createProduct(A, { stock: 5, name: "Uno", retailPrice: 1_000 });
    const dos = await admin.createProduct(A, { stock: 5, name: "Dos", retailPrice: 1_000 });
    const frag = dos.reference.split("-")[1];
    assert.deepEqual((await buscar(frag))!.products.map((p) => p.reference), [dos.reference]);
    assert.equal(mem.searchCalls.length, 0, "no pasa por la búsqueda de texto");
  });

  it("la referencia de OTRO negocio no se encuentra", async () => {
    const ajeno = await admin.createProduct(B, { stock: 5, name: "Ajeno", retailPrice: 1_000 });
    const propio = await admin.createProduct(A, { stock: 5, name: "Propio", retailPrice: 1_000 });
    if (ajeno.reference !== propio.reference) assert.equal((await buscar(ajeno.reference))!.products.length, 0);
    assert.ok((await buscar(propio.reference))!.products.every((p) => p.name === "Propio"));
  });
});

describe("tienda pública: paginación de la búsqueda con miles de productos", () => {
  it("250 coincidencias: páginas de 20 sin repetir, tope de 220 (11 páginas) y aviso para afinar", async () => {
    for (let i = 0; i < 250; i++) await admin.createProduct(A, { stock: 5, name: `Aro ${i}`, retailPrice: 1_000 + i });
    const p1 = await buscar("aro");
    assert.equal(p1!.products.length, PUBLIC_SEARCH_PAGE_SIZE);
    assert.equal(p1!.total, 250);
    assert.equal(p1!.pageCount, PUBLIC_SEARCH_MAX_RESULTS / PUBLIC_SEARCH_PAGE_SIZE);
    assert.deepEqual(p1!.search, { relaxed: false, capped: true });

    const vistos = new Set<string>();
    for (let page = 1; page <= p1!.pageCount; page++) for (const p of (await buscar("aro", { page }))!.products) vistos.add(p.reference);
    assert.equal(vistos.size, PUBLIC_SEARCH_MAX_RESULTS, "11 páginas distintas");

    const fuera = await buscar("aro", { page: 40 });
    assert.equal(fuera!.page, 11, "una página fuera del tope se lleva a la última navegable");
    assert.equal(fuera!.products.length, PUBLIC_SEARCH_PAGE_SIZE);
    assert.ok(mem.searchCalls.every((c) => c.offset <= 200 && c.limit <= 20), "nunca pide fuera de los topes de la función SQL");
  });

  it("una página de más (sin resultados) mantiene el total real y no se vuelve 'parecidos'", async () => {
    for (let i = 0; i < 25; i++) await admin.createProduct(A, { stock: 5, name: `Aro fino ${i}`, retailPrice: 1_000 });
    await admin.createProduct(A, { stock: 5, name: "Aro grueso", retailPrice: 1_000 });
    const r = await buscar("aro fino", { page: 3 });
    assert.equal(r!.products.length, 0);
    assert.equal(r!.total, 25);
    assert.equal(r!.pageCount, 2);
    assert.deepEqual(r!.search, { relaxed: false, capped: false });
  });

  it("la búsqueda amplia también pagina (página 2 de 'parecidos')", async () => {
    for (let i = 0; i < 30; i++) await admin.createProduct(A, { stock: 5, name: `Anillo ${i}`, retailPrice: 1_000 });
    const r = await buscar("anillo zafiro", { page: 2 });
    assert.equal(r!.products.length, 10);
    assert.equal(r!.total, 30);
    assert.deepEqual(r!.search, { relaxed: true, capped: false });
  });

  it("sin texto: el listado de siempre (48 por página, más recientes)", async () => {
    for (let i = 0; i < 50; i++) await admin.createProduct(A, { stock: 5, name: `Pieza ${i}`, retailPrice: 1_000 });
    const r = await publico.getCatalog({ slug: slugA, context: "retail" });
    assert.equal(r!.pageSize, PUBLIC_PAGE_SIZE);
    assert.equal(r!.pageCount, 2);
    assert.equal(r!.search, undefined);
    assert.equal(mem.searchCalls.length, 0);
  });
});

describe("tienda pública: canal y respaldo", () => {
  it("la tienda mayorista busca con el canal mayorista y muestra el precio mayor", async () => {
    await admin.createProduct(A, { stock: 5, name: "Dije Luna", retailPrice: 35_000, wholesalePrice: 18_000 });
    const token = (await admin.getPublication(A, { includeWholesale: true }))!.wholesalePath!.split("/").pop()!;
    const r = await publico.getCatalog({ slug: slugA, context: "wholesale", token, q: "luna" });
    assert.equal(r!.products[0].price, 18_000);
    assert.equal(mem.searchCalls.at(-1)?.channel, "wholesale");
    assert.equal(await publico.getCatalog({ slug: slugA, context: "wholesale", token: "0".repeat(64), q: "luna" }), null, "sin token exacto: 404");
  });

  it("sin la migración de búsqueda: la búsqueda anterior, sin romper la tienda", async () => {
    await admin.createProduct(A, { stock: 5, name: "Dije Luna", retailPrice: 35_000 });
    mem.setSearchEnabled(false);
    const r = await buscar("luna");
    assert.deepEqual(nombres(r), ["Dije Luna"]);
    assert.equal(r!.pageSize, PUBLIC_PAGE_SIZE);
    assert.equal(r!.search, undefined);
  });
});

describe("mensaje de pedido: formato corto '• DL-000184 — 2 unidades'", () => {
  const texto = ["Hola, quiero este pedido:", "", "• DL-000184 — 2 unidades", "• DL-000185 — 1 unidad", "• dl-000186 – 3 unidades"].join("\n");

  it("el intake de WhatsApp reconstruye referencias y cantidades exactas", () => {
    const r = parseWhatsappOrderText(texto)!;
    assert.deepEqual(r.items, [
      { reference: "DL-000184", quantity: 2 },
      { reference: "DL-000185", quantity: 1 },
      { reference: "DL-000186", quantity: 3 },
    ]);
    assert.deepEqual(r.invalid, []);
    assert.equal(r.claimsWholesale, false);
  });

  it("el lector del catálogo también (y sin inventar líneas)", () => {
    assert.deepEqual(parseOrderMessage("• DL-000184 — 2 unidades\n• DL-000185 — 1 unidad").items, [
      { reference: "DL-000184", quantity: 2 },
      { reference: "DL-000185", quantity: 1 },
    ]);
    assert.deepEqual(parseWhatsappOrderText("• DL-000184 — muchas")!.invalid, [{ reference: "DL-000184", reason: "unreadable" }]);
    assert.deepEqual(parseWhatsappOrderText("• DL-000184 — 0 unidades")!.invalid, [{ reference: "DL-000184", reason: "out_of_range" }]);
  });
});
