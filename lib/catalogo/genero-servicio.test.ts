/**
 * Hombre / Mujer (Delacour · Vértice) sobre el servicio REAL con el repositorio en memoria (sin red ni base de datos; negocios FICTICIOS):
 *   - tienda pública: el listado de siempre es el de MUJER, `?genero=hombre` el de hombre, las opciones de los filtros se cuentan dentro del lado, la búsqueda es de toda la tienda, el inicio de
 *     siempre no se llena de piezas de hombre y el marco recibe las referencias de hombre;
 *   - panel: cada pieza dice para quién es, se filtra y se marca por la API del catálogo, y sin la migración (o en un negocio sin separación) todo queda EXACTAMENTE como antes.
 * Lo que no se debe romper: sin separación (otros negocios, migración pendiente, ninguna pieza de hombre) el servicio ni siquiera lee las piezas de hombre y el listado es el de siempre.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { SIN_FILTROS, type FiltrosCatalogo } from "@/lib/catalogo/filtros";
import { PUBLIC_PAGE_SIZE } from "@/lib/catalogo/publicacion";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { CatalogError } from "@/lib/catalogo/errors";
import { productListQuerySchema } from "@/lib/catalogo/domain";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const LINEAS = storefrontConfigFor("delacour").joyeria!.lineas!.lineas;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let publico: ReturnType<typeof createPublicCatalogService>;
let slugA: string;
let slugB: string;
let anillos: string;
let dijes: string;

const f = (over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({ ...SIN_FILTROS, ...over });
const nuevo = (actor: CatalogActor, name: string, over: { material?: string; color?: string; categoryId?: string; retail?: number; gender?: "mujer" | "hombre" } = {}) =>
  admin.createProduct(actor, { name, retailPrice: over.retail ?? 15_000, wholesalePrice: null, stock: 10, material: over.material, color: over.color, categoryId: over.categoryId, gender: over.gender });
const catalogo = (filters: FiltrosCatalogo | undefined, opciones: { separar?: boolean; page?: number; q?: string; facets?: boolean; slug?: string; categoryId?: string } = {}) =>
  publico.getCatalog({
    slug: opciones.slug ?? slugA,
    context: "retail",
    page: opciones.page,
    q: opciones.q,
    categoryId: opciones.categoryId,
    ...(filters ? { filters } : {}),
    ...(opciones.facets ? { facets: true } : {}),
    ...(opciones.separar === false ? {} : { separarGenero: true }),
    lineas: LINEAS,
  });
const nombres = async (filters: FiltrosCatalogo | undefined, opciones: Parameters<typeof catalogo>[1] = {}) => (await catalogo(filters, opciones))!.products.map((p) => p.name).sort();

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  publico = createPublicCatalogService({ repo: mem.repo });
  // El negocio A se llama «Delacour»: su tienda es la de la configuración real (slug «delacour»), que SÍ separa hombre y mujer. El B es otro negocio, sin separación.
  mem.setProfile(A.tenantId, { name: "Delacour", whatsapp: "573001112233" });
  mem.setProfile(B.tenantId, { name: "Otra Joyería", whatsapp: "573009998877" });
  for (const actor of [A, B]) mem.enableModule(actor.tenantId);
  slugA = (await admin.ensurePublication(A)).slug;
  slugB = (await admin.ensurePublication(B)).slug;
  anillos = (await admin.createCategory(A, { name: "Anillos" })).id;
  dijes = (await admin.createCategory(A, { name: "Dijes" })).id;
});

/** Piezas de mujer (casi todo Rodio) y unas de hombre (dijes de acero, como Vértice). */
async function sembrar() {
  await nuevo(A, "Anillo rodio", { material: "Rodio", color: "Dorado", categoryId: anillos });
  await nuevo(A, "Anillo plata", { material: "Plata 925", color: "Plateado", categoryId: anillos });
  await nuevo(A, "Dije corazón", { material: "Rodio", color: "Dorado", categoryId: dijes });
  const sanBenito = await nuevo(A, "San Benito · 2511151", { material: "Acero", color: "Negro", categoryId: dijes, retail: 10_000 });
  const cruz = await nuevo(A, "Cruz plana · 2511158", { material: "Acero", categoryId: dijes, retail: 12_000 });
  const anillo = await nuevo(A, "Anillo hombre acero", { material: "Acero", categoryId: anillos, retail: 30_000 });
  for (const p of [sanBenito, cruz, anillo]) mem.setGeneroDirecto(p.id, "hombre");
  return { sanBenito, cruz, anillo };
}

