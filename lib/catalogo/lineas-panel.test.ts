/**
 * El listado del PANEL por línea de la tienda (Plata, Rodio, Acero, Cover Gold, o «sin línea») sobre el servicio REAL con el repositorio en memoria (sin red ni base de datos; negocios FICTICIOS):
 * es lo que permite encontrar las piezas sin clasificar y clasificarlas. Lo que NO cambia: sin `linea`, con una línea que el negocio no tiene, o en un negocio sin líneas, el listado es exactamente el
 * de siempre. Solo lectura.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CATALOG_LIMITS, productListQuerySchema, type ProductListQuery } from "@/lib/catalogo/domain";
import { isCatalogError } from "@/lib/catalogo/errors";
import { LINEA_SIN, lineasDeMaterial } from "@/lib/catalogo/lineas";
import { LINEA_FILTRO_MAX, LINEA_LOTE, createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { lineasDeLaTienda } from "@/lib/catalogo/joyeria";

/** «Delacour» da la publicación `delacour`, que SÍ tiene líneas; «Otra joyería» da `otra-joyeria`, que no. */
const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const LINEAS = lineasDeLaTienda("delacour");

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let anillos: string;
let aretes: string;
let cadenas: string;

const nuevo = async (actor: CatalogActor, name: string, material: string | undefined, categoryId?: string, status?: "INACTIVE") => {
  const p = await admin.createProduct(actor, { name, retailPrice: 15_000, wholesalePrice: null, stock: 10, material, categoryId });
  if (status) await admin.updateProduct(actor, p.id, { status });
  return p;
};
const consulta = (over: Partial<ProductListQuery> = {}): ProductListQuery => ({ q: undefined, status: "ALL", page: 1, pageSize: CATALOG_LIMITS.pageSizeMax, ...over });
const lista = (actor: CatalogActor, over: Partial<ProductListQuery> = {}) => admin.listProducts(actor, consulta(over));
const nombres = async (actor: CatalogActor, over: Partial<ProductListQuery> = {}) => (await lista(actor, over)).items.map((p) => p.name).sort();

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  for (const [actor, nombre] of [[A, "Delacour"], [B, "Otra joyería"]] as const) {
    mem.setProfile(actor.tenantId, { name: nombre, whatsapp: "573001112233" });
    mem.enableModule(actor.tenantId);
    await admin.ensurePublication(actor);
  }
  anillos = (await admin.createCategory(A, { name: "Anillos" })).id;
  aretes = (await admin.createCategory(A, { name: "Aretes" })).id;
  cadenas = (await admin.createCategory(A, { name: "Cadenas" })).id;
});

/** Un catálogo como el de Delacour: casi todo Rodio, pocas de otras líneas y varias sin clasificar (activas e inactivas). */
async function sembrar() {
  await nuevo(A, "Anillo uno", "Rodio", anillos);
  await nuevo(A, "Anillo dos", "Rodio · 3cm", anillos);
  await nuevo(A, "Arete plata", "Plata 925", aretes);
  await nuevo(A, "Cadena acero", "Acero quirúrgico", cadenas);
  await nuevo(A, "Anillo sin material", undefined, anillos);
  await nuevo(A, "Arete plateado", "Plateado", aretes);
  await nuevo(A, "Cadena sin material inactiva", undefined, cadenas, "INACTIVE");
  await nuevo(A, "Cadena rodio inactiva", "Rodio", cadenas, "INACTIVE");
  await nuevo(A, "Arete dos lineas", "Acero y Rodio", aretes);
}

