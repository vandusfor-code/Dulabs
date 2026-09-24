/**
 * Bloque 20 — la ruta pública de fotos solo sirve la URL CANÓNICA. Una `v` distinta (vieja,
 * ausente, inventada) o una referencia/extensión con otra forma redirige a la canónica SIN abrir
 * Storage ni convertir a JPEG: nadie puede evitar el CDN para forzar descargas o conversiones.
 * Sin red ni BD (repositorio en memoria; conversión espiada).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { responderFoto, type FotoDeps } from "@/lib/catalogo/foto-http";
import { createCatalogService, createPublicCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository, WEBP_HEAD } from "@/lib/catalogo/testing/in-memory-repository";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin" };
const ORIGEN = "https://tienda.test";

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let conversiones: number;
let deps: FotoDeps;
let slug: string;
let ref: string;
let urls: { imageUrl: string; thumbUrl: string; detailUrl: string };

async function subir(actor: CatalogActor, productId: string) {
  const t = await admin.requestImageUpload(actor, productId, { mimeType: "image/webp", bytes: 10, thumbBytes: 10, detailBytes: 10 });
  mem.putObject(t.image.path, { size: 900_000, contentType: "image/webp", head: WEBP_HEAD });
  mem.putObject(t.thumb.path, { size: 20_000, contentType: "image/webp", head: WEBP_HEAD });
  mem.putObject(t.detail!.path, { size: 150_000, contentType: "image/webp", head: WEBP_HEAD });
  await admin.confirmImage(actor, productId, { uploadId: t.uploadId, mimeType: "image/webp", width: 1600, height: 1600, makePrimary: true });
}

/** GET de la ruta pública con la URL tal como la pediría el navegador o Meta. */
function pedir(path: string) {
  const [pathname] = path.split("?");
  const partes = pathname.split("/");
  return responderFoto(new Request(ORIGEN + path), { slug: partes[2], referencia: partes[4], archivo: partes[5] }, deps);
}

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  const publico = createPublicCatalogService({ repo: mem.repo });
  conversiones = 0;
  deps = {
    servicio: () => publico,
    aJpeg: async (body) => {
      conversiones++;
      await body.cancel().catch(() => {});
      return Buffer.from([0xff, 0xd8, 0xff]);
    },
  };
  for (const [actor, nombre] of [[A, "Joyería A"], [B, "Joyería B"]] as const) {
    mem.setProfile(actor.tenantId, { name: nombre, whatsapp: "573000000000" });
    mem.enableModule(actor.tenantId);
  }
  slug = (await admin.ensurePublication(A)).slug;
  await admin.ensurePublication(B);
  const p = await admin.createProduct(A, { name: "Anillo Luna", retailPrice: 1000, stock: 2 });
  await subir(A, p.id);
  ref = p.reference;
  const ficha = await publico.getProduct({ slug, reference: ref });
  urls = { imageUrl: ficha!.imageUrl!, thumbUrl: ficha!.thumbUrl!, detailUrl: ficha!.detailUrl! };
  mem.opened.length = 0;
});