describe("tienda pública · el listado de siempre es el de mujer", () => {
  it("sin dirección especial solo salen las piezas de mujer; ?genero=hombre solo las de hombre", async () => {
    await sembrar();
    assert.deepEqual(await nombres(undefined), ["Anillo plata", "Anillo rodio", "Dije corazón"]);
    assert.deepEqual(await nombres(f({ genero: "hombre" })), ["Anillo hombre acero", "Cruz plana · 2511158", "San Benito · 2511151"]);
  });

  it("la categoría sola (la consulta de siempre en la base) tampoco mezcla los dos lados", async () => {
    await sembrar();
    assert.deepEqual(await nombres(undefined, { categoryId: dijes }), ["Dije corazón"], "Dijes de mujer");
    assert.deepEqual(await nombres(f({ genero: "hombre", categorias: [dijes] })), ["Cruz plana · 2511158", "San Benito · 2511151"], "Dijes de hombre");
    assert.deepEqual(await nombres(f({ categorias: [dijes] })), ["Dije corazón"]);
  });

  it("las líneas se combinan con el lado: Acero de hombre, y el Acero de mujer no trae piezas de hombre", async () => {
    await sembrar();
    assert.deepEqual(await nombres(f({ genero: "hombre", lineas: ["acero"] })), ["Anillo hombre acero", "Cruz plana · 2511158", "San Benito · 2511151"]);
    assert.deepEqual(await nombres(f({ lineas: ["acero"] })), [], "ninguna pieza de mujer es de Acero");
    assert.deepEqual(await nombres(f({ genero: "hombre", lineas: ["plata"] })), []);
  });

  it("pagina el lado de mujer igual que siempre (48 por página) sin colar piezas de hombre", async () => {
    for (let i = 0; i < PUBLIC_PAGE_SIZE + 2; i++) await nuevo(A, `Pieza ${String(i).padStart(3, "0")}`);
    const h = await nuevo(A, "Pieza de hombre");
    mem.setGeneroDirecto(h.id, "hombre");
    const p1 = (await catalogo(undefined))!;
    assert.equal(p1.total, PUBLIC_PAGE_SIZE + 2);
    assert.equal(p1.products.length, PUBLIC_PAGE_SIZE);
    assert.equal(p1.pageCount, 2);
    const p2 = (await catalogo(undefined, { page: 2 }))!;
    assert.equal(p2.products.length, 2);
    assert.ok([...p1.products, ...p2.products].every((p) => p.name !== "Pieza de hombre"));
  });

  it("la búsqueda por texto es de TODA la tienda: encuentra piezas de los dos lados", async () => {
    await sembrar();
    const lectura = mem.hombreReads();
    const r = (await catalogo(undefined, { q: "anillo" }))!;
    assert.deepEqual(r.products.map((p) => p.name).sort(), ["Anillo hombre acero", "Anillo plata", "Anillo rodio"]);
    assert.equal(mem.hombreReads(), lectura, "con búsqueda ni se mira quién es de hombre");
  });

  it("una pieza de hombre desactivada no cuenta; una de mujer sigue donde estaba", async () => {
    const { sanBenito } = await sembrar();
    await admin.updateProduct(A, sanBenito.id, { status: "INACTIVE" });
    assert.deepEqual(await nombres(f({ genero: "hombre" })), ["Anillo hombre acero", "Cruz plana · 2511158"]);
    assert.equal((await publico.getStorefront(slugA, { separarGenero: true }))!.genero!.hombres.length, 2);
  });
});

