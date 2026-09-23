/**
 * Fase 5 — flujo COMPLETO de la carga masiva con fotos, de punta a punta:
 * análisis (servidor) -> preview congelado -> lotes -> fotos con variantes
 * -> resultado. Con el servicio REAL sobre el repositorio en memoria: ni red
 * ni Supabase.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogImportService } from "@/lib/catalogo/import/servicio";
import { estimateRemainingMs, formatRemaining, runImport, type ImportRunDeps, type ImportRunInput } from "@/lib/catalogo/import/proceso";
import { summarizeImport } from "@/lib/catalogo/import/resultado";
import { finalOutcome } from "@/lib/catalogo/import/estados";
import type { ImageInfo, ImportAnalysis, RawRow } from "@/lib/catalogo/import/types";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository, WEBP_HEAD } from "@/lib/catalogo/testing/in-memory-repository";

const DELACOUR: CatalogActor = { tenantId: "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4", userId: "admin" };
const OTRO: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-000000000002", userId: "otro" };

const img = (id: string, over: Partial<ImageInfo> = {}): ImageInfo => ({ id, name: id.split("/").pop()!, size: 80_000, width: 1600, height: 1600, problem: null, ...over });
const row = (n: number, values: RawRow["values"]): RawRow => ({ row: n, values: { retailPrice: "10000", stock: "3", ...values } });

type Ticket = { uploadId: string; image: { path: string }; thumb: { path: string }; detail?: { path: string } };

describe("fase 5: carga masiva con fotos de punta a punta", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let catalog: ReturnType<typeof createCatalogService>;
  let imports: ReturnType<typeof createCatalogImportService>;
  let bodies: Array<{ rows: RawRow[]; images: ImageInfo[] }>;
  let broken: Set<string>;
  let uploadFails: Set<string>;

  beforeEach(() => {
    mem = createInMemoryCatalogRepository();
    catalog = createCatalogService({ repo: mem.repo });
    imports = createCatalogImportService({ repo: mem.repo, catalog });
    bodies = [];
    broken = new Set();
    uploadFails = new Set();
  });

  function deps(actor: CatalogActor = DELACOUR): ImportRunDeps<Ticket> {
    const ok = <T,>(data: T) => ({ ok: true as const, data });
    return {
      startImport: async (fileName, totalRows) => ok({ import: await imports.start(actor, { fileName, totalRows }) }),
      importRows: async (id, body) => {
        bodies.push({ rows: body.rows, images: body.images });
        return ok({ results: await imports.createRows(actor, id, body) });
      },
      photoUrls: async (id, items) => ok({ results: (await imports.photoUploadUrls(actor, id, items)) as never }),
      confirmPhotos: async (id, items) => ok({ results: await imports.confirmPhotos(actor, id, items) }),
      finishImport: async (id, counts) => ok({ import: await imports.finish(actor, id, counts) }),
      prepare: async (file) => {
        if (broken.has(file.name)) throw new Error("No pudimos leer esta imagen. Usa una foto JPG, PNG o WEBP.");
        return { image: new Blob([new Uint8Array(10)]), thumb: new Blob([new Uint8Array(10)]), detail: new Blob([new Uint8Array(10)]), mimeType: "image/webp", width: 1600, height: 1600 };
      },
      upload: async (ticket) => {
        if (uploadFails.size > 0 && [...uploadFails].some((n) => ticket.image.path.includes(n))) return { ok: false, error: { code: "NETWORK_ERROR", message: "Sin conexión.", status: 0 } };
        for (const p of [ticket.image.path, ticket.thumb.path, ticket.detail?.path]) if (p) mem.putObject(p, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
        return ok(null);
      },
      imageFile: (id) => new File([new Uint8Array(10)], id.split("/").pop()!),
      sleep: async () => {},
    };
  }

  /** Lo que hace la pantalla: analizar en el servidor, congelar el preview y procesar por lotes. */
  async function importar(rows: RawRow[], images: ImageInfo[], opts: { attach?: boolean; actor?: CatalogActor } = {}) {
    const actor = opts.actor ?? DELACOUR;
    let analysis: ImportAnalysis = await imports.analyze(actor, { rows, images, decisions: {}, force: [] });
    const attach = opts.attach ? analysis.rows.filter((r) => r.duplicateOf?.kind === "catalog" && r.duplicateOf.canAttach && r.images.length > 0).map((r) => r.row) : [];
    if (attach.length > 0) analysis = await imports.analyze(actor, { rows, images, decisions: {}, force: [], attach });
    const reviewed = new Map(analysis.rows.filter((r) => r.status === "ready" || r.status === "warning" || r.attach).map((r) => [r.row, r]));
    const input: ImportRunInput = {
      fileName: "productos.xlsx",
      rows: rows.filter((r) => reviewed.has(r.row)).map((r) => ({ ...r, photos: reviewed.get(r.row)!.images.flatMap((m) => (m.file ? [m.file] : [])) })),
      images,
      decisions: {},
      force: [],
      attach,
    };
    const report = await runImport(input, deps(actor), () => {});
    return { analysis, report, summary: summarizeImport(analysis, report) };
  }

  const fotosDe = async (productId: string) => (await catalog.getProduct(DELACOUR, productId)).images;

  it("1 producto, 1 foto (detectada por nombre): principal con sus TRES variantes", async () => {
    const { report, summary } = await importar([row(2, { name: "Anillo Corazón" })], [img("Fotos/anillo-corazon.jpg")]);
    const [r] = report.rows;
    assert.equal(r.status, "created");
    assert.match(r.reference!, /^DL-\d{6}$/, "la referencia la asigna el backend");
    const fotos = await fotosDe(r.productId!);
    assert.equal(fotos.length, 1);
    assert.equal(fotos[0].isPrimary, true);
    const path = mem.signedPaths.find((p) => p.endsWith("_detail.webp"));
    assert.ok(path, "la carga masiva también genera la variante de detalle (1200 px)");
    assert.deepEqual([summary.found, summary.created, summary.photosProcessed, summary.needAttention], [1, 1, 1, 0]);
  });

  it("1 producto, varias fotos: la primera es la principal; las demás, galería en orden", async () => {
    const { report } = await importar([row(2, { name: "Aretes Perla" })], [img("aretes-perla-3.jpg"), img("aretes-perla.jpg"), img("aretes-perla-2.jpg")]);
    const fotos = await fotosDe(report.rows[0].productId!);
    assert.equal(fotos.length, 3);
    assert.deepEqual(
      fotos.map((f) => f.isPrimary),
      [true, false, false],
    );
    assert.equal(report.photosUploaded, 3);
  });

  it("100 productos: lotes de 20, cada lote lleva SOLO los metadatos de sus fotos", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 2, { name: `Pieza ${i + 1}` }));
    const images = rows.flatMap((_, i) => [img(`pieza-${i + 1}.jpg`), img(`pieza-${i + 1}-2.jpg`)]);
    const { report, summary } = await importar(rows, images);
    assert.equal(bodies.length, 5);
    assert.ok(bodies.every((b) => b.images.length === 40), "20 filas x 2 fotos, no las 200");
    assert.deepEqual([summary.created, summary.photosProcessed, summary.needAttention], [100, 200, 0]);
    assert.equal(new Set(report.rows.map((r) => r.reference)).size, 100);
  });

  it("el preview CONGELADO manda: una duda entre filas de lotes distintos no se resuelve sola al procesar", async () => {
    // Fila 2 «Anillo» y fila 30 «Anillo 2» se disputan anillo-2.jpg: en el preview ninguna la recibe.
    const rows = [row(2, { name: "Anillo" }), ...Array.from({ length: 27 }, (_, i) => row(i + 3, { name: `Relleno ${i}` })), row(30, { name: "Anillo 2" })];
    const { analysis, report } = await importar(rows, [img("anillo.jpg"), img("anillo-2.jpg")]);
    assert.deepEqual(analysis.rows[0].images, []);
    assert.equal(bodies[0].rows.some((r) => r.row === 2), true);
    const anillo = report.rows.find((r) => r.row === 2)!;
    assert.deepEqual(await fotosDe(anillo.productId!), [], "el lote 1 solo NO se queda con las fotos en disputa");
  });

  it("fotos faltantes, inválidas o que fallan al procesar/subir: el producto se crea igual y el resultado dice por qué", async () => {
    broken.add("rota.jpg");
    const rows = [
      row(2, { name: "Sin Foto" }),
      row(3, { name: "Collar", images: "danada.jpg" }),
      row(4, { name: "Dije", images: "rota.jpg" }),
      row(5, { name: "Pulsera", retailPrice: "" }),
      row(6, { name: "Aro" }),
    ];
    const images = [img("danada.jpg", { problem: "corrupt" }), img("rota.jpg"), img("aro.jpg")];
    const { report, summary } = await importar(rows, images);
    assert.equal(report.rows.filter((r) => r.status === "created").length, 4, "partial import: la fila con error no frena las demás");
    assert.deepEqual(
      [summary.byReason.no_image.map((i) => i.row), summary.byReason.invalid_image.map((i) => i.row), summary.byReason.invalid_data.map((i) => i.row)],
      [[2], [3, 4], [5]],
    );
    assert.equal(summary.needAttention, 4);
    assert.equal(summary.photosProcessed, 1);
    assert.equal(finalOutcome({ created: 4, errors: 0, photosFailed: report.photoFailures.length }), "completed_with_errors");
  });

  it("duplicados: nunca se crean en silencio (ya existe, repetida en el archivo)", async () => {
    await importar([row(2, { name: "Anillo" })], []);
    const { report, summary } = await importar([row(2, { name: "Anillo" }), row(3, { name: "Collar" }), row(4, { name: "Collar" })], []);
    assert.deepEqual(
      report.rows.map((r) => [r.row, r.status]),
      [[3, "created"]],
    );
    assert.deepEqual(
      summary.byReason.duplicate.map((i) => i.row),
      [2, 4],
    );
    assert.equal(mem.snapshot(DELACOUR.tenantId).length, 2);
  });

  it("reintento: subir el mismo archivo con fotos completa SOLO los productos ya importados sin fotos, sin tocar sus datos", async () => {
    const primera = await importar([row(2, { name: "Anillo", retailPrice: "129900", stock: "5" }), row(3, { name: "Collar" })], []);
    const antes = mem.snapshot(DELACOUR.tenantId).find((p) => p.name === "Anillo")!;

    // Sin elegirlo expresamente: se omite (no se crean duplicados ni se agregan fotos).
    const sinElegir = await importar([row(2, { name: "Anillo", retailPrice: "1", stock: "99" })], [img("anillo.jpg")]);
    assert.equal(sinElegir.analysis.summary.attachable, 1);
    assert.deepEqual(sinElegir.report.rows, []);
    assert.deepEqual(await fotosDe(antes.id), []);

    // Eligiéndolo: se agregan las fotos; precio, stock y referencia NO cambian aunque el archivo diga otra cosa.
    const segunda = await importar([row(2, { name: "Anillo", retailPrice: "1", stock: "99" }), row(3, { name: "Collar" })], [img("anillo.jpg"), img("anillo-2.jpg")], { attach: true });
    assert.deepEqual(
      segunda.report.rows.map((r) => [r.row, r.status, r.reference]),
      [[2, "attached", primera.report.rows[0].reference]],
    );
    const despues = mem.snapshot(DELACOUR.tenantId).find((p) => p.id === antes.id)!;
    assert.deepEqual([despues.pricing, despues.stock, despues.reference, despues.name], [antes.pricing, antes.stock, antes.reference, antes.name]);
    assert.equal((await fotosDe(antes.id)).length, 2);
    assert.equal(segunda.summary.completed, 1);
    assert.equal(mem.snapshot(DELACOUR.tenantId).length, 2, "ningún producto nuevo");

    // Ya con fotos: una tercera carga no las vuelve a agregar.
    const tercera = await importar([row(2, { name: "Anillo" })], [img("anillo.jpg")], { attach: true });
    assert.equal(tercera.analysis.summary.attachable, 0);
    assert.equal((await fotosDe(antes.id)).length, 2);
  });

  it("un producto creado a mano (o por AMORE) nunca recibe fotos por la carga masiva", async () => {
    const manual = await catalog.createProduct(DELACOUR, { name: "Anillo", retailPrice: 1000, stock: 1 });
    const { analysis } = await importar([row(2, { name: "Anillo" })], [img("anillo.jpg")], { attach: true });
    assert.equal(analysis.rows[0].duplicateOf?.kind === "catalog" && analysis.rows[0].duplicateOf.canAttach, false);
    const imp = await imports.start(DELACOUR, { fileName: "x.csv", totalRows: 1 });
    const [res] = await imports.photoUploadUrls(DELACOUR, imp.id, [{ productId: manual.id, mimeType: "image/webp", bytes: 10, thumbBytes: 10 }]);
    assert.equal(res.ok, false);
  });

  it("multi-tenant: otro negocio no puede adjuntar fotos a productos importados de Delacour", async () => {
    const { report } = await importar([row(2, { name: "Anillo" })], []);
    const ajeno = await imports.start(OTRO, { fileName: "x.csv", totalRows: 1 });
    const [res] = await imports.photoUploadUrls(OTRO, ajeno.id, [{ productId: report.rows[0].productId!, mimeType: "image/webp", bytes: 10, thumbBytes: 10 }]);
    assert.equal(res.ok, false);
    await assert.rejects(imports.photoUploadUrls(OTRO, report.importId, []), /no existe/);
  });

  it("una foto que no sube (red) se reporta aparte; el producto queda creado", async () => {
    uploadFails.add("/");
    const { report, summary } = await importar([row(2, { name: "Collar" })], [img("collar.jpg")]);
    assert.equal(report.rows[0].status, "created");
    assert.equal(report.photosUploaded, 0);
    assert.deepEqual(
      summary.byReason.photo_failed.map((i) => [i.row, i.detail]),
      [[2, "collar.jpg: Sin conexión."]],
    );
    assert.equal(finalOutcome({ created: 1, errors: 0, photosFailed: 1 }), "completed_with_errors");
  });
});

