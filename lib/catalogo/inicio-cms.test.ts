/**
 * Inicio de la tienda con lo que elige el CMS comercial: destacados, categorías y productos de la campaña. Sin red ni BD (repositorio en memoria).
 * El CMS solo ELIGE (referencias e ids); el catálogo real decide qué existe, qué está activo y qué es de este negocio.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { FEATURED_LIMIT, createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository, WEBP_HEAD } from "@/lib/catalogo/testing/in-memory-repository";

const NEGOCIO: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin" };
const OTRO: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-000000000002", userId: "otro" };

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let publico: ReturnType<typeof createPublicCatalogService>;
let slug: string;
let slugOtro: string;

beforeEach(async () => {
  ids.clear();
  mem = createInMemoryCatalogRepository();
  let n = 0;
  admin = createCatalogService({ repo: mem.repo, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  publico = createPublicCatalogService({ repo: mem.repo });
  mem.setProfile(NEGOCIO.tenantId, { name: "Joyería de prueba", whatsapp: "573001112233" });
  mem.setProfile(OTRO.tenantId, { name: "Otra Tienda", whatsapp: "573000000001" });
  mem.enableModule(NEGOCIO.tenantId);
  mem.enableModule(OTRO.tenantId);
  slug = (await admin.ensurePublication(NEGOCIO)).slug;
  slugOtro = (await admin.ensurePublication(OTRO)).slug;
});

async function foto(actor: CatalogActor, productId: string) {
  const t = await admin.requestImageUpload(actor, productId, { mimeType: "image/webp", bytes: 10, thumbBytes: 10 });
  mem.putObject(t.image.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
  mem.putObject(t.thumb.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
  await admin.confirmImage(actor, productId, { uploadId: t.uploadId, mimeType: "image/webp", width: 800, height: 800, makePrimary: true });
}

/** Crea N productos (el más reciente al final); `ids` guarda el id interno de cada referencia para poder desactivarlos. */
const ids = new Map<string, string>();
async function productos(actor: CatalogActor, n: number, opciones: { foto?: boolean } = {}) {
  const refs: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = await admin.createProduct(actor, { stock: 10, name: `Pieza ${i + 1}`, retailPrice: 10_000 + i });
    if (opciones.foto) await foto(actor, p.id);
    ids.set(p.reference, p.id);
    refs.push(p.reference);
  }
  return refs;
}

/** Un producto de OTRO negocio con una referencia que NO existe en el negocio de la prueba (si no, sería un producto propio legítimo). */
async function productoAjeno(nombre: string, propias: readonly string[]): Promise<string> {
  let ultimo = "";
  for (let i = 0; i <= propias.length + 2; i++) ultimo = (await admin.createProduct(OTRO, { stock: 5, name: i === propias.length + 2 ? nombre : `Relleno ${i}`, retailPrice: 5_000 })).reference;
  assert.ok(!propias.includes(ultimo), "la referencia ajena no debe existir en el negocio de la prueba");
  return ultimo;
}

const nombres = (h: Awaited<ReturnType<typeof publico.getHome>>) => h?.featured.map((p) => p.name);

describe("getHome — destacados elegidos en el CMS", () => {
  it("salen en el orden ELEGIDO (no el de recencia) con la política «cms»", async () => {
    const refs = await productos(NEGOCIO, 5, { foto: true });
    const home = await publico.getHome(slug, { destacadas: [refs[3], refs[0], refs[2]] });
    assert.equal(home?.featuredPolicy, "cms");
    assert.deepEqual(nombres(home), ["Pieza 4", "Pieza 1", "Pieza 3"]);
  });

  it("no exigen foto (la administradora decide) y las referencias se aceptan en minúsculas y sin repetir", async () => {
    const [sinFoto] = await productos(NEGOCIO, 1);
    const home = await publico.getHome(slug, { destacadas: [sinFoto.toLowerCase(), sinFoto, ` ${sinFoto} `] });
    assert.equal(home?.featuredPolicy, "cms");
    assert.deepEqual(nombres(home), ["Pieza 1"]);
  });

  it("los desactivados, los inexistentes y los de OTRO negocio se omiten (el CMS no decide qué existe)", async () => {
    const refs = await productos(NEGOCIO, 3, { foto: true });
    const otro = await productoAjeno("De otro negocio", refs);
    await admin.updateProduct(NEGOCIO, ids.get(refs[1])!, { status: "INACTIVE" });
    const home = await publico.getHome(slug, { destacadas: [refs[0], refs[1], "DL-999999", "zzz", otro, refs[2]] });
    assert.deepEqual(nombres(home), ["Pieza 1", "Pieza 3"]);
    assert.ok(!JSON.stringify(home).includes("De otro negocio"));
  });

  it("si ninguno de los elegidos sirve, vuelve a la política automática (nunca un inicio vacío por un error de elección)", async () => {
    const refs = await productos(NEGOCIO, 3, { foto: true });
    const home = await publico.getHome(slug, { destacadas: ["DL-999998", "DL-999999"] });
    assert.equal(home?.featuredPolicy, "recent-with-photo");
    assert.equal(home?.featured.length, refs.length);
    const vacio = await publico.getHome(slug, { destacadas: [] });
    assert.equal(vacio?.featuredPolicy, "recent-with-photo");
  });

  it("tope de 24 elegidos (más que los 8 automáticos)", async () => {
    const refs = await productos(NEGOCIO, 30);
    const home = await publico.getHome(slug, { destacadas: refs });
    assert.equal(home?.featured.length, 24);
    assert.ok(24 > FEATURED_LIMIT);
    assert.deepEqual(home?.featured.map((p) => p.reference), refs.slice(0, 24));
  });

  it("sin opciones el inicio es el de siempre: sin campaña y con la forma exacta de antes", async () => {
    await productos(NEGOCIO, 2, { foto: true });
    const sin = await publico.getHome(slug);
    const vacias = await publico.getHome(slug, {});
    assert.deepEqual(vacias, sin);
    assert.ok(!("campana" in (sin ?? {})));
    assert.equal(sin?.featuredPolicy, "recent-with-photo");
  });
});