describe("tienda pública · las opciones de los filtros se cuentan dentro del lado", () => {
  it("el lado de mujer no ofrece los colores ni los materiales del de hombre, y al revés", async () => {
    await sembrar();
    const mujer = (await catalogo(undefined, { facets: true }))!.facets!;
    assert.equal(mujer.total, 3);
    assert.deepEqual(mujer.colores.map((c) => c.etiqueta), ["Dorado", "Plateado"]);
    assert.deepEqual(mujer.categorias.map((c) => [c.nombre, c.n]), [["Anillos", 2], ["Dijes", 1]]);
    assert.deepEqual(mujer.materiales.map((m) => m.etiqueta).sort(), ["Plata 925", "Rodio"]);

    const hombre = (await catalogo(f({ genero: "hombre" }), { facets: true }))!.facets!;
    assert.equal(hombre.total, 3);
    assert.deepEqual(hombre.colores.map((c) => c.etiqueta), ["Negro"]);
    assert.deepEqual(hombre.categorias.map((c) => [c.nombre, c.n]), [["Anillos", 1], ["Dijes", 2]]);
    assert.deepEqual(hombre.materiales.map((m) => m.etiqueta), ["Acero"]);
    assert.deepEqual(hombre.precio, { min: 10_000, max: 30_000 }, "el rango de precio también es del lado");
    assert.equal(hombre.lineas!.find((l) => l.clave === "acero")!.n, 3, "las líneas se cuentan en el lado");
    assert.equal(mujer.lineas!.find((l) => l.clave === "acero")!.n, 0);
  });

  it("el color, el material y el precio filtran dentro del lado elegido", async () => {
    await sembrar();
    assert.deepEqual(await nombres(f({ genero: "hombre", colores: ["negr"] })), ["San Benito · 2511151"]);
    assert.deepEqual(await nombres(f({ genero: "hombre", precioMax: 11_000 })), ["San Benito · 2511151"]);
    assert.deepEqual(await nombres(f({ colores: ["negr"] })), [], "el Negro es de hombre: la tienda de mujer no lo trae");
  });
});

describe("tienda pública · sin separación todo es como siempre", () => {
  it("un negocio que no la pidió: ?genero= se ignora, ninguna pieza se oculta y ni siquiera se leen las de hombre", async () => {
    await sembrar();
    const lecturas = mem.hombreReads();
    const todo = ["Anillo hombre acero", "Anillo plata", "Anillo rodio", "Cruz plana · 2511158", "Dije corazón", "San Benito · 2511151"];
    assert.deepEqual(await nombres(undefined, { separar: false }), todo);
    assert.deepEqual(await nombres(f({ genero: "hombre" }), { separar: false }), todo, "una dirección con ?genero=hombre en una tienda sin separación se ignora");
    assert.equal((await catalogo(undefined, { separar: false, facets: true }))!.facets!.total, 6);
    assert.equal(mem.hombreReads(), lecturas, "cero lecturas de piezas de hombre");
    assert.equal((await publico.getStorefront(slugA))!.genero, undefined);
  });

  it("separación pedida pero todavía ninguna pieza de hombre: el listado es el de siempre y ?genero=hombre no deja la lista vacía", async () => {
    await nuevo(A, "Anillo uno");
    await nuevo(A, "Anillo dos");
    assert.deepEqual(await nombres(undefined), ["Anillo dos", "Anillo uno"]);
    assert.deepEqual(await nombres(f({ genero: "hombre" })), ["Anillo dos", "Anillo uno"]);
    assert.equal((await publico.getStorefront(slugA, { separarGenero: true }))!.genero, undefined, "sin piezas de hombre no hay selector");
  });

  it("la migración sin aplicar: ni errores ni cambios (la tienda se ve como antes)", async () => {
    await sembrar();
    mem.setGeneroEnabled(false);
    assert.equal((await catalogo(undefined))!.total, 6);
    assert.equal((await catalogo(f({ genero: "hombre" })))!.total, 6);
    assert.equal((await publico.getStorefront(slugA, { separarGenero: true }))!.genero, undefined);
    const inicio = (await publico.getHome(slugA, { separarGenero: true }))!;
    assert.equal(inicio.hombre, undefined);
  });

  it("el catálogo MAYORISTA no se separa: la consulta de la tienda al detal sí, la del mayor no", async () => {
    const { consultaDeCatalogoPublico } = await import("@/lib/catalogo/consulta-publica");
    const base = { slug: "delacour", token: undefined, q: undefined, categoria: undefined, pagina: 1 };
    assert.equal(consultaDeCatalogoPublico({ ...base, context: "retail" }).separarGenero, true);
    assert.equal(consultaDeCatalogoPublico({ ...base, context: "wholesale" }).separarGenero, undefined);
    assert.equal(consultaDeCatalogoPublico({ ...base, slug: "otra-tienda", context: "retail" }).separarGenero, undefined, "otros negocios no tienen separación");
  });
});