describe("progreso: total de fotos desde el inicio, foto actual y tiempo restante", () => {
  it("estimación honesta: nada al principio; luego proporcional al ritmo real", () => {
    const p = { rowsDone: 0, rowsTotal: 100, photosDone: 0, photosTotal: 200 };
    assert.equal(estimateRemainingMs(p, 10_000), null, "sin avance no se inventa un tiempo");
    assert.equal(estimateRemainingMs({ ...p, rowsDone: 100, photosDone: 20 }, 2000), null, "muy pronto (< 4 s)");
    // Hecho: 100 + 4*50 = 300 de 900 en 60 s => faltan 120 s.
    assert.equal(estimateRemainingMs({ ...p, rowsDone: 100, photosDone: 50 }, 60_000), 120_000);
    assert.equal(estimateRemainingMs({ ...p, rowsDone: 100, photosDone: 200 }, 60_000), 0);
    assert.equal(formatRemaining(30_000).es, "Falta menos de un minuto");
    assert.equal(formatRemaining(3 * 60_000).es, "Faltan aproximadamente 3 minutos");
    assert.equal(formatRemaining(70 * 60_000).es, "Faltan aproximadamente 1 h 10 min");
  });

  it("el total de fotos se conoce al empezar y se descuenta lo de filas que no se crean", async () => {
    const mem = createInMemoryCatalogRepository();
    const catalog = createCatalogService({ repo: mem.repo });
    const imports = createCatalogImportService({ repo: mem.repo, catalog });
    mem.failInsert((d) => d.name === "Falla");
    const ok = <T,>(data: T) => ({ ok: true as const, data });
    const seen: Array<{ total: number; current: string | null }> = [];
    const rows: RawRow[] = [
      { row: 2, values: { name: "Anillo", retailPrice: "1000", stock: "1" }, photos: ["F/anillo.jpg", "F/anillo-2.jpg"] },
      { row: 3, values: { name: "Falla", retailPrice: "1000", stock: "1" }, photos: ["F/falla.jpg"] },
    ];
    await runImport(
      { fileName: "x.csv", rows, images: [img("F/anillo.jpg"), img("F/anillo-2.jpg"), img("F/falla.jpg")], decisions: {}, force: [] },
      {
        startImport: async (f, n) => ok({ import: await imports.start(DELACOUR, { fileName: f, totalRows: n }) }),
        importRows: async (id, body) => ok({ results: await imports.createRows(DELACOUR, id, body) }),
        photoUrls: async (id, items) => ok({ results: (await imports.photoUploadUrls(DELACOUR, id, items)) as never }),
        confirmPhotos: async (id, items) => ok({ results: await imports.confirmPhotos(DELACOUR, id, items) }),
        finishImport: async (id, c) => ok({ import: await imports.finish(DELACOUR, id, c) }),
        prepare: async () => ({ image: new Blob([new Uint8Array(10)]), thumb: new Blob([new Uint8Array(10)]), detail: new Blob([new Uint8Array(10)]), mimeType: "image/webp", width: 900, height: 900 }),
        upload: async (t: Ticket) => {
          for (const p of [t.image.path, t.thumb.path, t.detail?.path]) if (p) mem.putObject(p, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
          return ok(null);
        },
        imageFile: (id) => new File([new Uint8Array(10)], id),
        sleep: async () => {},
      },
      (p) => seen.push({ total: p.photosTotal, current: p.current }),
    );
    assert.equal(seen[0].total, 3, "planeado desde el preview");
    assert.equal(seen.at(-1)!.total, 2, "la fila que no se creó ya no suma sus fotos");
    assert.ok(seen.some((s) => s.current === "anillo-2.jpg"), "se muestra el nombre (sin carpeta) de la foto en curso");
    assert.equal(seen.at(-1)!.current, null);
  });
});
