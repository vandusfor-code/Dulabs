/**
 * Filtros del catálogo público (servicio REAL sobre el repositorio en memoria, sin red ni base de datos; negocios FICTICIOS): las facetas (opciones con sus conteos y el rango de precio),
 * el listado filtrado (OR dentro de un grupo, AND entre grupos, precio EFECTIVO, paginado igual que siempre) y lo que NO cambia: sin filtros, con una sola categoría o con búsqueda
 * por texto el listado es exactamente el de siempre. Solo lectura: ningún precio, inventario ni dato se escribe.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { FILTRO_LOTE, FILTRO_MAX, createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { SIN_FILTROS, type FiltrosCatalogo } from "@/lib/catalogo/filtros";
import { PUBLIC_PAGE_SIZE } from "@/lib/catalogo/publicacion";
import { conPrecios, type CatalogRepository } from "@/lib/catalogo/repository";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { crearPuertoPreciosCms } from "@/lib/cms-comercial/precios";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { AHORA, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let publico: ReturnType<typeof createPublicCatalogService>;
let slugA: string;
let slugB: string;
let tokenA: string;
let dijes: string;
let aretes: string;
let vacia: string;
const snaps: Record<string, InstantaneaCms | null> = {};

const nuevo = (actor: CatalogActor, name: string, over: { retail?: number; wholesale?: number | null; color?: string; material?: string; categoryId?: string; stock?: number } = {}) =>
  admin.createProduct(actor, { name, retailPrice: over.retail ?? 15_000, wholesalePrice: over.wholesale ?? null, stock: over.stock ?? 10, color: over.color, material: over.material, categoryId: over.categoryId });
const f = (over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({ ...SIN_FILTROS, ...over });
const nombres = async (filters: FiltrosCatalogo, page = 1) => (await publico.getCatalog({ slug: slugA, context: "retail", page, filters }))!.products.map((p) => p.name);
/** Las opciones de los filtros de la tienda A (detal): el listado trae `facets` solo si se piden. */
const facetas = async () => (await publico.getCatalog({ slug: slugA, context: "retail", facets: true }))!.facets!;

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  const puerto = crearPuertoPreciosCms({ cargar: async (tenantId) => snaps[tenantId] ?? null, ahora: () => AHORA });
  publico = createPublicCatalogService({ repo: conPrecios(mem.repo, puerto) });
  for (const k of Object.keys(snaps)) delete snaps[k];
  for (const [actor, nombre] of [[A, "Joyería A"], [B, "Joyería B"]] as const) {
    mem.setProfile(actor.tenantId, { name: nombre, whatsapp: "573001112233" });
    mem.enableModule(actor.tenantId);
  }
  slugA = (await admin.ensurePublication(A)).slug;
  slugB = (await admin.ensurePublication(B)).slug;
  tokenA = (await admin.getPublication(A, { includeWholesale: true }))!.wholesalePath!.split("/").pop()!;
  dijes = (await admin.createCategory(A, { name: "Dije" })).id;
  aretes = (await admin.createCategory(A, { name: "Aretes" })).id;
  vacia = (await admin.createCategory(A, { name: "Vacía" })).id;
});

/** Un catálogo parecido al de Delacour: colores y materiales escritos de varias formas, productos sin color y uno sin precio. */
async function sembrar() {
  await nuevo(A, "Dije Luna", { categoryId: dijes, color: "Dorada", material: "RODIO", retail: 12_000 });
  await nuevo(A, "Dije Sol", { categoryId: dijes, color: "dorado", material: "Rodio", retail: 20_000 });
  await nuevo(A, "Dije Estrella", { categoryId: dijes, color: "Plateada", retail: 6_400 });
  await nuevo(A, "Dije Corazón", { categoryId: dijes, retail: 0 });
  await nuevo(A, "Aretes Perla", { categoryId: aretes, color: "Dorado", material: "Rodio", retail: 44_000 });
  await nuevo(A, "Aretes Aro", { categoryId: aretes, color: "Oro Rosa", retail: 112_000 });
}