describe("tienda pública · el marco y el inicio", () => {
  it("el marco recibe las referencias de hombre (activas), ordenadas", async () => {
    const { sanBenito, cruz, anillo } = await sembrar();
    const tienda = (await publico.getStorefront(slugA, { separarGenero: true }))!;
    assert.deepEqual(tienda.genero, { hombres: [anillo.reference, cruz.reference, sanBenito.reference].sort() });
  });

  it("el inicio de siempre es de mujer: novedades y portadas sin piezas de hombre, y las de hombre van aparte", async () => {
    await sembrar();
    for (const p of (await admin.listProducts(A, { q: undefined, status: "ALL", page: 1, pageSize: 48 })).items) {
      await mem.repo.attachMedia(A.tenantId, A.userId, { productId: p.id, storagePath: `${A.tenantId}/${p.id}/x.webp`, thumbPath: null, mimeType: "image/webp", bytes: 10, width: 10, height: 10, makePrimary: true });
    }
    const inicio = (await publico.getHome(slugA, { separarGenero: true }))!;
    const destacados = inicio.featured.map((p) => p.name).sort();
    assert.deepEqual(destacados, ["Anillo plata", "Anillo rodio", "Dije corazón"]);
    assert.equal(inicio.hombre!.total, 3);
    assert.deepEqual(inicio.hombre!.items.map((p) => p.name).sort(), ["Anillo hombre acero", "Cruz plana · 2511158", "San Benito · 2511151"]);
    // Sin separación el inicio es el de siempre: todo mezclado y sin bloque de hombre.
    const igual = (await publico.getHome(slugA))!;
    assert.equal(igual.featured.length, 6);
    assert.equal(igual.hombre, undefined);
  });

  it("lo que la administradora eligió a mano en el CMS no se toca, sea del lado que sea", async () => {
    const { sanBenito } = await sembrar();
    const inicio = (await publico.getHome(slugA, { separarGenero: true, destacadas: [sanBenito.reference] }))!;
    assert.deepEqual(inicio.featured.map((p) => p.name), ["San Benito · 2511151"]);
    assert.equal(inicio.featuredPolicy, "cms");
  });
});

