/**
 * Líneas de la tienda (Plata, Rodio, Acero, Cover Gold) sobre el servicio público REAL con el repositorio en memoria (sin red ni base de datos; negocios FICTICIOS): el listado de una línea, sus
 * facetas (cuántas piezas tiene cada línea y cada categoría dentro de ella, también las líneas sin piezas) y lo que NO cambia: sin las líneas del negocio, o con una línea que no existe, el listado es
 * exactamente el de siempre. Solo lectura: ningún dato se escribe.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { SIN_FILTROS, type FiltrosCatalogo } from "@/lib/catalogo/filtros";
import { PUBLIC_PAGE_SIZE } from "@/lib/catalogo/publicacion";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
/** Las líneas tal como las tiene Delacour en su configuración. */
const LINEAS = storefrontConfigFor("delacour").joyeria!.lineas!.lineas;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let publico: ReturnType<typeof createPublicCatalogService>;
let slugA: string;
let slugB: string;
let anillos: string;
let aretes: string;
let cadenas: string;

const nuevo = (actor: CatalogActor, name: string, material: string | undefined, categoryId?: string, retail = 15_000) =>
  admin.createProduct(actor, { name, retailPrice: retail, wholesalePrice: null, stock: 10, material, categoryId });
const f = (over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({ ...SIN_FILTROS, ...over });
const catalogo = (filters: FiltrosCatalogo | undefined, opciones: { lineas?: typeof LINEAS | null; page?: number; q?: string; facets?: boolean; slug?: string } = {}) =>
  publico.getCatalog({
    slug: opciones.slug ?? slugA,
    context: "retail",
    page: opciones.page,
    q: opciones.q,
    ...(filters ? { filters } : {}),
    ...(opciones.facets ? { facets: true } : {}),
    ...(opciones.lineas === null ? {} : { lineas: opciones.lineas ?? LINEAS }),
  });
const nombres = async (filters: FiltrosCatalogo | undefined, opciones: Parameters<typeof catalogo>[1] = {}) => (await catalogo(filters, opciones))!.products.map((p) => p.name).sort();

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  publico = createPublicCatalogService({ repo: mem.repo });
  for (const [actor, nombre] of [[A, "Joyería A"], [B, "Joyería B"]] as const) {
    mem.setProfile(actor.tenantId, { name: nombre, whatsapp: "573001112233" });
    mem.enableModule(actor.tenantId);
  }
  slugA = (await admin.ensurePublication(A)).slug;
  slugB = (await admin.ensurePublication(B)).slug;
  anillos = (await admin.createCategory(A, { name: "Anillos" })).id;
  aretes = (await admin.createCategory(A, { name: "Aretes" })).id;
  cadenas = (await admin.createCategory(A, { name: "Cadenas" })).id;
});

/** Un catálogo como el de Delacour hoy (casi todo Rodio, escrito de varias formas) más unas pocas piezas de otras líneas. */
async function sembrar() {
  await nuevo(A, "Anillo uno", "Rodio", anillos);
  await nuevo(A, "Anillo dos", "RODIO", anillos);
  await nuevo(A, "Anillo tres", "Rodio · 3cm", anillos);
  await nuevo(A, "Arete uno", "Rodio platinado", aretes);
  await nuevo(A, "Cadena plata", "Plata 925", cadenas);
  await nuevo(A, "Anillo plata", "Plata 925", anillos);
  await nuevo(A, "Cadena acero", "Acero quirúrgico", cadenas);
  await nuevo(A, "Anillo sin material", undefined, anillos);
  await nuevo(A, "Arete plateado", "Plateado", aretes);
}

describe("el listado de una línea", () => {
  it("solo las piezas de esa línea, con cualquier forma de escribir el material", async () => {
    await sembrar();
    assert.deepEqual(await nombres(f({ lineas: ["rodio"] })), ["Anillo dos", "Anillo tres", "Anillo uno", "Arete uno"]);
    assert.deepEqual(await nombres(f({ lineas: ["plata"] })), ["Anillo plata", "Cadena plata"], "«Plateado» es un color: no es Plata");
    assert.deepEqual(await nombres(f({ lineas: ["acero"] })), ["Cadena acero"]);
  });

  it("la línea y la categoría se suman: Plata → Anillos", async () => {
    await sembrar();
    assert.deepEqual(await nombres(f({ lineas: ["plata"], categorias: [anillos] })), ["Anillo plata"]);
    assert.deepEqual(await nombres(f({ lineas: ["rodio"], categorias: [aretes] })), ["Arete uno"]);
    assert.deepEqual(await nombres(f({ lineas: ["rodio"], categorias: [cadenas] })), []);
  });

  it("varias líneas: las piezas de cualquiera de ellas", async () => {
    await sembrar();
    assert.deepEqual(await nombres(f({ lineas: ["plata", "acero"] })), ["Anillo plata", "Cadena acero", "Cadena plata"]);
  });

  it("una línea SIN piezas (Cover Gold hoy) da un listado vacío correcto, no un error", async () => {
    await sembrar();
    const r = (await catalogo(f({ lineas: ["cover-gold"] })))!;
    assert.deepEqual(r.products, []);
    assert.equal(r.total, 0);
    assert.equal(r.pageCount, 1);
  });

  it("una pieza que está en dos líneas aparece en las dos", async () => {
    await nuevo(A, "Anillo mixto", "Acero y Rodio", anillos);
    assert.deepEqual(await nombres(f({ lineas: ["rodio"] })), ["Anillo mixto"]);
    assert.deepEqual(await nombres(f({ lineas: ["acero"] })), ["Anillo mixto"]);
  });

  it("pagina igual que siempre (48 por página) y el total es el de la línea", async () => {
    for (let i = 0; i < PUBLIC_PAGE_SIZE + 5; i++) await nuevo(A, `Rodio ${String(i).padStart(3, "0")}`, "Rodio", anillos);
    await nuevo(A, "Una de plata", "Plata", anillos);
    const p1 = (await catalogo(f({ lineas: ["rodio"] })))!;
    const p2 = (await catalogo(f({ lineas: ["rodio"] }), { page: 2 }))!;
    assert.equal(p1.total, PUBLIC_PAGE_SIZE + 5);
    assert.equal(p1.products.length, PUBLIC_PAGE_SIZE);
    assert.equal(p2.products.length, 5);
    assert.equal(p1.pageCount, 2);
  });

  it("no mezcla las piezas de otro negocio", async () => {
    await sembrar();
    await nuevo(B, "Anillo ajeno", "Rodio");
    assert.ok(!(await nombres(f({ lineas: ["rodio"] }))).includes("Anillo ajeno"));
    assert.deepEqual(await nombres(f({ lineas: ["rodio"] }), { slug: slugB }), ["Anillo ajeno"]);
  });
});