describe("opciones de los filtros (facets)", () => {
  it("opciones con sus conteos: solo categorías con productos, colores y materiales agrupados, y el rango de precio sin lo que no tiene precio", async () => {
    await sembrar();
    const fx = await facetas();
    assert.equal(fx.total, 6);
    assert.deepEqual(fx.categorias.map((c) => [c.nombre, c.n]), [["Dije", 4], ["Aretes", 2]], "en el orden del catálogo, no el alfabético");
    assert.deepEqual(fx.colores.map((c) => [c.etiqueta, c.n]), [["Dorado", 3], ["Oro rosa", 1], ["Plateada", 1]]);
    assert.deepEqual(fx.materiales.map((m) => [m.etiqueta, m.n]), [["Rodio", 3]]);
    assert.deepEqual(fx.precio, { min: 6_000, max: 112_000 });
    assert.ok(!fx.categorias.some((c) => c.id === vacia), "una categoría vacía no es una opción");
  });

  it("no cuenta productos desactivados ni de otros negocios, y no toca nada", async () => {
    await sembrar();
    await nuevo(B, "Dije de otro", { color: "Dorada" });
    const inactivo = await nuevo(A, "Dije apagado", { categoryId: dijes, color: "Verde" });
    await admin.updateProduct(A, inactivo.id, { status: "INACTIVE" });
    const antes = JSON.stringify(await mem.repo.listProducts(A.tenantId, { status: "ALL", offset: 0, limit: 100 }));
    const fx = await facetas();
    assert.equal(fx.total, 6);
    assert.ok(!fx.colores.some((c) => c.etiqueta === "Verde"), "un producto desactivado no cuenta");
    assert.equal(fx.colores.find((c) => c.etiqueta === "Dorado")?.n, 3, "el producto de otro negocio no suma");
    assert.equal(JSON.stringify(await mem.repo.listProducts(A.tenantId, { status: "ALL", offset: 0, limit: 100 })), antes, "solo lectura");
    const deB = (await publico.getCatalog({ slug: slugB, context: "retail", facets: true }))!.facets!;
    assert.equal(deB.total, 1);
    assert.deepEqual(deB.colores.map((c) => c.etiqueta), ["Dorada"], "con una sola forma escrita se muestra tal cual");
  });

  it("el precio de las opciones es el EFECTIVO: con una oferta vigente el rango baja", async () => {
    const caro = await nuevo(A, "Dije caro", { retail: 100_000 });
    await nuevo(A, "Dije barato", { retail: 10_000 });
    snaps[A.tenantId] = instantanea({ ofertas: [publicada("amor", oferta({ modalidad: "detal", alcance: { todos: false, referencias: [caro.reference], categorias: [] } }))] });
    assert.deepEqual((await facetas()).precio, { min: 10_000, max: 80_000 });
  });

  it("negocio no publicado, módulo apagado o mayorista sin el token exacto: sin página (404), también al pedir las opciones", async () => {
    await sembrar();
    assert.equal(await publico.getCatalog({ slug: "no-existe-nunca", context: "retail", facets: true }), null);
    assert.equal(await publico.getCatalog({ slug: slugA, context: "wholesale", facets: true }), null);
    assert.equal(await publico.getCatalog({ slug: slugA, context: "wholesale", token: "x".repeat(40), facets: true }), null);
    assert.ok((await publico.getCatalog({ slug: slugA, context: "wholesale", token: tokenA, facets: true }))?.facets);
    mem.setPublished(A.tenantId, false);
    assert.equal(await publico.getCatalog({ slug: slugA, context: "retail", facets: true }), null);
  });

  it("se piden solo cuando se necesitan: sin `facets` la página no las lleva", async () => {
    await sembrar();
    const sin = (await publico.getCatalog({ slug: slugA, context: "retail" }))!;
    assert.equal("facets" in sin, false);
    assert.equal("facets" in (await publico.getCatalog({ slug: slugA, context: "retail", filters: f({ colores: ["dorad"] }) }))!, false);
  });

  it("un catálogo demasiado grande no ofrece opciones (null) en vez de cargarlo entero (con la lectura liviana y con la de productos completos)", async () => {
    await sembrar();
    const grandeLiviano: CatalogRepository = { ...mem.repo, listFilterRows: async () => ({ items: [], total: FILTRO_MAX + 1 }) };
    const grandeCompleto: CatalogRepository = {
      ...mem.repo,
      listFilterRows: undefined,
      listProducts: async (t, filtro) => (filtro.limit === FILTRO_LOTE ? { items: [], total: FILTRO_MAX + 1 } : mem.repo.listProducts(t, filtro)),
    };
    for (const repo of [grandeLiviano, grandeCompleto]) {
      const s = createPublicCatalogService({ repo });
      const conOpciones = (await s.getCatalog({ slug: slugA, context: "retail", facets: true }))!;
      assert.equal(conOpciones.facets, null);
      assert.equal(conOpciones.products.length, 6, "el listado de siempre sigue funcionando");
      // y un enlace con filtros a mano no rompe: solo se respeta la categoría, con el listado de siempre
      const pagina = (await s.getCatalog({ slug: slugA, context: "retail", filters: f({ categorias: [dijes], colores: ["dorad"] }) }))!;
      assert.deepEqual(pagina.products.map((p) => p.name).sort(), ["Dije Corazón", "Dije Estrella", "Dije Luna", "Dije Sol"]);
    }
  });

  it("si la lectura para filtrar falla, la tienda sigue mostrando el listado de siempre (sin opciones) y avisa en el registro; nunca una página de error", async (t) => {
    await sembrar();
    const avisos = t.mock.method(console, "error", () => {});
    const roto: CatalogRepository = { ...mem.repo, listFilterRows: async () => { throw new Error("base de datos caída"); } };
    const s = createPublicCatalogService({ repo: roto });
    const conOpciones = (await s.getCatalog({ slug: slugA, context: "retail", facets: true }))!;
    assert.equal(conOpciones.facets, null);
    assert.equal(conOpciones.products.length, 6);
    const filtrado = (await s.getCatalog({ slug: slugA, context: "retail", filters: f({ colores: ["dorad"] }), facets: true }))!;
    assert.equal(filtrado.facets, null);
    assert.equal(filtrado.products.length, 6, "sin poder filtrar se ve el listado de siempre");
    assert.ok(avisos.mock.calls.length >= 2 && String(avisos.mock.calls[0].arguments[0]).includes("[catalogo/filtros]"));
  });

  it("listar con filtros y contar las opciones comparten UNA sola lectura liviana de los productos activos (menos transferencia desde la base)", async () => {
    await sembrar();
    let livianas = 0;
    let completas = 0;
    const contando: CatalogRepository = {
      ...mem.repo,
      listFilterRows: async (t, pagina) => {
        livianas += 1;
        return mem.repo.listFilterRows!(t, pagina);
      },
      listProducts: async (t, filtro) => {
        if (filtro.limit === FILTRO_LOTE) completas += 1;
        return mem.repo.listProducts(t, filtro);
      },
    };
    const s = createPublicCatalogService({ repo: contando });
    const conTodo = (await s.getCatalog({ slug: slugA, context: "retail", filters: f({ colores: ["dorad"] }), facets: true }))!;
    assert.deepEqual([livianas, completas], [1, 0], "una lectura liviana y ninguna de productos completos");
    assert.equal(conTodo.total, 3);
    assert.equal(conTodo.facets?.total, 6, "las opciones cuentan todo el catálogo, no solo lo filtrado");
    await s.getCatalog({ slug: slugA, context: "retail" });
    assert.deepEqual([livianas, completas], [1, 0], "el listado de siempre no lee todos los productos");
  });

  it("de los productos completos solo se leen los de la página (no todo el catálogo)", async () => {
    for (let i = 1; i <= 60; i++) await nuevo(A, `Dorado ${String(i).padStart(2, "0")}`, { color: "Dorado" });
    let lotes: number[] = [];
    const contando: CatalogRepository = {
      ...mem.repo,
      getProductsByReferences: async (t, refs) => {
        lotes.push(refs.length);
        return mem.repo.getProductsByReferences(t, refs);
      },
    };
    const s = createPublicCatalogService({ repo: contando });
    const p1 = (await s.getCatalog({ slug: slugA, context: "retail", filters: f({ colores: ["dorad"] }), facets: true }))!;
    assert.equal(p1.products.length, PUBLIC_PAGE_SIZE);
    assert.deepEqual(lotes, [PUBLIC_PAGE_SIZE], "una sola petición con las 48 referencias de la página");
    lotes = [];
    const p2 = (await s.getCatalog({ slug: slugA, context: "retail", page: 2, filters: f({ colores: ["dorad"] }) }))!;
    assert.equal(p2.products.length, 12);
    assert.deepEqual(lotes, [12]);
    lotes = [];
    await s.getCatalog({ slug: slugA, context: "retail", filters: f({ colores: ["no-existe"] }) });
    assert.deepEqual(lotes, [], "sin coincidencias no se pide ningún producto completo");
  });

  it("la lectura liviana y la de productos completos dan exactamente lo mismo (página, total y opciones)", async () => {
    await sembrar();
    const completo = createPublicCatalogService({ repo: conPrecios({ ...mem.repo, listFilterRows: undefined }, crearPuertoPreciosCms({ cargar: async (t) => snaps[t] ?? null, ahora: () => AHORA })) });
    for (const filters of [f({ colores: ["dorad"] }), f({ categorias: [dijes, aretes], materiales: ["rodi"] }), f({ precioMin: 12_000, precioMax: 45_000 })]) {
      const a = await publico.getCatalog({ slug: slugA, context: "retail", filters, facets: true });
      const b = await completo.getCatalog({ slug: slugA, context: "retail", filters, facets: true });
      assert.deepEqual(a, b);
    }
  });

  it("un producto que se desactiva entre las dos lecturas simplemente no aparece (nunca se muestra un desactivado)", async () => {
    await sembrar();
    const racing: CatalogRepository = {
      ...mem.repo,
      getProductsByReferences: async (t, refs) => (await mem.repo.getProductsByReferences(t, refs)).map((p) => (p.name === "Dije Sol" ? { ...p, status: "INACTIVE" as const } : p)),
    };
    const s = createPublicCatalogService({ repo: racing });
    const r = (await s.getCatalog({ slug: slugA, context: "retail", filters: f({ colores: ["dorad"] }) }))!;
    assert.deepEqual(r.products.map((p) => p.name).sort(), ["Aretes Perla", "Dije Luna"]);
  });
});