describe("tienda pública · el inicio del lado de hombre (una tienda dentro de la tienda)", () => {
  /** Las piezas de la siembra con una foto principal (lo que usan los destacados y las portadas de categoría). */
  async function conFotos() {
    const piezas = await sembrar();
    for (const p of (await admin.listProducts(A, { q: undefined, status: "ALL", page: 1, pageSize: 48 })).items) {
      await mem.repo.attachMedia(A.tenantId, A.userId, { productId: p.id, storagePath: `${A.tenantId}/${p.id}/x.webp`, thumbPath: null, mimeType: "image/webp", bytes: 10, width: 10, height: 10, makePrimary: true });
    }
    return piezas;
  }
  const inicioHombre = async (over: { destacadas?: readonly string[] } = {}) => (await publico.getHome(slugA, { separarGenero: true, lado: "hombre", ...over }))!;

  it("el inicio de hombre trae SOLO piezas de hombre (destacados) y las categorías que tienen piezas de hombre, con su portada", async () => {
    await conFotos();
    const inicio = await inicioHombre();
    assert.equal(inicio.lado, "hombre");
    assert.deepEqual(inicio.featured.map((p) => p.name).sort(), ["Anillo hombre acero", "Cruz plana · 2511158", "San Benito · 2511151"]);
    assert.equal(inicio.featuredPolicy, "recent-with-photo");
    assert.deepEqual(inicio.categories.map((c) => c.name).sort(), ["Anillos", "Dijes"], "las dos categorías tienen alguna pieza de hombre");
    assert.ok(inicio.categories.every((c) => c.coverUrl), "con la portada de una pieza de hombre");
  });

  it("no lleva la entrada «Para él» (es el inicio de hombre, no una invitación a él)", async () => {
    await conFotos();
    assert.equal((await inicioHombre()).hombre, undefined);
  });

  it("una categoría SIN piezas de hombre no se ofrece (la colección es nueva: nada de categorías vacías)", async () => {
    await conFotos();
    const pulseras = await admin.createCategory(A, { name: "Pulseras" });
    await nuevo(A, "Pulsera de mujer", { material: "Rodio", categoryId: pulseras.id });
    const todas = (await publico.getHome(slugA, { separarGenero: true }))!.categories.map((c) => c.name);
    assert.ok(todas.includes("Pulseras"), "el inicio de mujer sí la ofrece");
    assert.deepEqual((await inicioHombre()).categories.map((c) => c.name).sort(), ["Anillos", "Dijes"]);
  });

  it("lo elegido a mano en el CMS (destacados) se respeta también en el inicio de hombre", async () => {
    const { cruz } = await conFotos();
    const inicio = await inicioHombre({ destacadas: [cruz.reference] });
    assert.deepEqual(inicio.featured.map((p) => p.name), ["Cruz plana · 2511158"]);
    assert.equal(inicio.featuredPolicy, "cms");
  });

  it("el inicio de mujer (sin «lado») no cambia: sigue siendo de mujer, con la entrada «Para él» y sin la marca de lado", async () => {
    await conFotos();
    const inicio = (await publico.getHome(slugA, { separarGenero: true }))!;
    assert.equal(inicio.lado, undefined);
    assert.equal(inicio.hombre!.total, 3);
    assert.deepEqual(inicio.featured.map((p) => p.name).sort(), ["Anillo plata", "Anillo rodio", "Dije corazón"]);
  });

  it("sin separación (otro negocio, migración sin aplicar o sin piezas de hombre) pedir el lado de hombre no cambia nada: es el inicio de siempre", async () => {
    await conFotos();
    // el otro negocio: sin separación
    await admin.createProduct(B, { name: "Anillo B", retailPrice: 10_000, wholesalePrice: null, stock: 1 });
    const b = (await publico.getHome(slugB, { lado: "hombre" }))!;
    assert.equal(b.lado, undefined);
    // la migración sin aplicar
    mem.setGeneroEnabled(false);
    const sinColumna = await inicioHombre();
    assert.equal(sinColumna.lado, undefined);
    assert.equal(sinColumna.featured.length, 6, "todo mezclado, como siempre");
  });
});