describe("getHome — categorías elegidas", () => {
  it("salen las elegidas, en su orden, con su miniatura; las demás no", async () => {
    const aretes = await admin.createCategory(NEGOCIO, { name: "Aretes" });
    const dijes = await admin.createCategory(NEGOCIO, { name: "Dijes" });
    await admin.createCategory(NEGOCIO, { name: "Anillos" });
    const p = await admin.createProduct(NEGOCIO, { stock: 10, name: "Dije corazón", retailPrice: 30_000, categoryId: dijes.id });
    await foto(NEGOCIO, p.id);
    const home = await publico.getHome(slug, { categorias: [dijes.id, aretes.id] });
    assert.deepEqual(home?.categories.map((c) => c.name), ["Dijes", "Aretes"]);
    assert.match(home?.categories[0].coverUrl ?? "", /thumb\.webp/);
    assert.equal(home?.categories[1].coverUrl, null);
  });

  it("una categoría que no existe (o es de otro negocio) se ignora; si ninguna existe, se muestran todas", async () => {
    const aretes = await admin.createCategory(NEGOCIO, { name: "Aretes" });
    await admin.createCategory(NEGOCIO, { name: "Dijes" });
    const ajena = await admin.createCategory(OTRO, { name: "Categoría ajena" });
    const parcial = await publico.getHome(slug, { categorias: [ajena.id, "c0000000-0000-4000-8000-0000000000ff", aretes.id, aretes.id] });
    assert.deepEqual(parcial?.categories.map((c) => c.name), ["Aretes"]);
    const ninguna = await publico.getHome(slug, { categorias: [ajena.id, "c0000000-0000-4000-8000-0000000000ff"] });
    assert.deepEqual(ninguna?.categories.map((c) => c.name).sort(), ["Aretes", "Dijes"]);
    assert.ok(!JSON.stringify(ninguna).includes("Categoría ajena"));
    const vacio = await publico.getHome(slug, { categorias: [] });
    assert.equal(vacio?.categories.length, 2);
  });
});

describe("getHome — productos de la campaña", () => {
  it("solo si se pide: sus productos ACTIVOS, en el orden elegido", async () => {
    const refs = await productos(NEGOCIO, 4, { foto: true });
    const home = await publico.getHome(slug, { campana: [refs[2], refs[0]] });
    assert.deepEqual(home?.campana?.map((p) => p.name), ["Pieza 3", "Pieza 1"]);
    assert.ok(!("campana" in ((await publico.getHome(slug)) ?? {})));
  });

  it("desactivados, inexistentes y de otro negocio se omiten; con una lista vacía no hay campaña", async () => {
    const refs = await productos(NEGOCIO, 2);
    const otro = await productoAjeno("Producto ajeno", refs);
    await admin.updateProduct(NEGOCIO, ids.get(refs[0])!, { status: "INACTIVE" });
    const home = await publico.getHome(slug, { campana: [refs[0], refs[1], "DL-999999", otro] });
    assert.deepEqual(home?.campana?.map((p) => p.reference), [refs[1]]);
    assert.ok(!JSON.stringify(home).includes("Producto ajeno"));
    assert.ok(!("campana" in ((await publico.getHome(slug, { campana: [] })) ?? {})));
  });

  it("tope de 12 productos por campaña", async () => {
    const refs = await productos(NEGOCIO, 15);
    const home = await publico.getHome(slug, { campana: refs });
    assert.equal(home?.campana?.length, 12);
  });

  it("un producto en destacados y en la campaña sale en ambos, con los mismos datos", async () => {
    const refs = await productos(NEGOCIO, 2, { foto: true });
    const home = await publico.getHome(slug, { destacadas: [refs[0]], campana: [refs[0], refs[1]] });
    assert.deepEqual(home?.featured[0], home?.campana?.[0]);
    assert.equal(home?.campana?.length, 2);
  });

  it("no filtra ids internos del negocio ni de los productos", async () => {
    const refs = await productos(NEGOCIO, 2, { foto: true });
    const home = await publico.getHome(slug, { destacadas: refs, campana: refs, categorias: [] });
    const texto = JSON.stringify(home);
    assert.ok(!texto.includes(NEGOCIO.tenantId));
    for (const id of ids.values()) assert.ok(!texto.includes(id));
  });
});

describe("tenantOf — el negocio de una tienda publicada (solo para componer en el servidor)", () => {
  it("devuelve el negocio de la publicación visible", async () => {
    assert.equal(await publico.tenantOf(slug), NEGOCIO.tenantId);
    assert.equal(await publico.tenantOf(slugOtro), OTRO.tenantId);
  });

  it("null si la tienda no está publicada, el módulo está apagado, el slug es inválido o no existe", async () => {
    mem.setPublished(NEGOCIO.tenantId, false);
    assert.equal(await publico.tenantOf(slug), null);
    mem.setPublished(NEGOCIO.tenantId, true);
    mem.enableModule(NEGOCIO.tenantId, false);
    assert.equal(await publico.tenantOf(slug), null);
    assert.equal(await publico.tenantOf("no-existe"), null);
    assert.equal(await publico.tenantOf("../etc"), null);
    assert.equal(await publico.tenantOf(""), null);
  });
});