describe("listado filtrado", () => {
  it("color: «Dorada», «dorado» y «Dorado» son uno solo; dentro de un grupo basta con uno de los valores", async () => {
    await sembrar();
    assert.deepEqual((await nombres(f({ colores: ["dorad"] }))).sort(), ["Aretes Perla", "Dije Luna", "Dije Sol"]);
    assert.deepEqual((await nombres(f({ colores: ["dorad", "platead"] }))).sort(), ["Aretes Perla", "Dije Estrella", "Dije Luna", "Dije Sol"]);
  });

  it("entre grupos deben cumplirse todos: categoría + color + material + precio", async () => {
    await sembrar();
    assert.deepEqual(await nombres(f({ categorias: [dijes], colores: ["dorad"] })).then((n) => n.sort()), ["Dije Luna", "Dije Sol"]);
    assert.deepEqual(await nombres(f({ categorias: [dijes, aretes], colores: ["dorad"], materiales: ["rodi"] })).then((n) => n.sort()), ["Aretes Perla", "Dije Luna", "Dije Sol"]);
    assert.deepEqual(await nombres(f({ colores: ["dorad"], materiales: ["rodi"], precioMin: 15_000, precioMax: 30_000 })), ["Dije Sol"]);
    assert.deepEqual(await nombres(f({ categorias: [aretes], colores: ["platead"] })), []);
  });

  it("precio: extremos incluidos, y un producto sin precio (0) queda fuera de cualquier rango", async () => {
    await sembrar();
    assert.deepEqual((await nombres(f({ precioMin: 12_000, precioMax: 20_000 }))).sort(), ["Dije Luna", "Dije Sol"]);
    assert.deepEqual(await nombres(f({ precioMax: 6_400 })), ["Dije Estrella"]);
    assert.ok(!(await nombres(f({ precioMin: 1 }))).includes("Dije Corazón"));
  });

  it("el rango usa el precio EFECTIVO (con oferta) y el mayorista usa el suyo", async () => {
    const con = await nuevo(A, "Con oferta", { retail: 100_000, wholesale: 70_000 });
    await nuevo(A, "Sin oferta", { retail: 90_000, wholesale: 60_000 });
    snaps[A.tenantId] = instantanea({ ofertas: [publicada("amor", oferta({ modalidad: "detal", alcance: { todos: false, referencias: [con.reference], categorias: [] } }))] });
    assert.deepEqual(await nombres(f({ precioMax: 85_000 })), ["Con oferta"], "100.000 con 20 % queda en 80.000");
    assert.deepEqual(await nombres(f({ precioMin: 95_000 })), []);
    const may = await publico.getCatalog({ slug: slugA, context: "wholesale", token: tokenA, filters: f({ precioMin: 65_000 }) });
    assert.deepEqual(may!.products.map((p) => p.name), ["Con oferta"], "el detal nunca decide el filtro del mayorista");
  });

  it("pagina de 48 en 48, con los más recientes primero, y el total y el número de páginas son los del filtro", async () => {
    for (let i = 1; i <= 60; i++) await nuevo(A, `Dorado ${String(i).padStart(2, "0")}`, { color: "Dorado" });
    for (let i = 1; i <= 5; i++) await nuevo(A, `Plateado ${i}`, { color: "Plateado" });
    const p1 = (await publico.getCatalog({ slug: slugA, context: "retail", page: 1, filters: f({ colores: ["dorad"] }) }))!;
    assert.equal(p1.total, 60);
    assert.equal(p1.pageCount, 2);
    assert.equal(p1.pageSize, PUBLIC_PAGE_SIZE);
    assert.equal(p1.products.length, PUBLIC_PAGE_SIZE);
    assert.equal(p1.products[0].name, "Dorado 60", "el más reciente primero");
    const p2 = (await publico.getCatalog({ slug: slugA, context: "retail", page: 2, filters: f({ colores: ["dorad"] }) }))!;
    assert.equal(p2.products.length, 12);
    assert.equal(p2.products.at(-1)?.name, "Dorado 01");
    const fuera = (await publico.getCatalog({ slug: slugA, context: "retail", page: 9, filters: f({ colores: ["dorad"] }) }))!;
    assert.deepEqual([fuera.products.length, fuera.total, fuera.page], [0, 60, 9], "una página de más es una página vacía con el total real");
  });

  it("las categorías de la respuesta siguen siendo todas (la columna lateral no depende del filtro)", async () => {
    await sembrar();
    const r = (await publico.getCatalog({ slug: slugA, context: "retail", filters: f({ colores: ["dorad"] }) }))!;
    assert.deepEqual(r.categories.map((c) => c.name).sort(), ["Aretes", "Dije", "Vacía"]);
  });

  it("nunca mezcla negocios ni muestra desactivados", async () => {
    await sembrar();
    await nuevo(B, "Dije de otro", { color: "Dorada" });
    const apagado = await nuevo(A, "Dije apagado", { color: "Dorada" });
    await admin.updateProduct(A, apagado.id, { status: "INACTIVE" });
    const n = await nombres(f({ colores: ["dorad"] }));
    assert.ok(!n.includes("Dije de otro") && !n.includes("Dije apagado"));
    assert.equal(n.length, 3);
  });
});