describe("panel · cada pieza dice para quién es", () => {
  it("en el negocio con separación la lista y la ficha traen «gender» y la cuenta de piezas de hombre", async () => {
    const { sanBenito } = await sembrar();
    const pagina = await admin.listProducts(A, { q: undefined, status: "ALL", page: 1, pageSize: 48 });
    assert.deepEqual(pagina.genero, { hombres: 3 });
    const porNombre = new Map(pagina.items.map((p) => [p.name, p.gender]));
    assert.equal(porNombre.get("San Benito · 2511151"), "hombre");
    assert.equal(porNombre.get("Anillo rodio"), "mujer");
    assert.equal((await admin.getProduct(A, sanBenito.id)).gender, "hombre");
  });

  it("el filtro «Para» del panel: hombre, mujer y vacío (todas); combinado con la línea y la búsqueda", async () => {
    await sembrar();
    const lista = async (genero: string, extra: Record<string, unknown> = {}) =>
      (await admin.listProducts(A, productListQuerySchema.parse({ genero, ...extra }))).items.map((p) => p.name).sort();
    assert.deepEqual(await lista("hombre"), ["Anillo hombre acero", "Cruz plana · 2511158", "San Benito · 2511151"]);
    assert.deepEqual(await lista("mujer"), ["Anillo plata", "Anillo rodio", "Dije corazón"]);
    assert.equal((await lista("")).length, 6);
    assert.deepEqual(await lista("hombre", { linea: "acero", q: "cruz" }), ["Cruz plana · 2511158"]);
    assert.deepEqual(await lista("mujer", { linea: "acero" }), []);
    assert.equal(productListQuerySchema.safeParse({ genero: "otro" }).success, false, "un valor que no existe se rechaza con un mensaje claro");
  });

  it("un negocio SIN separación ve el panel de siempre: ningún campo nuevo y el filtro se ignora", async () => {
    const x = await nuevo(B, "Anillo B");
    mem.setGeneroDirecto(x.id, "hombre");
    const pagina = await admin.listProducts(B, productListQuerySchema.parse({ genero: "hombre" }));
    assert.equal(pagina.items.length, 1, "el filtro se ignora");
    assert.equal(pagina.items[0].gender, undefined);
    assert.equal(pagina.genero, undefined);
    assert.equal((await admin.getProduct(B, x.id)).gender, undefined);
    await assert.rejects(admin.updateProduct(B, x.id, { gender: "hombre" }), (e) => e instanceof CatalogError && e.code === "FEATURE_UNAVAILABLE");
    assert.notEqual(slugB, "delacour");
  });

  it("con la migración pendiente el panel se ve como siempre (sin «Para»)", async () => {
    await sembrar();
    mem.setGeneroEnabled(false);
    const pagina = await admin.listProducts(A, productListQuerySchema.parse({ genero: "hombre" }));
    assert.equal(pagina.items.length, 6, "el filtro se ignora, no falla");
    assert.equal(pagina.genero, undefined);
    assert.ok(pagina.items.every((p) => p.gender === undefined));
  });
});

