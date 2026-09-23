/**
 * Catálogo público (detal / mayor) — sin red ni BD. Garantías principales:
 *   - el link detal NUNCA expone precios mayoristas ni ids internos;
 *   - el link mayorista exige el token exacto (tiempo constante) y regenerarlo
 *     invalida el anterior;
 *   - solo productos ACTIVOS; catálogo no publicado / módulo apagado => 404.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { CatalogProduct } from "@/lib/catalogo/domain";
import {
  imageVersion,
  isValidSlug,
  parseImageFileName,
  productImagePath,
  referenceFromUrl,
  slugCandidates,
  slugify,
  toPublicProduct,
  whatsappOrderLink,
} from "@/lib/catalogo/publicacion";
import { createCatalogService, createPublicCatalogService, newWholesaleToken, tokensMatch, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository, JPEG_HEAD, WEBP_HEAD } from "@/lib/catalogo/testing/in-memory-repository";

const DELACOUR: CatalogActor = { tenantId: "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4", userId: "admin" };
const OTRO: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-000000000002", userId: "otro" };

describe("slug del link", () => {
  it("se deriva del nombre del negocio (sin tildes ni símbolos)", () => {
    assert.equal(slugify("DELACOUR JOYERÍA"), "delacour-joyeria");
    assert.equal(slugify("Delacour & Orus Joyería"), "delacour-y-orus-joyeria");
    assert.equal(slugify("  ¡¡¡  "), "catalogo");
  });
  it("siempre produce slugs válidos para la BD, también los alternativos", () => {
    for (const s of [...slugCandidates("Delacour & Orus Joyería"), ...slugCandidates("x".repeat(80)), slugify("a-".repeat(40))]) {
      assert.ok(isValidSlug(s), s);
      assert.ok(s.length <= 50, s);
    }
    assert.equal(isValidSlug("Mal Slug!"), false);
    assert.equal(isValidSlug("-delacour"), false);
  });
});

describe("proyección pública de un producto", () => {
  const producto: CatalogProduct = {
    id: "11111111-2222-4333-8444-555555555555",
    reference: "DL-000184",
    name: "Dije corazón",
    description: null,
    categoryId: "c1",
    categoryName: "Dijes",
    material: "Oro laminado",
    color: null,
    pricing: { retail: 35_000, wholesale: 18_000 },
    status: "ACTIVE",
    tracksStock: false,
    primaryImage: { url: "https://x/a.webp", thumbUrl: "https://x/a_thumb.webp" },
    createdAt: "",
    updatedAt: "",
  };

  it("detal: solo el precio detal; nada interno", () => {
    const pub = toPublicProduct(producto, "retail");
    assert.equal(pub.price, 35_000);
    const json = JSON.stringify(pub);
    assert.equal(json.includes("18000"), false, "el precio mayor no viaja al link detal");
    assert.equal(json.includes(producto.id), false, "el id interno no se expone");
    assert.equal(json.includes("tracksStock"), false);
  });

  it("nunca copia la URL de Storage del producto: las imágenes públicas llegan aparte", () => {
    const sinImagenes = toPublicProduct(producto, "retail");
    assert.equal(sinImagenes.imageUrl, null);
    assert.equal(sinImagenes.thumbUrl, null);
    const con = toPublicProduct(producto, "retail", { imageUrl: "/catalogo/d/productos/dl-000184/main.webp?v=1", thumbUrl: "/catalogo/d/productos/dl-000184/thumb.webp?v=1" });
    assert.equal(con.imageUrl, "/catalogo/d/productos/dl-000184/main.webp?v=1");
    assert.equal(JSON.stringify(con).includes("https://x/"), false);
  });

  it("mayor: el precio mayor; si no está definido => null (precio a consultar)", () => {
    assert.equal(toPublicProduct(producto, "wholesale").price, 18_000);
    assert.equal(toPublicProduct({ ...producto, pricing: { retail: 35_000, wholesale: null } }, "wholesale").price, null);
  });

  it("WhatsApp: mensaje con la referencia exacta de la pieza", () => {
    const link = whatsappOrderLink("+57 318 3715860", { reference: "DL-000184", name: "Dije corazón" }, "retail");
    assert.ok(link?.startsWith("https://wa.me/573183715860?text="));
    assert.match(decodeURIComponent(link!.split("text=")[1]), /ref\. DL-000184/);
    assert.equal(whatsappOrderLink(null, { reference: "DL-1", name: "x" }, "retail"), null);
  });
});

describe("tokensMatch — link mayorista", () => {
  const token = newWholesaleToken();
  it("64 hex, aleatorio", () => {
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.notEqual(token, newWholesaleToken());
  });
  it("solo acepta el token exacto", () => {
    assert.equal(tokensMatch(token, token), true);
    assert.equal(tokensMatch(token.slice(0, 63) + (token[63] === "a" ? "b" : "a"), token), false);
    assert.equal(tokensMatch(undefined, token), false);
    assert.equal(tokensMatch("", token), false);
    assert.equal(tokensMatch(token.toUpperCase(), token), false);
    assert.equal(tokensMatch("../../etc/passwd", token), false);
  });
});

describe("links del catálogo (dashboard) + catálogo público", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let admin: ReturnType<typeof createCatalogService>;
  let publico: ReturnType<typeof createPublicCatalogService>;

  beforeEach(async () => {
    mem = createInMemoryCatalogRepository();
    admin = createCatalogService({ repo: mem.repo });
    publico = createPublicCatalogService({ repo: mem.repo });
    mem.setProfile(DELACOUR.tenantId, { name: "DELACOUR JOYERIA", whatsapp: "573183715860" });
    mem.enableModule(DELACOUR.tenantId);
  });

  async function cargar() {
    const dije = await admin.createProduct(DELACOUR, { name: "Dije corazón", retailPrice: 35_000, wholesalePrice: 18_000 });
    const anillo = await admin.createProduct(DELACOUR, { name: "Anillo solitario", retailPrice: 58_000, wholesalePrice: null });
    const oculto = await admin.createProduct(DELACOUR, { name: "Pieza descontinuada", retailPrice: 10_000, wholesalePrice: 5_000 });
    await admin.updateProduct(DELACOUR, oculto.id, { status: "INACTIVE" });
    const ticket = await admin.requestImageUpload(DELACOUR, dije.id, { mimeType: "image/webp", bytes: 10, thumbBytes: 10 });
    mem.putObject(ticket.image.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
    mem.putObject(ticket.thumb.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
    await admin.confirmImage(DELACOUR, dije.id, { uploadId: ticket.uploadId, mimeType: "image/webp", width: 800, height: 800, makePrimary: true });
    return { dije, anillo, oculto };
  }

  it("el admin obtiene los links (se crean una vez, idempotente)", async () => {
    const a = await admin.ensurePublication(DELACOUR);
    const b = await admin.ensurePublication(DELACOUR);
    assert.equal(a.slug, "delacour-joyeria");
    assert.equal(a.retailPath, "/catalogo/delacour-joyeria");
    assert.match(a.wholesalePath ?? "", /^\/catalogo\/delacour-joyeria\/mayor\/[0-9a-f]{64}$/);
    assert.deepEqual(a, b);
  });

  it("otros roles nunca reciben el link mayorista", async () => {
    await admin.ensurePublication(DELACOUR);
    const vista = await admin.getPublication(DELACOUR, { includeWholesale: false });
    assert.equal(vista?.wholesalePath, null);
  });

  it("si el slug ya lo usa otro negocio, toma una variante", async () => {
    mem.setProfile(OTRO.tenantId, { name: "Delacour Joyería", whatsapp: null });
    await admin.ensurePublication(DELACOUR);
    const otro = await admin.ensurePublication(OTRO);
    assert.equal(otro.slug, "delacour-joyeria-2");
  });

  it("detal: solo activos, precio detal, sin rastro de precios mayoristas ni ids", async () => {
    const { dije, oculto } = await cargar();
    const pub = await admin.ensurePublication(DELACOUR);
    const page = await publico.getCatalog({ slug: pub.slug, context: "retail" });
    assert.ok(page);
    assert.equal(page.total, 2);
    assert.deepEqual(page.products.map((p) => p.name).sort(), ["Anillo solitario", "Dije corazón"]);
    assert.equal(page.products.find((p) => p.reference === dije.reference)?.price, 35_000);
    const json = JSON.stringify(page);
    assert.equal(json.includes("18000"), false, "ningún precio mayorista en el link detal");
    // Ni ids internos ni la estructura del Storage, TAMPOCO en las URLs de imagen.
    assert.equal(json.includes(dije.id), false, "sin id de producto");
    assert.equal(json.includes(DELACOUR.tenantId), false, "sin id de tenant");
    assert.equal(json.includes("storage.test"), false, "sin host de Storage");
    assert.equal(json.includes("inventario-productos"), false, "sin nombre de bucket");
    const foto = page.products.find((p) => p.reference === dije.reference);
    assert.match(foto?.imageUrl ?? "", /^\/catalogo\/delacour-joyeria\/productos\/dl-\d{6}\/main\.webp\?v=[0-9a-z]+$/);
    assert.match(foto?.thumbUrl ?? "", /^\/catalogo\/delacour-joyeria\/productos\/dl-\d{6}\/thumb\.webp\?v=[0-9a-z]+$/);
    assert.equal(json.includes(oculto.reference), false, "un producto inactivo no aparece");
    assert.equal(json.includes(pub.wholesalePath!.split("/").pop()!), false, "el token mayorista no viaja al link detal");
    assert.equal(page.business.whatsapp, "573183715860");
  });

  it("mayor: exige el token exacto y muestra el precio mayor (o null si no existe)", async () => {
    const { dije, anillo } = await cargar();
    const pub = await admin.ensurePublication(DELACOUR);
    const token = pub.wholesalePath!.split("/").pop()!;
    assert.equal(await publico.getCatalog({ slug: pub.slug, context: "wholesale" }), null);
    assert.equal(await publico.getCatalog({ slug: pub.slug, context: "wholesale", token: newWholesaleToken() }), null);
    const page = await publico.getCatalog({ slug: pub.slug, context: "wholesale", token });
    assert.ok(page);
    assert.equal(page.products.find((p) => p.reference === dije.reference)?.price, 18_000);
    assert.equal(page.products.find((p) => p.reference === anillo.reference)?.price, null);
    const json = JSON.stringify(page);
    assert.equal(json.includes("35000"), false, "ningún precio detal en el link mayorista");
    assert.equal(json.includes("58000"), false, "sin precio mayor => 'a consultar', nunca el precio detal");
    assert.equal(json.includes(token), false, "el token no se repite dentro de los datos de la página");
  });

  it("regenerar el link mayorista invalida el anterior", async () => {
    await cargar();
    const antes = await admin.ensurePublication(DELACOUR);
    const tokenViejo = antes.wholesalePath!.split("/").pop()!;
    const despues = await admin.rotateWholesaleToken(DELACOUR);
    const tokenNuevo = despues.wholesalePath!.split("/").pop()!;
    assert.notEqual(tokenNuevo, tokenViejo);
    assert.equal(await publico.getCatalog({ slug: antes.slug, context: "wholesale", token: tokenViejo }), null);
    assert.ok(await publico.getCatalog({ slug: antes.slug, context: "wholesale", token: tokenNuevo }));
  });

  it("404 si el catálogo no existe, no está publicado o el módulo está apagado", async () => {
    await cargar();
    const pub = await admin.ensurePublication(DELACOUR);
    assert.equal(await publico.getCatalog({ slug: "no-existe", context: "retail" }), null);
    assert.equal(await publico.getCatalog({ slug: "../admin", context: "retail" }), null);
    mem.setPublished(DELACOUR.tenantId, false);
    assert.equal(await publico.getCatalog({ slug: pub.slug, context: "retail" }), null);
    mem.setPublished(DELACOUR.tenantId, true);
    mem.enableModule(DELACOUR.tenantId, false);
    assert.equal(await publico.getCatalog({ slug: pub.slug, context: "retail" }), null);
  });

  it("búsqueda, categoría y paginación desde la URL (entradas raras no rompen nada)", async () => {
    const cat = await admin.createCategory(DELACOUR, { name: "Dijes" });
    await admin.createProduct(DELACOUR, { name: "Dije luna", retailPrice: 20_000, categoryId: cat.id });
    for (let i = 0; i < 50; i++) await admin.createProduct(DELACOUR, { name: `Arete ${i}`, retailPrice: 10_000 });
    const pub = await admin.ensurePublication(DELACOUR);
    assert.equal((await publico.getCatalog({ slug: pub.slug, context: "retail", q: "luna" }))?.total, 1);
    assert.equal((await publico.getCatalog({ slug: pub.slug, context: "retail", categoryId: cat.id }))?.total, 1);
    const p1 = await publico.getCatalog({ slug: pub.slug, context: "retail" });
    const p2 = await publico.getCatalog({ slug: pub.slug, context: "retail", page: 2 });
    assert.equal(p1?.products.length, 48);
    assert.equal(p2?.products.length, 3);
    assert.equal((await publico.getCatalog({ slug: pub.slug, context: "retail", categoryId: "no-uuid" }))?.total, 51);
    assert.equal((await publico.getCatalog({ slug: pub.slug, context: "retail", page: -3 }))?.page, 1);
    assert.equal((await publico.getCatalog({ slug: pub.slug, context: "retail", q: "a,b)or(" }))?.total, 0);
  });
});

describe("URL pública de las fotos", () => {
  it("solo slug + referencia + versión opaca", () => {
    const ruta = "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4/11111111-2222-4333-8444-555555555555/99999999-aaaa-4bbb-8ccc-dddddddddddd.webp";
    const url = productImagePath("delacour", "DL-000184", "main", ruta);
    assert.match(url, /^\/catalogo\/delacour\/productos\/dl-000184\/main\.webp\?v=[0-9a-z]+$/);
    for (const id of ruta.replace(".webp", "").split("/")) assert.equal(url.includes(id), false);
    // Foto legada JPG de AMORE: la extensión real se conserva.
    assert.ok(productImagePath("amore", "DL-000001", "thumb", "t/p/foto.JPG").includes("/thumb.jpg?v="));
  });
  it("la versión cambia cuando cambia la foto y es estable para la misma", () => {
    assert.equal(imageVersion("a/b/c.webp"), imageVersion("a/b/c.webp"));
    assert.notEqual(imageVersion("a/b/c.webp"), imageVersion("a/b/d.webp"));
  });

  it("valida el nombre de archivo y la referencia de la URL", () => {
    assert.equal(parseImageFileName("main.webp"), "main");
    assert.equal(parseImageFileName("thumb.jpg"), "thumb");
    for (const malo of ["main.gif", "otra.webp", "../main.webp", "main.webp.exe", "MAIN.webp", ""]) assert.equal(parseImageFileName(malo), null, malo);
    assert.equal(referenceFromUrl("dl-000184"), "DL-000184");
    for (const malo of ["dl-1", "000184", "dl-000184;drop", "..%2f"]) assert.equal(referenceFromUrl(malo), null, malo);
  });
});

describe("ruta pública de imágenes", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let admin: ReturnType<typeof createCatalogService>;
  let publico: ReturnType<typeof createPublicCatalogService>;

  beforeEach(() => {
    mem = createInMemoryCatalogRepository();
    let n = 0;
    admin = createCatalogService({ repo: mem.repo, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
    publico = createPublicCatalogService({ repo: mem.repo });
    mem.setProfile(DELACOUR.tenantId, { name: "Delacour Joyería", whatsapp: "573183715860" });
    mem.enableModule(DELACOUR.tenantId);
  });

  async function productoConFoto() {
    const p = await admin.createProduct(DELACOUR, { name: "Dije corazón", retailPrice: 35_000, wholesalePrice: 18_000 });
    const ticket = await admin.requestImageUpload(DELACOUR, p.id, { mimeType: "image/webp", bytes: 10, thumbBytes: 10 });
    mem.putObject(ticket.image.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
    mem.putObject(ticket.thumb.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
    await admin.confirmImage(DELACOUR, p.id, { uploadId: ticket.uploadId, mimeType: "image/webp", width: 800, height: 800, makePrimary: true });
    const pub = await admin.ensurePublication(DELACOUR);
    return { p, pub, ticket };
  }

  it("sirve la foto principal y la miniatura de un producto activo", async () => {
    const { p, pub, ticket } = await productoConFoto();
    const main = await publico.getImage({ slug: pub.slug, reference: p.reference.toLowerCase(), kind: "main" });
    const thumb = await publico.getImage({ slug: pub.slug, reference: p.reference.toLowerCase(), kind: "thumb" });
    assert.equal(main?.contentType, "image/webp");
    assert.ok(thumb);
    assert.deepEqual(mem.opened, [ticket.image.path, ticket.thumb.path]);
  });

  it("404 si el producto está inactivo, no existe, es de otro catálogo o el catálogo no es visible", async () => {
    const { p, pub } = await productoConFoto();
    const ref = p.reference.toLowerCase();
    assert.equal(await publico.getImage({ slug: pub.slug, reference: "dl-999999", kind: "main" }), null);
    assert.equal(await publico.getImage({ slug: pub.slug, reference: "../../x", kind: "main" }), null);
    assert.equal(await publico.getImage({ slug: "otro-negocio", reference: ref, kind: "main" }), null);
    mem.setProfile(OTRO.tenantId, { name: "Otro negocio", whatsapp: null });
    mem.enableModule(OTRO.tenantId);
    const otro = await admin.ensurePublication(OTRO);
    assert.equal(await publico.getImage({ slug: otro.slug, reference: ref, kind: "main" }), null, "la referencia es por tenant");
    mem.setPublished(DELACOUR.tenantId, false);
    assert.equal(await publico.getImage({ slug: pub.slug, reference: ref, kind: "main" }), null);
    mem.setPublished(DELACOUR.tenantId, true);
    mem.enableModule(DELACOUR.tenantId, false);
    assert.equal(await publico.getImage({ slug: pub.slug, reference: ref, kind: "main" }), null);
    mem.enableModule(DELACOUR.tenantId, true);
    await admin.updateProduct(DELACOUR, p.id, { status: "INACTIVE" });
    assert.equal(await publico.getImage({ slug: pub.slug, reference: ref, kind: "main" }), null);
    assert.equal(mem.opened.length, 0, "nunca se abrió el Storage");
  });

  it("foto legada (foto_url) solo si vive en el bucket y en la carpeta del propio tenant", async () => {
    const p = await admin.createProduct(DELACOUR, { name: "Pieza legada", retailPrice: 10_000 });
    const pub = await admin.ensurePublication(DELACOUR);
    const stored = mem.auditTrail(p.id)!;
    const ref = p.reference.toLowerCase();

    const propia = `${DELACOUR.tenantId}/${p.id}/legada.jpg`;
    mem.putObject(propia, { size: 10, contentType: "image/jpeg", head: JPEG_HEAD });
    stored.primaryImage = { url: mem.repo.publicUrl(propia), thumbUrl: mem.repo.publicUrl(propia) };
    const page = await publico.getCatalog({ slug: pub.slug, context: "retail" });
    assert.match(page?.products[0].imageUrl ?? "", /\/productos\/dl-\d{6}\/main\.jpg\?v=/);
    assert.equal((await publico.getImage({ slug: pub.slug, reference: ref, kind: "main" }))?.contentType, "image/jpeg");

    const ajena = `${OTRO.tenantId}/${p.id}/ajena.jpg`;
    mem.putObject(ajena, { size: 10, contentType: "image/jpeg", head: JPEG_HEAD });
    stored.primaryImage = { url: mem.repo.publicUrl(ajena), thumbUrl: mem.repo.publicUrl(ajena) };
    assert.equal(await publico.getImage({ slug: pub.slug, reference: ref, kind: "main" }), null, "otra carpeta de tenant");

    stored.primaryImage = { url: "https://otro-sitio.test/foto.jpg", thumbUrl: "https://otro-sitio.test/foto.jpg" };
    assert.equal((await publico.getCatalog({ slug: pub.slug, context: "retail" }))?.products[0].imageUrl, null, "URL externa: sin foto");
    assert.equal(await publico.getImage({ slug: pub.slug, reference: ref, kind: "main" }), null);
  });
});
