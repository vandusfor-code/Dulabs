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
import { isValidSlug, slugCandidates, slugify, toPublicProduct, whatsappOrderLink } from "@/lib/catalogo/publicacion";
import { createCatalogService, createPublicCatalogService, newWholesaleToken, tokensMatch, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository, WEBP_HEAD } from "@/lib/catalogo/testing/in-memory-repository";

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
    assert.ok(page.products.find((p) => p.reference === dije.reference)?.thumbUrl?.endsWith("_thumb.webp"));
    const json = JSON.stringify(page);
    assert.equal(json.includes("18000"), false, "ningún precio mayorista en el link detal");
    // Las URLs de imagen llevan la ruta de Storage {tenant}/{producto}/… (convención
    // del bucket, igual que la tienda de AMORE; ningún endpoint autoriza con esos
    // UUID). Fuera de las URLs, la proyección no expone ids internos.
    const sinUrls = JSON.stringify(page.products.map((p) => ({ ...p, imageUrl: null, thumbUrl: null })));
    assert.equal(sinUrls.includes(dije.id), false);
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