describe("lo que NO cambia", () => {
  it("sin filtros, con filtros vacíos o con una sola categoría el listado es exactamente el de siempre", async () => {
    await sembrar();
    const base = await publico.getCatalog({ slug: slugA, context: "retail" });
    assert.deepEqual(await publico.getCatalog({ slug: slugA, context: "retail", filters: SIN_FILTROS }), base);
    const deSiempre = await publico.getCatalog({ slug: slugA, context: "retail", categoryId: dijes });
    assert.deepEqual(await publico.getCatalog({ slug: slugA, context: "retail", filters: f({ categorias: [dijes] }) }), deSiempre);
    assert.deepEqual(await publico.getCatalog({ slug: slugA, context: "retail", categoryId: dijes, filters: f({ categorias: [dijes] }) }), deSiempre);
  });

  it("pedir además las opciones no cambia el listado: es el mismo más `facets`", async () => {
    await sembrar();
    for (const query of [{}, { categoryId: dijes }, { filters: f({ categorias: [dijes] }) }, { filters: f({ colores: ["dorad"] }) }]) {
      const sin = (await publico.getCatalog({ slug: slugA, context: "retail", ...query }))!;
      const { facets, ...resto } = (await publico.getCatalog({ slug: slugA, context: "retail", ...query, facets: true }))!;
      assert.deepEqual(resto, sin);
      assert.equal(facets?.total, 6);
    }
  });

  it("con búsqueda por texto los filtros nuevos no se aplican (rige la búsqueda de siempre)", async () => {
    await sembrar();
    const sola = await publico.getCatalog({ slug: slugA, context: "retail", q: "dije" });
    const conFiltros = await publico.getCatalog({ slug: slugA, context: "retail", q: "dije", filters: f({ colores: ["dorad"], precioMin: 50_000 }) });
    assert.deepEqual(conFiltros, sola);
  });
});