describe("el listado del panel por línea", () => {
  it("«sin línea» trae las piezas que no están en ninguna línea (con material que no es de ninguna, o sin material), activas e inactivas", async () => {
    await sembrar();
    assert.deepEqual(await nombres(A, { linea: LINEA_SIN }), ["Anillo sin material", "Arete plateado", "Cadena sin material inactiva"]);
    assert.equal((await lista(A, { linea: LINEA_SIN })).total, 3);
  });

  it("una línea trae sus piezas, con cualquier forma de escribir el material y también las que están en dos líneas", async () => {
    await sembrar();
    assert.deepEqual(await nombres(A, { linea: "rodio" }), ["Anillo dos", "Anillo uno", "Arete dos lineas", "Cadena rodio inactiva"]);
    assert.deepEqual(await nombres(A, { linea: "plata" }), ["Arete plata"], "«Plateado» es un color: no es Plata");
    assert.deepEqual(await nombres(A, { linea: "acero" }), ["Arete dos lineas", "Cadena acero"]);
    assert.deepEqual(await nombres(A, { linea: "cover-gold" }), [], "una línea sin piezas devuelve una lista vacía, no un error");
  });

  it("cada pieza está en «sin línea» o en alguna línea, nunca en ambas: las listas encajan con el catálogo completo", async () => {
    await sembrar();
    const todas = await nombres(A);
    const unidas = new Set<string>();
    for (const clave of [LINEA_SIN, ...LINEAS.map((l) => l.clave)]) for (const n of await nombres(A, { linea: clave })) unidas.add(n);
    assert.deepEqual([...unidas].sort(), todas);
    const sin = new Set(await nombres(A, { linea: LINEA_SIN }));
    for (const l of LINEAS) for (const n of await nombres(A, { linea: l.clave })) assert.ok(!sin.has(n), `«${n}» está en ${l.clave} y también «sin línea»`);
  });

  it("se combina con el estado, la categoría y la búsqueda", async () => {
    await sembrar();
    assert.deepEqual(await nombres(A, { linea: "rodio", status: "ACTIVE" }), ["Anillo dos", "Anillo uno", "Arete dos lineas"]);
    assert.deepEqual(await nombres(A, { linea: LINEA_SIN, status: "INACTIVE" }), ["Cadena sin material inactiva"]);
    assert.deepEqual(await nombres(A, { linea: LINEA_SIN, categoryId: anillos }), ["Anillo sin material"]);
    assert.deepEqual(await nombres(A, { linea: LINEA_SIN, q: "plateado" }), ["Arete plateado"]);
    assert.deepEqual(await nombres(A, { linea: "rodio", q: "plateado" }), [], "buscar algo que no es de esa línea no la trae");
  });

  it("pagina sobre lo FILTRADO: el total es el de la línea, las páginas no se repiten ni se saltan nada y respetan el orden del listado de siempre", async () => {
    await sembrar();
    const ordenDeSiempre = (await lista(A)).items.map((p) => p.name);
    const esperadas = ordenDeSiempre.filter((n) => ["Anillo sin material", "Arete plateado", "Cadena sin material inactiva"].includes(n));
    const p1 = await lista(A, { linea: LINEA_SIN, pageSize: 2, page: 1 });
    const p2 = await lista(A, { linea: LINEA_SIN, pageSize: 2, page: 2 });
    const p3 = await lista(A, { linea: LINEA_SIN, pageSize: 2, page: 3 });
    assert.deepEqual([p1.total, p2.total, p3.total], [3, 3, 3]);
    assert.deepEqual([p1.items.length, p2.items.length, p3.items.length], [2, 1, 0]);
    assert.deepEqual([...p1.items, ...p2.items].map((p) => p.name), esperadas);
    assert.deepEqual([p1.page, p1.pageSize], [1, 2]);
  });

  it("los productos que devuelve son los completos de siempre (referencia, categoría, material y precios)", async () => {
    await sembrar();
    const [uno] = (await lista(A, { linea: "plata" })).items;
    assert.equal(uno.name, "Arete plata");
    assert.equal(uno.material, "Plata 925");
    assert.equal(uno.categoryName, "Aretes");
    assert.equal(uno.pricing.retail, 15_000);
    assert.match(uno.reference, /\S/);
  });
});

