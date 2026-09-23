/**
 * Catálogo — casos de uso contra un repositorio EN MEMORIA (sin red ni BD):
 * creación con referencia de la BD, aislamiento por tenant, categorías,
 * estados, búsqueda/paginación y el flujo completo de imágenes (rutas del
 * servidor, verificación de firma/tamaño, idempotencia, límite, borrado).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CATALOG_LIMITS, productListQuerySchema } from "@/lib/catalogo/domain";
import { CatalogError } from "@/lib/catalogo/errors";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository, JPEG_HEAD, WEBP_HEAD } from "@/lib/catalogo/testing/in-memory-repository";

const DELACOUR: CatalogActor = { tenantId: "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4", userId: "user-admin" };
const OTRO: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-000000000002", userId: "user-otro" };

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let service: ReturnType<typeof createCatalogService>;
let uploadIds: string[];

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  uploadIds = [];
  let n = 0;
  service = createCatalogService({
    repo: mem.repo,
    newId: () => {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      uploadIds.push(id);
      return id;
    },
  });
});

const query = (q: Record<string, string> = {}) => productListQuerySchema.parse(q);

async function crear(actor: CatalogActor, name: string, extra: Partial<{ retailPrice: number; wholesalePrice: number | null; categoryId: string | null }> = {}) {
  return service.createProduct(actor, { name, retailPrice: extra.retailPrice ?? 35_000, wholesalePrice: extra.wholesalePrice ?? null, categoryId: extra.categoryId ?? null });
}

async function rejects(p: Promise<unknown>, code: CatalogError["code"]) {
  await assert.rejects(p, (err: unknown) => err instanceof CatalogError && err.code === code);
}

describe("crear productos", () => {
  it("la referencia la asigna la capa de datos, secuencial y única por tenant", async () => {
    const a = await crear(DELACOUR, "Dije corazón", { retailPrice: 35_000, wholesalePrice: 18_000 });
    const b = await crear(DELACOUR, "Anillo solitario");
    const otro = await crear(OTRO, "Otro negocio");
    assert.equal(a.reference, "DL-000001");
    assert.equal(b.reference, "DL-000002");
    assert.equal(otro.reference, "DL-000001", "cada tenant tiene su propia secuencia");
    assert.deepEqual(a.pricing, { retail: 35_000, wholesale: 18_000 });
    assert.equal(a.status, "ACTIVE");
    assert.equal(a.tracksStock, false, "el Catálogo no controla inventario");
  });

  it("muchos productos creados en paralelo nunca repiten referencia", async () => {
    const creados = await Promise.all(Array.from({ length: 50 }, (_, i) => crear(DELACOUR, `Joya ${i}`)));
    assert.equal(new Set(creados.map((p) => p.reference)).size, 50);
  });

  it("la categoría debe ser del MISMO tenant", async () => {
    const ajena = await service.createCategory(OTRO, { name: "Dijes" });
    await rejects(crear(DELACOUR, "X", { categoryId: ajena.id }), "VALIDATION_ERROR");
    const propia = await service.createCategory(DELACOUR, { name: "Dijes" });
    const p = await crear(DELACOUR, "Y", { categoryId: propia.id });
    assert.equal(p.categoryName, "Dijes", "se sincroniza el texto legado `categoria`");
  });

  it("categorías únicas por tenant (sin distinguir mayúsculas)", async () => {
    await service.createCategory(DELACOUR, { name: "Aretes" });
    await rejects(service.createCategory(DELACOUR, { name: "aretes" }), "CONFLICT");
    await service.createCategory(OTRO, { name: "Aretes" });
  });
});

describe("aislamiento por tenant", () => {
  it("un tenant no puede leer, editar ni subir imágenes a productos de otro", async () => {
    const p = await crear(OTRO, "Privado");
    await rejects(service.getProduct(DELACOUR, p.id), "NOT_FOUND");
    await rejects(service.updateProduct(DELACOUR, p.id, { name: "hackeado" }), "NOT_FOUND");
    await rejects(service.requestImageUpload(DELACOUR, p.id, { mimeType: "image/webp", bytes: 10, thumbBytes: 10 }), "NOT_FOUND");
    const lista = await service.listProducts(DELACOUR, query());
    assert.equal(lista.total, 0);
  });
});

describe("editar y estados", () => {
  it("actualiza solo lo enviado y conserva la referencia", async () => {
    const p = await crear(DELACOUR, "Dije", { retailPrice: 35_000 });
    const e = await service.updateProduct(DELACOUR, p.id, { wholesalePrice: 18_000, material: "Oro laminado" });
    assert.equal(e.reference, p.reference);
    assert.equal(e.name, "Dije");
    assert.deepEqual(e.pricing, { retail: 35_000, wholesale: 18_000 });
    assert.equal(e.material, "Oro laminado");
  });

  it("desactivar no borra: el producto sigue existiendo y se puede reactivar", async () => {
    const p = await crear(DELACOUR, "Dije");
    await service.updateProduct(DELACOUR, p.id, { status: "INACTIVE" });
    assert.equal((await service.getProduct(DELACOUR, p.id)).status, "INACTIVE");
    assert.equal((await service.listProducts(DELACOUR, query({ status: "ACTIVE" }))).total, 0);
    assert.equal((await service.listProducts(DELACOUR, query({ status: "INACTIVE" }))).total, 1);
    await service.updateProduct(DELACOUR, p.id, { status: "ACTIVE" });
    assert.equal((await service.getProduct(DELACOUR, p.id)).status, "ACTIVE");
  });

  it("quitar la categoría limpia también el texto legado", async () => {
    const c = await service.createCategory(DELACOUR, { name: "Dijes" });
    const p = await crear(DELACOUR, "Dije", { categoryId: c.id });
    const e = await service.updateProduct(DELACOUR, p.id, { categoryId: null });
    assert.equal(e.categoryId, null);
    assert.equal(e.categoryName, null);
  });
});

describe("búsqueda y paginación", () => {
  it("busca por nombre o referencia, sin distinguir mayúsculas", async () => {
    await crear(DELACOUR, "Dije corazón");
    const b = await crear(DELACOUR, "Anillo");
    assert.equal((await service.listProducts(DELACOUR, query({ q: "CORAZ" }))).total, 1);
    const porRef = await service.listProducts(DELACOUR, query({ q: b.reference }));
    assert.deepEqual(porRef.items.map((p) => p.id), [b.id]);
  });

  it("pagina con offset correcto y total real", async () => {
    for (let i = 0; i < 30; i++) await crear(DELACOUR, `Joya ${i}`);
    const p1 = await service.listProducts(DELACOUR, query({ page: "1", pageSize: "24" }));
    const p2 = await service.listProducts(DELACOUR, query({ page: "2", pageSize: "24" }));
    assert.equal(p1.total, 30);
    assert.equal(p1.items.length, 24);
    assert.equal(p2.items.length, 6);
    assert.equal(new Set([...p1.items, ...p2.items].map((p) => p.id)).size, 30);
  });
});

describe("imágenes", () => {
  async function subir(productId: string, opts: { mime?: "image/webp" | "image/jpeg"; head?: Uint8Array; size?: number; thumb?: boolean; makePrimary?: boolean } = {}) {
    const mime = opts.mime ?? "image/webp";
    const ticket = await service.requestImageUpload(DELACOUR, productId, { mimeType: mime, bytes: 500_000, thumbBytes: 40_000 });
    mem.putObject(ticket.image.path, { size: opts.size ?? 500_000, contentType: mime, head: opts.head ?? (mime === "image/webp" ? WEBP_HEAD : JPEG_HEAD) });
    if (opts.thumb !== false) mem.putObject(ticket.thumb.path, { size: 40_000, contentType: mime, head: mime === "image/webp" ? WEBP_HEAD : JPEG_HEAD });
    const image = await service.confirmImage(DELACOUR, productId, { uploadId: ticket.uploadId, mimeType: mime, width: 1600, height: 1600, makePrimary: opts.makePrimary ?? false });
    return { ticket, image };
  }

  it("el servidor decide la ruta: siempre bajo {tenant}/{producto}/", async () => {
    const p = await crear(DELACOUR, "Dije");
    const ticket = await service.requestImageUpload(DELACOUR, p.id, { mimeType: "image/webp", bytes: 1, thumbBytes: 1 });
    assert.ok(ticket.image.path.startsWith(`${DELACOUR.tenantId}/${p.id}/`));
    assert.ok(ticket.thumb.path.endsWith("_thumb.webp"));
    assert.equal(ticket.bucket, "inventario-productos");
  });

  it("primera imagen => principal; la miniatura alimenta el listado; el detalle trae todas", async () => {
    const p = await crear(DELACOUR, "Dije");
    const { image } = await subir(p.id);
    assert.equal(image.isPrimary, true);
    assert.ok(image.thumbUrl.endsWith("_thumb.webp"));
    const segunda = (await subir(p.id)).image;
    assert.equal(segunda.isPrimary, false);
    const lista = await service.listProducts(DELACOUR, query());
    assert.equal(lista.items[0].primaryImage?.thumbUrl, image.thumbUrl);
    const detalle = await service.getProduct(DELACOUR, p.id);
    assert.equal(detalle.images.length, 2);
    assert.equal(detalle.primaryImage?.url, image.url, "el agente obtendrá la URL real de la principal");
  });

  it("rechaza un archivo que no es imagen (firma real) y borra lo subido", async () => {
    const p = await crear(DELACOUR, "Dije");
    await rejects(subir(p.id, { head: new TextEncoder().encode("<html><script>alert(1)") }), "IMAGE_INVALID");
    assert.equal(mem.removed.length, 2, "imagen y miniatura eliminadas de Storage");
    assert.equal((await service.getProduct(DELACOUR, p.id)).images.length, 0);
  });

  it("rechaza un formato distinto al declarado", async () => {
    const p = await crear(DELACOUR, "Dije");
    await rejects(subir(p.id, { mime: "image/webp", head: JPEG_HEAD }), "IMAGE_INVALID");
  });

  it("rechaza imágenes más grandes que el tope aunque el cliente declare otra cosa", async () => {
    const p = await crear(DELACOUR, "Dije");
    await rejects(subir(p.id, { size: CATALOG_LIMITS.imageBytes + 1 }), "IMAGE_INVALID");
  });

  it("confirmar sin haber subido => IMAGE_INVALID", async () => {
    const p = await crear(DELACOUR, "Dije");
    const ticket = await service.requestImageUpload(DELACOUR, p.id, { mimeType: "image/webp", bytes: 1, thumbBytes: 1 });
    await rejects(service.confirmImage(DELACOUR, p.id, { uploadId: ticket.uploadId, mimeType: "image/webp", width: 10, height: 10, makePrimary: false }), "IMAGE_INVALID");
  });

  it("un uploadId de OTRO producto no permite adjuntar su archivo (la ruta se recalcula)", async () => {
    const a = await crear(DELACOUR, "A");
    const b = await crear(DELACOUR, "B");
    const ticketA = await service.requestImageUpload(DELACOUR, a.id, { mimeType: "image/webp", bytes: 1, thumbBytes: 1 });
    mem.putObject(ticketA.image.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
    await rejects(service.confirmImage(DELACOUR, b.id, { uploadId: ticketA.uploadId, mimeType: "image/webp", width: 10, height: 10, makePrimary: false }), "IMAGE_INVALID");
  });

  it("confirmar dos veces la misma subida es idempotente", async () => {
    const p = await crear(DELACOUR, "Dije");
    const { ticket, image } = await subir(p.id);
    const otra = await service.confirmImage(DELACOUR, p.id, { uploadId: ticket.uploadId, mimeType: "image/webp", width: 1600, height: 1600, makePrimary: false });
    assert.equal(otra.id, image.id);
    assert.equal((await service.getProduct(DELACOUR, p.id)).images.length, 1);
  });

  it("makePrimary reemplaza la principal; borrar la principal promueve la siguiente", async () => {
    const p = await crear(DELACOUR, "Dije");
    const primera = (await subir(p.id)).image;
    const nueva = (await subir(p.id, { makePrimary: true })).image;
    let detalle = await service.getProduct(DELACOUR, p.id);
    assert.deepEqual(detalle.images.filter((i) => i.isPrimary).map((i) => i.id), [nueva.id]);
    await service.deleteImage(DELACOUR, nueva.id);
    detalle = await service.getProduct(DELACOUR, p.id);
    assert.deepEqual(detalle.images.map((i) => [i.id, i.isPrimary]), [[primera.id, true]]);
    assert.ok(mem.removed.some((path) => path.includes(uploadIds[1])), "los objetos de Storage se borran");
  });

  it("límite de imágenes por producto", async () => {
    const p = await crear(DELACOUR, "Dije");
    for (let i = 0; i < CATALOG_LIMITS.imagesPerProduct; i++) await subir(p.id);
    await rejects(service.requestImageUpload(DELACOUR, p.id, { mimeType: "image/webp", bytes: 1, thumbBytes: 1 }), "LIMIT_REACHED");
  });

  it("borrar una imagen de otro tenant => NOT_FOUND", async () => {
    const p = await crear(DELACOUR, "Dije");
    const { image } = await subir(p.id);
    await rejects(service.deleteImage(OTRO, image.id), "NOT_FOUND");
    assert.equal((await service.getProduct(DELACOUR, p.id)).images.length, 1);
  });
});
