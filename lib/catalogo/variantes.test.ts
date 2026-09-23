/**
 * Variantes de imagen del catálogo: original optimizado (≤ 2048), detalle
 * (≤ 1200, ficha) y miniatura (≤ 400, tarjetas). Sin red ni BD.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CATALOG_LIMITS, detailPathOf, imageStoragePaths, imageUploadRequestSchema } from "@/lib/catalogo/domain";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository, JPEG_HEAD, WEBP_HEAD } from "@/lib/catalogo/testing/in-memory-repository";

const DELACOUR: CatalogActor = { tenantId: "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4", userId: "admin" };

describe("rutas de las variantes", () => {
  it("detalle por convención junto a la principal (sin columna nueva)", () => {
    const p = imageStoragePaths("t", "p", "u", "image/webp");
    assert.deepEqual(p, { path: "t/p/u.webp", thumbPath: "t/p/u_thumb.webp", detailPath: "t/p/u_detail.webp" });
    assert.equal(detailPathOf("t/p/u.jpg"), "t/p/u_detail.jpg");
    assert.equal(detailPathOf("t/sin-extension"), "t/sin-extension_detail");
    assert.equal(detailPathOf("t.v2/foto"), "t.v2/foto_detail", "un punto en la carpeta no es la extensión");
  });

  it("tamaños acordes al uso: detalle mucho más liviano que el original", () => {
    assert.ok(CATALOG_LIMITS.detailMaxSide < CATALOG_LIMITS.imageMaxSide && CATALOG_LIMITS.thumbMaxSide < CATALOG_LIMITS.detailMaxSide);
    assert.ok(CATALOG_LIMITS.detailBytes <= CATALOG_LIMITS.imageBytes / 4);
    assert.equal(imageUploadRequestSchema.safeParse({ mimeType: "image/webp", bytes: 10, thumbBytes: 10 }).success, true, "clientes anteriores (sin detalle) siguen funcionando");
    assert.equal(imageUploadRequestSchema.safeParse({ mimeType: "image/webp", bytes: 10, thumbBytes: 10, detailBytes: CATALOG_LIMITS.detailBytes + 1 }).success, false);
  });
});

describe("subida y tienda con variantes", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let admin: ReturnType<typeof createCatalogService>;
  let publico: ReturnType<typeof createPublicCatalogService>;
  let slug: string;

  beforeEach(async () => {
    mem = createInMemoryCatalogRepository();
    admin = createCatalogService({ repo: mem.repo });
    publico = createPublicCatalogService({ repo: mem.repo });
    mem.setProfile(DELACOUR.tenantId, { name: "Delacour", whatsapp: "573000000000" });
    mem.enableModule(DELACOUR.tenantId);
    slug = (await admin.ensurePublication(DELACOUR)).slug;
  });

  async function subir(productId: string, opts: { detail: "ok" | "invalida" | "ninguna" }) {
    const t = await admin.requestImageUpload(DELACOUR, productId, { mimeType: "image/webp", bytes: 10, thumbBytes: 10, ...(opts.detail !== "ninguna" ? { detailBytes: 10 } : {}) });
    mem.putObject(t.image.path, { size: 900_000, contentType: "image/webp", head: WEBP_HEAD });
    mem.putObject(t.thumb.path, { size: 20_000, contentType: "image/webp", head: WEBP_HEAD });
    if (opts.detail === "ok") mem.putObject(t.detail!.path, { size: 150_000, contentType: "image/webp", head: WEBP_HEAD });
    if (opts.detail === "invalida") mem.putObject(t.detail!.path, { size: 150_000, contentType: "image/webp", head: JPEG_HEAD });
    await admin.confirmImage(DELACOUR, productId, { uploadId: t.uploadId, mimeType: "image/webp", width: 1600, height: 1600, makePrimary: true });
    return t;
  }

  it("con detalle: la ficha y la vista previa usan la variante de 1200 px, no el original", async () => {
    const p = await admin.createProduct(DELACOUR, { name: "Anillo", retailPrice: 1000, stock: 2 });
    const t = await subir(p.id, { detail: "ok" });
    assert.ok(t.detail, "se emite URL firmada para el detalle");
    const ficha = await publico.getProduct({ slug, reference: p.reference });
    assert.match(ficha!.gallery[0].detailUrl, /\/detail\.webp\?v=/);
    assert.match(ficha!.detailUrl!, /\/detail\.webp\?v=/);
    assert.match(ficha!.thumbUrl!, /\/thumb\.webp\?v=/);
    await publico.getImage({ slug, reference: p.reference.toLowerCase(), file: { index: 1, variant: "detail" } });
    assert.deepEqual(mem.opened, [t.detail!.path], "sirve el detalle (150 KB), no el original (900 KB)");
  });

  it("foto anterior sin detalle (o de AMORE): la ruta de detalle sirve la principal", async () => {
    const p = await admin.createProduct(DELACOUR, { name: "Aretes", retailPrice: 1000, stock: 2 });
    const t = await subir(p.id, { detail: "ninguna" });
    assert.equal(t.detail, undefined);
    const img = await publico.getImage({ slug, reference: p.reference.toLowerCase(), file: { index: 1, variant: "detail" } });
    assert.ok(img);
    assert.deepEqual(mem.opened, [t.image.path]);
  });

  it("detalle inválido: se descarta SOLO el detalle; la foto se registra igual", async () => {
    const p = await admin.createProduct(DELACOUR, { name: "Dije", retailPrice: 1000, stock: 2 });
    const t = await subir(p.id, { detail: "invalida" });
    assert.equal(mem.hasObject(t.detail!.path), false);
    assert.equal(mem.hasObject(t.image.path), true);
    assert.equal((await admin.getProduct(DELACOUR, p.id)).images.length, 1);
  });

  it("borrar la foto borra también su variante de detalle", async () => {
    const p = await admin.createProduct(DELACOUR, { name: "Collar", retailPrice: 1000, stock: 2 });
    const t = await subir(p.id, { detail: "ok" });
    const [img] = (await admin.getProduct(DELACOUR, p.id)).images;
    await admin.deleteImage(DELACOUR, img.id);
    assert.ok(mem.removed.includes(t.detail!.path));
  });
});