describe("fotos públicas: solo la URL canónica", () => {
  it("las URLs que publica la tienda se sirven (200, caché larga) y abren la variante correcta", async () => {
    for (const url of [urls.imageUrl, urls.thumbUrl, urls.detailUrl]) {
      const r = await pedir(url);
      assert.equal(r.status, 200, url);
      assert.match(r.headers.get("cache-control") ?? "", /s-maxage=86400/);
      await r.body?.cancel();
    }
    assert.equal(mem.opened.length, 3);
  });

  it("v inventada, ausente o vieja: 307 a la canónica sin abrir Storage", async () => {
    const base = urls.thumbUrl.split("?")[0];
    for (const url of [`${base}?v=inventada`, base, `${base}?v=${"x".repeat(500)}`, `${base}?v=abc&v=def`]) {
      const r = await pedir(url);
      assert.equal(r.status, 307, url);
      assert.equal(r.headers.get("location"), urls.thumbUrl);
      assert.match(r.headers.get("cache-control") ?? "", /s-maxage=60/);
    }
    assert.equal(mem.opened.length, 0, "ninguna lectura de Storage");
  });

  it("whatsapp.jpg con v aleatoria: redirige sin convertir; con la canónica convierte una vez", async () => {
    const canonica = `/catalogo/${slug}/productos/${ref.toLowerCase()}/whatsapp.jpg?v=${new URL(ORIGEN + urls.imageUrl).searchParams.get("v")}`;
    for (let i = 0; i < 20; i++) {
      const r = await pedir(`/catalogo/${slug}/productos/${ref.toLowerCase()}/whatsapp.jpg?v=bust${i}`);
      assert.equal(r.status, 307);
      assert.equal(r.headers.get("location"), canonica);
    }
    assert.equal(conversiones, 0);
    assert.equal(mem.opened.length, 0);
    const ok = await pedir(canonica);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/jpeg");
    assert.equal(conversiones, 1);
  });

  it("otra forma de la misma foto (mayúsculas, otra extensión) redirige a la canónica, no la sirve", async () => {
    const [path, qs] = urls.imageUrl.split("?");
    const mayus = path.replace(ref.toLowerCase(), ref) + "?" + qs;
    const jpg = path.replace(/\.webp$/, ".jpg") + "?" + qs;
    for (const url of [mayus, jpg]) {
      const r = await pedir(url);
      assert.equal(r.status, 307, url);
      assert.equal(r.headers.get("location"), urls.imageUrl);
    }
    assert.equal(mem.opened.length, 0);
  });

  it("404 idéntico para lo que no existe o no es público, sin redirigir ni abrir Storage", async () => {
    const v = new URL(ORIGEN + urls.imageUrl).searchParams.get("v");
    const casos = [
      `/catalogo/${slug}/productos/dl-999999/main.webp?v=${v}`,
      `/catalogo/${slug}/productos/${ref.toLowerCase()}/7.webp?v=${v}`,
      `/catalogo/${slug}/productos/${ref.toLowerCase()}/secreto.txt`,
      `/catalogo/no-existe/productos/${ref.toLowerCase()}/main.webp?v=${v}`,
    ];
    // La misma referencia en OTRO negocio: nunca la foto de A.
    const slugB = (await admin.ensurePublication(B)).slug;
    casos.push(`/catalogo/${slugB}/productos/${ref.toLowerCase()}/main.webp?v=${v}`);
    for (const url of casos) {
      const r = await pedir(url);
      assert.equal(r.status, 404, url);
      assert.equal(r.headers.get("location"), null);
    }
    const producto = (await admin.listProducts(A, { q: undefined, page: 1, pageSize: 10, status: "ALL" })).items[0];
    await admin.updateProduct(A, producto.id, { status: "INACTIVE" });
    assert.equal((await pedir(urls.imageUrl)).status, 404, "producto inactivo");
    assert.equal(mem.opened.length, 0);
  });
});

describe("carga de las fotos de la tienda (móvil)", () => {
  it("solo las 4 primeras (visibles al abrir en un celular) van de inmediato; la primera fila con prioridad alta; el resto diferidas", async () => {
    const { cargaDeFoto, FOTOS_INMEDIATAS } = await import("@/lib/catalogo/publicacion");
    assert.equal(FOTOS_INMEDIATAS, 4);
    assert.deepEqual([0, 1, 2, 3, 4, 47].map(cargaDeFoto), [
      { loading: "eager", fetchPriority: "high" },
      { loading: "eager", fetchPriority: "high" },
      { loading: "eager", fetchPriority: "auto" },
      { loading: "eager", fetchPriority: "auto" },
      { loading: "lazy", fetchPriority: "auto" },
      { loading: "lazy", fetchPriority: "auto" },
    ]);
    assert.deepEqual(cargaDeFoto(undefined), { loading: "lazy", fetchPriority: "auto" }, "sin posición (otros usos): diferida");
  });
});
