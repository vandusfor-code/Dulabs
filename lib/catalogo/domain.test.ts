/**
 * Catálogo — reglas de dominio (puras, sin BD): referencia, precios, estados,
 * validación estricta de input, búsqueda, firma de imágenes y rutas de Storage.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_LIMITS,
  firstIssueMessage,
  formatReference,
  imageConfirmSchema,
  imageStoragePaths,
  imageUploadRequestSchema,
  isReference,
  normalizeSearch,
  priceFor,
  productCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
  sniffImageMime,
  categoryCreateSchema,
} from "@/lib/catalogo/domain";

describe("referencia comercial (espejo del formato de la BD)", () => {
  it("formatea con 6 dígitos mínimo y nunca trunca", () => {
    assert.equal(formatReference("DL", 1), "DL-000001");
    assert.equal(formatReference("DL", 184), "DL-000184");
    assert.equal(formatReference("DL", 999_999), "DL-999999");
    assert.equal(formatReference("DL", 1_000_000), "DL-1000000");
  });

  it("reconoce referencias válidas y rechaza el resto", () => {
    assert.ok(isReference("DL-000184"));
    assert.ok(isReference("DO-1000000"));
    for (const v of ["dl-000184", "DL-184", "DL000184", "DL-00018A", "", "TOOLONG-000001"]) assert.equal(isReference(v), false, v);
  });
});

describe("precios: un producto, dos contextos (nunca dos productos)", () => {
  const producto = { pricing: { retail: 35_000, wholesale: 18_000 } };
  it("devuelve el precio del contexto pedido", () => {
    assert.equal(priceFor(producto, "retail"), 35_000);
    assert.equal(priceFor(producto, "wholesale"), 18_000);
  });
  it("precio mayor no definido => null (nunca un 0 inventado)", () => {
    assert.equal(priceFor({ pricing: { retail: 35_000, wholesale: null } }, "wholesale"), null);
  });
});

describe("productCreateSchema", () => {
  const valido = { name: "  Dije corazón  ", retailPrice: 35_000, wholesalePrice: 18_000, material: "Oro laminado", color: "", description: "   " };

  it("normaliza: recorta, '' / espacios => null, precios enteros", () => {
    const r = productCreateSchema.parse(valido);
    assert.equal(r.name, "Dije corazón");
    assert.equal(r.color, null);
    assert.equal(r.description, null);
    assert.equal(r.material, "Oro laminado");
    assert.equal(r.wholesalePrice, 18_000);
  });

  it("RECHAZA cualquier intento de fijar la referencia, el id o el tenant (strict)", () => {
    for (const extra of [{ reference: "DL-000001" }, { referencia: "DL-000001" }, { id: "x" }, { tenantId: "t" }, { id_tenant: "t" }]) {
      const r = productCreateSchema.safeParse({ ...valido, ...extra });
      assert.equal(r.success, false, JSON.stringify(extra));
      if (!r.success) assert.match(firstIssueMessage(r.error), /Campo no permitido/);
    }
  });

  it("exige nombre y precio detal; precio mayor es opcional", () => {
    assert.equal(productCreateSchema.safeParse({ ...valido, name: "   " }).success, false);
    assert.equal(productCreateSchema.safeParse({ name: "X" }).success, false);
    const sinMayor = productCreateSchema.parse({ name: "X", retailPrice: 1000 });
    assert.equal(sinMayor.wholesalePrice, undefined);
  });

  it("precios: enteros COP, >= 0, con tope", () => {
    for (const retailPrice of [-1, 10.5, "35000", CATALOG_LIMITS.price + 1]) {
      assert.equal(productCreateSchema.safeParse({ name: "X", retailPrice }).success, false, String(retailPrice));
    }
    assert.equal(productCreateSchema.safeParse({ name: "X", retailPrice: 0 }).success, true);
  });

  it("respeta topes de texto", () => {
    assert.equal(productCreateSchema.safeParse({ name: "x".repeat(121), retailPrice: 1 }).success, false);
    assert.equal(productCreateSchema.safeParse({ name: "X", retailPrice: 1, material: "m".repeat(81) }).success, false);
  });

  it("categoryId debe ser UUID", () => {
    assert.equal(productCreateSchema.safeParse({ name: "X", retailPrice: 1, categoryId: "no-uuid" }).success, false);
    assert.equal(productCreateSchema.safeParse({ name: "X", retailPrice: 1, categoryId: "44444444-0000-4000-8000-000000000001" }).success, true);
  });
});

describe("productUpdateSchema", () => {
  it("permite cambios parciales, incluido el estado", () => {
    assert.deepEqual(productUpdateSchema.parse({ status: "INACTIVE" }), { status: "INACTIVE" });
    assert.equal(productUpdateSchema.parse({ wholesalePrice: null }).wholesalePrice, null);
  });
  it("rechaza un PATCH vacío, un estado inválido y la referencia", () => {
    assert.equal(productUpdateSchema.safeParse({}).success, false);
    assert.equal(productUpdateSchema.safeParse({ status: "DELETED" }).success, false);
    assert.equal(productUpdateSchema.safeParse({ reference: "DL-000002" }).success, false);
  });
});

describe("categoryCreateSchema", () => {
  it("recorta y exige 1..60 caracteres", () => {
    assert.equal(categoryCreateSchema.parse({ name: "  Dijes " }).name, "Dijes");
    assert.equal(categoryCreateSchema.safeParse({ name: "  " }).success, false);
    assert.equal(categoryCreateSchema.safeParse({ name: "x".repeat(61) }).success, false);
  });
});

describe("productListQuerySchema (llega como strings)", () => {
  it("aplica defaults y convierte números", () => {
    const d = productListQuerySchema.parse({});
    assert.equal(d.q, undefined);
    assert.equal(d.categoryId, undefined);
    assert.equal(d.status, "ALL");
    assert.equal(d.page, 1);
    assert.equal(d.pageSize, CATALOG_LIMITS.pageSizeDefault);
    const r = productListQuerySchema.parse({ q: " dije ", page: "3", pageSize: "12", status: "ACTIVE" });
    assert.equal(r.q, "dije");
    assert.equal(r.page, 3);
    assert.equal(r.pageSize, 12);
  });
  it("rechaza pageSize excesivo y estados desconocidos", () => {
    assert.equal(productListQuerySchema.safeParse({ pageSize: "500" }).success, false);
    assert.equal(productListQuerySchema.safeParse({ status: "DRAFT" }).success, false);
  });
});

describe("normalizeSearch — nunca rompe el filtro `or` de PostgREST", () => {
  it("elimina separadores, paréntesis y comodines", () => {
    assert.equal(normalizeSearch("dije,referencia.eq.x)"), "dije referencia.eq.x");
    assert.equal(normalizeSearch("100%_oro*"), "100 oro");
    assert.equal(normalizeSearch("a\\b:c\"d'e"), "a b c d e");
  });
  it("conserva referencias y colapsa espacios; vacío => undefined", () => {
    assert.equal(normalizeSearch("  DL-000184  "), "DL-000184");
    assert.equal(normalizeSearch(" ,() "), undefined);
    assert.equal(normalizeSearch(undefined), undefined);
  });
});

describe("imágenes", () => {
  it("rutas SIEMPRE bajo {tenant}/{producto}/ con la extensión del formato", () => {
    const p = imageStoragePaths("tenant-a", "prod-1", "u1", "image/webp");
    assert.deepEqual(p, { path: "tenant-a/prod-1/u1.webp", thumbPath: "tenant-a/prod-1/u1_thumb.webp" });
    assert.equal(imageStoragePaths("t", "p", "u", "image/jpeg").path, "t/p/u.jpg");
  });

  it("detecta la firma real (magic bytes) de WebP y JPEG; rechaza el resto", () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const html = new TextEncoder().encode("<html><script>");
    assert.equal(sniffImageMime(webp), "image/webp");
    assert.equal(sniffImageMime(jpeg), "image/jpeg");
    assert.equal(sniffImageMime(png), null);
    assert.equal(sniffImageMime(html), null);
    assert.equal(sniffImageMime(new Uint8Array()), null);
  });

  it("valida formato y tamaño declarados antes de emitir la subida", () => {
    assert.equal(imageUploadRequestSchema.safeParse({ mimeType: "image/webp", bytes: 500_000, thumbBytes: 40_000 }).success, true);
    assert.equal(imageUploadRequestSchema.safeParse({ mimeType: "image/gif", bytes: 1, thumbBytes: 1 }).success, false);
    assert.equal(imageUploadRequestSchema.safeParse({ mimeType: "image/webp", bytes: CATALOG_LIMITS.imageBytes + 1, thumbBytes: 1 }).success, false);
    assert.equal(imageUploadRequestSchema.safeParse({ mimeType: "image/webp", bytes: 1, thumbBytes: CATALOG_LIMITS.thumbBytes + 1 }).success, false);
  });

  it("la confirmación solo acepta un uploadId (nunca una ruta del cliente)", () => {
    const base = { uploadId: "11111111-0000-4000-8000-000000000001", mimeType: "image/webp", width: 1600, height: 1600 };
    assert.equal(imageConfirmSchema.parse(base).makePrimary, false);
    assert.equal(imageConfirmSchema.safeParse({ ...base, storagePath: "otro-tenant/x/y.webp" }).success, false);
    assert.equal(imageConfirmSchema.safeParse({ ...base, uploadId: "../../etc" }).success, false);
  });
});