describe("lo que NO cambia", () => {
  it("sin las líneas del negocio, una `?linea=` se ignora: el listado es el de siempre", async () => {
    await sembrar();
    const todos = await nombres(undefined, { lineas: null });
    assert.equal(todos.length, 9);
    assert.deepEqual(await nombres(f({ lineas: ["plata"] }), { lineas: null }), todos);
  });

  it("una línea que el negocio no tiene se ignora (una dirección vieja no deja la lista vacía)", async () => {
    await sembrar();
    assert.equal((await nombres(f({ lineas: ["oro"] }))).length, 9);
    assert.deepEqual(await nombres(f({ lineas: ["oro", "acero"] })), ["Cadena acero"], "se respeta la que sí existe");
  });

  it("con búsqueda por texto, los filtros (también la línea) no aplican, como siempre", async () => {
    await sembrar();
    assert.deepEqual(await nombres(f({ lineas: ["acero"] }), { q: "anillo" }), ["Anillo dos", "Anillo plata", "Anillo sin material", "Anillo tres", "Anillo uno"]);
  });

  it("sin filtros el listado es exactamente el de siempre (y las facetas no traen líneas si no se dieron)", async () => {
    await sembrar();
    assert.equal((await nombres(undefined)).length, 9);
    const fx = (await catalogo(undefined, { facets: true, lineas: null }))!.facets!;
    assert.ok(!("lineas" in fx));
  });

  it("es solo lectura: no escribe nada", async () => {
    await sembrar();
    const antes = JSON.stringify(await mem.repo.listProducts(A.tenantId, { status: "ALL", offset: 0, limit: 100 }));
    await catalogo(f({ lineas: ["rodio"], categorias: [anillos] }), { facets: true });
    assert.equal(JSON.stringify(await mem.repo.listProducts(A.tenantId, { status: "ALL", offset: 0, limit: 100 })), antes);
  });
});

describe("facetas de las líneas", () => {
  it("cada línea con su conteo y el de cada categoría dentro de ella, en el orden de la configuración y también las líneas sin piezas", async () => {
    await sembrar();
    const fx = (await catalogo(undefined, { facets: true }))!.facets!;
    assert.deepEqual(fx.lineas!.map((l) => [l.etiqueta, l.n]), [["Plata", 2], ["Rodio", 4], ["Acero", 1], ["Cover Gold", 0]]);
    const rodio = fx.lineas!.find((l) => l.clave === "rodio")!;
    assert.deepEqual([...rodio.categorias].sort((a, b) => a.id.localeCompare(b.id)), [{ id: anillos, n: 3 }, { id: aretes, n: 1 }].sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(fx.lineas!.find((l) => l.clave === "cover-gold")!.categorias, []);
  });

  it("con una línea elegida, las categorías del panel se cuentan DENTRO de esa línea", async () => {
    await sembrar();
    const global = (await catalogo(f(), { facets: true }))!.facets!;
    assert.deepEqual(global.categorias.map((c) => [c.nombre, c.n]), [["Anillos", 5], ["Aretes", 2], ["Cadenas", 2]]);
    const dePlata = (await catalogo(f({ lineas: ["plata"] }), { facets: true }))!.facets!;
    assert.deepEqual(dePlata.categorias.map((c) => [c.nombre, c.n]), [["Anillos", 1], ["Cadenas", 1]], "solo lo que hay en Plata");
    assert.equal(dePlata.total, 9, "el total del catálogo no cambia");
    assert.equal(dePlata.lineas!.find((l) => l.clave === "rodio")!.n, 4, "el conteo de las demás líneas no cambia al elegir una");
  });

  it("una línea sin piezas elegida: listado vacío y sin categorías en el panel, pero la línea sigue estando", async () => {
    await sembrar();
    const r = (await catalogo(f({ lineas: ["cover-gold"] }), { facets: true }))!;
    assert.equal(r.total, 0);
    assert.deepEqual(r.facets!.categorias, []);
    assert.equal(r.facets!.lineas!.length, 4);
  });
});