describe("panel · marcar para quién es una pieza", () => {
  it("solo «Para»: no toca ningún otro dato y la respuesta ya trae el lado nuevo", async () => {
    const p = await nuevo(A, "Anillo azul", { material: "Rodio", retail: 20_000 });
    const editora: CatalogActor = { tenantId: A.tenantId, userId: "editora-a" };
    const antes = mem.snapshot(A.tenantId).find((x) => x.id === p.id)!;
    const r = await admin.updateProduct(editora, p.id, { gender: "hombre" });
    assert.equal(r.gender, "hombre");
    const despues = mem.snapshot(A.tenantId).find((x) => x.id === p.id)!;
    assert.deepEqual({ ...despues, updatedAt: "", updatedBy: "" }, { ...antes, updatedAt: "", updatedBy: "" }, "nombre, precio, stock, material y estado quedan idénticos");
    assert.equal(mem.generoDe(p.id), "hombre");
    assert.equal(despues.updatedBy, "editora-a", "la auditoría atribuye el cambio a quien lo hizo");
    // De vuelta a mujer.
    assert.equal((await admin.updateProduct(A, p.id, { gender: "mujer" })).gender, "mujer");
    assert.equal(mem.generoDe(p.id), "mujer");
  });

  it("junto con otros campos se guardan todos (un solo guardado del formulario)", async () => {
    const p = await nuevo(A, "Dije luna", { retail: 9_000 });
    const r = await admin.updateProduct(A, p.id, { gender: "hombre", retailPrice: 11_000, name: "Dije luna acero" });
    assert.equal(r.gender, "hombre");
    assert.equal(r.name, "Dije luna acero");
    assert.equal(r.pricing.retail, 11_000);
  });

  it("repetirlo no cambia nada (idempotente) y una pieza que no existe responde «no existe»", async () => {
    const p = await nuevo(A, "Dije sol");
    await admin.updateProduct(A, p.id, { gender: "hombre" });
    const otra = await admin.updateProduct(A, p.id, { gender: "hombre" });
    assert.equal(otra.gender, "hombre");
    await assert.rejects(admin.updateProduct(A, "00000000-0000-4000-8000-000000000999", { gender: "hombre" }), (e) => e instanceof CatalogError && e.code === "NOT_FOUND");
  });

  it("una pieza de otro negocio no se puede marcar", async () => {
    const ajena = await nuevo(B, "Pieza de B");
    await assert.rejects(admin.updateProduct(A, ajena.id, { gender: "hombre" }), (e) => e instanceof CatalogError && e.code === "NOT_FOUND");
    assert.equal(mem.generoDe(ajena.id), "mujer");
  });

  it("sin la migración: error claro ANTES de tocar nada (ni siquiera los otros campos del mismo guardado)", async () => {
    const p = await nuevo(A, "Dije estrella", { retail: 8_000 });
    mem.setGeneroEnabled(false);
    await assert.rejects(admin.updateProduct(A, p.id, { gender: "hombre", retailPrice: 99_000 }), (e) => e instanceof CatalogError && e.code === "FEATURE_UNAVAILABLE" && /Mujer\/Hombre/.test(e.message));
    assert.equal(mem.snapshot(A.tenantId).find((x) => x.id === p.id)!.pricing.retail, 8_000, "el precio no cambió");
  });

  it("crear una pieza de hombre: nace marcada; sin la migración NO se crea", async () => {
    const h = await nuevo(A, "Dije nuevo de hombre", { gender: "hombre" });
    assert.equal(h.gender, "hombre");
    assert.equal(mem.generoDe(h.id), "hombre");
    const m = await nuevo(A, "Dije nuevo de mujer", { gender: "mujer" });
    assert.equal(mem.generoDe(m.id), "mujer");
    mem.setGeneroEnabled(false);
    const antes = mem.snapshot(A.tenantId).length;
    await assert.rejects(nuevo(A, "No debe crearse", { gender: "hombre" }), (e) => e instanceof CatalogError && e.code === "FEATURE_UNAVAILABLE");
    assert.equal(mem.snapshot(A.tenantId).length, antes, "no quedó una pieza a medias");
    // Sin pedir «Para» se crea como siempre aunque la migración falte.
    assert.ok((await nuevo(A, "Pieza normal")).id);
  });

  it("las piezas marcadas aparecen en el lado correcto de la tienda de inmediato", async () => {
    const p = await nuevo(A, "Dije viajero");
    await nuevo(A, "Dije compañero");
    assert.deepEqual(await nombres(undefined), ["Dije compañero", "Dije viajero"], "todavía no hay piezas de hombre: la tienda es la de siempre");
    await admin.updateProduct(A, p.id, { gender: "hombre" });
    assert.deepEqual(await nombres(undefined), ["Dije compañero"], "ya marcada, el lado de mujer no la trae");
    assert.deepEqual(await nombres(f({ genero: "hombre" })), ["Dije viajero"]);
    await admin.updateProduct(A, p.id, { gender: "mujer" });
    assert.deepEqual(await nombres(undefined), ["Dije compañero", "Dije viajero"], "de vuelta a mujer: la separación vuelve a apagarse sola");
  });
});