describe("lo que NO cambia", () => {
  it("sin `linea` el listado es el de siempre (todas las piezas del negocio, y solo las suyas)", async () => {
    await sembrar();
    await nuevo(B, "Pieza de otro negocio", "Rodio");
    assert.equal((await lista(A)).total, 9);
    assert.ok(!(await nombres(A)).includes("Pieza de otro negocio"));
  });

  it("una línea que el negocio no tiene se ignora: el listado es el de siempre, nunca vacío ni un error", async () => {
    await sembrar();
    assert.deepEqual(await nombres(A, { linea: "oro" }), await nombres(A));
    assert.equal((await lista(A, { linea: "oro" })).total, 9);
  });

  it("un negocio SIN líneas ignora `linea` (también «sin»): su listado es el de siempre", async () => {
    await nuevo(B, "Anillo B", "Rodio");
    await nuevo(B, "Cadena B", undefined);
    for (const linea of [LINEA_SIN, "rodio", "plata"]) assert.deepEqual(await nombres(B, { linea }), ["Anillo B", "Cadena B"], linea);
  });

  it("un negocio sin líneas no recorre su catálogo para filtrar: pide solo su página, como siempre", async () => {
    await nuevo(B, "Anillo B", "Rodio");
    const pedidos: Array<{ offset: number; limit: number }> = [];
    const repoEspia = {
      ...mem.repo,
      listProducts: async (tenantId: string, f: Parameters<typeof mem.repo.listProducts>[1]) => {
        pedidos.push({ offset: f.offset, limit: f.limit });
        return mem.repo.listProducts(tenantId, f);
      },
    };
    const servicio = createCatalogService({ repo: repoEspia as typeof mem.repo });
    await servicio.listProducts(B, consulta({ linea: LINEA_SIN, pageSize: 10 }));
    assert.deepEqual(pedidos, [{ offset: 0, limit: 10 }]);
  });

  it("filtrar por línea en un negocio no mira ni cuenta las piezas de otro", async () => {
    await sembrar();
    await nuevo(B, "Anillo rodio de B", "Rodio");
    await nuevo(B, "Anillo sin material de B", undefined);
    assert.ok(!(await nombres(A, { linea: "rodio" })).includes("Anillo rodio de B"));
    assert.ok(!(await nombres(A, { linea: LINEA_SIN })).includes("Anillo sin material de B"));
  });

  it("clasificar cambia el listado: una pieza «sin línea» pasa a su línea con el Material que le escribe `materialConLinea`", async () => {
    await sembrar();
    const [pendiente] = (await lista(A, { linea: LINEA_SIN, q: "Anillo sin material" })).items;
    await admin.updateProduct(A, pendiente.id, { material: "Plata" });
    assert.ok(!(await nombres(A, { linea: LINEA_SIN })).includes("Anillo sin material"));
    assert.ok((await nombres(A, { linea: "plata" })).includes("Anillo sin material"));
    assert.deepEqual(lineasDeMaterial("Plata", LINEAS), ["plata"]);
  });
});

describe("el tope", () => {
  it("un catálogo enorme pide acotar la búsqueda (LIMIT_REACHED) en vez de leer sin fin", async () => {
    const real = await nuevo(A, "Pieza", undefined, anillos);
    let llamadas = 0;
    const repoEnorme = {
      ...mem.repo,
      listProducts: async (_tenantId: string, f: { offset: number; limit: number }) => {
        llamadas++;
        const n = Math.max(0, Math.min(f.limit, 10_000 - f.offset));
        return { items: Array.from({ length: n }, () => real), total: 10_000 };
      },
    };
    const servicio = createCatalogService({ repo: repoEnorme as typeof mem.repo });
    await assert.rejects(servicio.listProducts(A, consulta({ linea: LINEA_SIN })), (e: unknown) => isCatalogError(e) && e.code === "LIMIT_REACHED" && /acota/i.test(e.message));
    assert.equal(llamadas, LINEA_FILTRO_MAX / LINEA_LOTE, "lee por lotes hasta el tope y se detiene");
  });

  it("un catálogo que cabe exacto en el tope se lee completo sin error", async () => {
    const real = await nuevo(A, "Pieza", undefined, anillos);
    const repoJusto = {
      ...mem.repo,
      listProducts: async (_tenantId: string, f: { offset: number; limit: number }) => {
        const n = Math.max(0, Math.min(f.limit, LINEA_FILTRO_MAX - f.offset));
        return { items: Array.from({ length: n }, () => real), total: LINEA_FILTRO_MAX };
      },
    };
    const servicio = createCatalogService({ repo: repoJusto as typeof mem.repo });
    const pagina = await servicio.listProducts(A, consulta({ linea: LINEA_SIN, pageSize: 10 }));
    assert.equal(pagina.total, LINEA_FILTRO_MAX);
    assert.equal(pagina.items.length, 10);
  });
});

describe("la consulta del listado (validación)", () => {
  const leer = (linea?: string) => productListQuerySchema.safeParse(linea === undefined ? {} : { linea });

  it("acepta «sin» y claves de línea bien formadas", () => {
    for (const ok of ["sin", "plata", "cover-gold", "rodio2"]) {
      const r = leer(ok);
      assert.ok(r.success, ok);
      assert.equal(r.data.linea, ok);
    }
  });

  it("ausente, vacío o solo espacios significa «todas las líneas»: la consulta es VÁLIDA y sin filtro", () => {
    for (const vacio of [undefined, "", "   "]) {
      const r = leer(vacio);
      assert.ok(r.success, `${JSON.stringify(vacio)} debe ser una consulta válida`);
      assert.equal(r.data.linea, undefined);
    }
  });

  it("rechaza lo que no es una clave (mayúsculas, símbolos, demasiado larga)", () => {
    for (const mal of ["Plata", "cover gold", "-plata", "plata-", "pl_ata", "a".repeat(31), "plata;drop", "../x"]) assert.equal(leer(mal).success, false, mal);
  });
});
