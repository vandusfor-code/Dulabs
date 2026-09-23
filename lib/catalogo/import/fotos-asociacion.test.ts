/**
 * Fase 5 — fotos de la carga masiva: inspección (formato, dimensiones,
 * archivos dañados), identidad por ruta y asociación DETERMINISTA fila <->
 * fotos (elegidas > columna «imagenes» > automáticas por nombre/carpeta/código).
 * Sin red ni Supabase.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeImport } from "@/lib/catalogo/import/analisis";
import { autoAssociate, buildPhotoCatalog, isNoPhotoCell, naturalCompare, rowPhotoKeys } from "@/lib/catalogo/import/asociacion";
import { IMAGE_DIMENSIONS, imageProblem, photoKey, readImageSize } from "@/lib/catalogo/import/fotos";
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";
import { collectFiles, emptyImportFiles, imageFile, inspectImage } from "@/lib/catalogo/import/navegador";
import { analyzeRowsSchema, imageInfoSchema } from "@/lib/catalogo/import/esquemas";
import type { ImageInfo, RawRow } from "@/lib/catalogo/import/types";

// ---- Encabezados mínimos reales (solo lo que un lector necesita) ----
function jpeg(width: number, height: number, { app1 = 0, tail = 64 } = {}): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const exif = app1 > 0 ? [0xff, 0xe1, (app1 + 2) >> 8, (app1 + 2) & 0xff, ...new Array(app1).fill(0x20)] : [];
  const sof = [0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...exif, ...sof, ...new Array(tail).fill(0)]);
}
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}
function webpX(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0]);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return b;
}
function webpL(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 10, 0, 0, 0, 0x2f]);
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  new DataView(b.buffer).setUint32(21, bits, true);
  return b;
}
function webpLossy(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a]);
  new DataView(b.buffer).setUint16(26, width, true);
  new DataView(b.buffer).setUint16(28, height, true);
  return b;
}

const img = (id: string, over: Partial<ImageInfo> = {}): ImageInfo => ({ id, name: id.split("/").pop()!, size: 80_000, width: 1600, height: 1600, problem: null, ...over });
const row = (n: number, values: RawRow["values"], photos?: string[]): RawRow => ({ row: n, values: { retailPrice: "10000", stock: "3", ...values }, ...(photos ? { photos } : {}) });
const ctx = { categories: [], existing: [] };
const files = (a: ReturnType<typeof analyzeImport>, i = 0) => a.rows[i].images.map((m) => m.file);

describe("inspección de fotos (encabezado, sin decodificar)", () => {
  it("lee alto y ancho de JPEG, PNG y las tres variantes de WEBP", () => {
    assert.deepEqual(readImageSize(jpeg(4000, 3000), "jpeg"), { width: 4000, height: 3000 });
    assert.deepEqual(readImageSize(jpeg(1200, 1600, { app1: 30_000 }), "jpeg"), { width: 1200, height: 1600 }, "con EXIF grande antes del SOF");
    assert.deepEqual(readImageSize(png(800, 600), "png"), { width: 800, height: 600 });
    assert.deepEqual(readImageSize(webpX(2048, 1536), "webp"), { width: 2048, height: 1536 });
    assert.deepEqual(readImageSize(webpL(640, 480), "webp"), { width: 640, height: 480 });
    assert.deepEqual(readImageSize(webpLossy(1024, 768), "webp"), { width: 1024, height: 768 });
  });

  it("encabezado cortado => 'truncated'; basura con firma válida => 'invalid'", () => {
    assert.equal(readImageSize(jpeg(1000, 1000, { app1: 30_000 }).slice(0, 1000), "jpeg"), "truncated");
    assert.equal(readImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0]), "jpeg"), "invalid", "datos de imagen sin SOF");
    assert.equal(readImageSize(new Uint8Array([0xff, 0xd8, 0x12, 0x34, 0, 4, 0, 0]), "jpeg"), "invalid");
    const badPng = png(10, 10);
    badPng[12] = 0x58;
    assert.equal(readImageSize(badPng, "png"), "invalid");
    assert.equal(readImageSize(png(0, 600), "png"), "invalid");
  });

  it("diagnóstico: vacía, formato, HEIC, peso, dañada, demasiado pequeña o grande", () => {
    assert.equal(imageProblem("jpeg", 0), "empty");
    assert.equal(imageProblem("gif", 100), "format", "GIF no se admite");
    assert.equal(imageProblem("heic", 100), "heic");
    assert.equal(imageProblem("jpeg", IMPORT_LIMITS.imageBytes + 1, { width: 100, height: 100 }), "size");
    assert.equal(imageProblem("jpeg", 100, "invalid"), "corrupt");
    assert.equal(imageProblem("jpeg", 100, { width: 150, height: 120 }), "dimensions");
    assert.equal(imageProblem("jpeg", 100, { width: 20_000, height: 1000 }), "dimensions");
    assert.equal(imageProblem("jpeg", 100, { width: 12_000, height: 9_000 }), "dimensions", "más de 100 MP");
    assert.equal(imageProblem("jpeg", 100, { width: 8160, height: 6120 }), null, "50 MP de un celular se acepta");
    assert.equal(imageProblem("jpeg", 100, null), null, "sin dimensiones conocidas: se verificará al procesarla");
  });

  it("inspectImage: dimensiones reales; archivo cortado => dañado; firma falsa => formato", async () => {
    const ok = await inspectImage(new Blob([jpeg(3000, 2000) as BlobPart]), "Fotos/anillo.jpg");
    assert.deepEqual(ok, { id: "Fotos/anillo.jpg", name: "anillo.jpg", size: ok.size, width: 3000, height: 2000, problem: null });
    const cut = await inspectImage(new Blob([jpeg(3000, 2000, { app1: 30_000 }).slice(0, 5000) as BlobPart]), "cortada.jpg");
    assert.equal(cut.problem, "corrupt");
    const fake = await inspectImage(new Blob([new TextEncoder().encode("<html>no soy una foto</html>") as BlobPart]), "falsa.jpg");
    assert.equal(fake.problem, "format");
    const tiny = await inspectImage(new Blob([png(64, 64) as BlobPart]), "icono.png");
    assert.equal(tiny.problem, "dimensions");
    // Encabezado larguísimo (> 64 KB): se lee un poco más y se encuentra igual.
    const longHeader = await inspectImage(new Blob([jpeg(1500, 1500, { app1: 65_000 }) as BlobPart, jpeg(1, 1, { app1: 65_000 }).slice(2) as BlobPart]), "exif.jpg");
    assert.deepEqual([longHeader.width, longHeader.height, longHeader.problem], [1500, 1500, null]);
  });
});

describe("identidad de las fotos seleccionadas", () => {
  const f = (bytes: Uint8Array, name: string) => new File([bytes as BlobPart], name, { type: "image/jpeg" });

  it("carpetas: dos '1.jpg' en carpetas distintas son dos fotos; la misma ruta dos veces, una", async () => {
    const r = await collectFiles(
      [
        { file: f(jpeg(1200, 1200), "1.jpg"), path: "Fotos/Anillo corazón/1.jpg" },
        { file: f(jpeg(1200, 1200), "1.jpg"), path: "Fotos/Aretes perla/1.jpg" },
        { file: new File([new Uint8Array(3)], "Thumbs.db"), path: "Fotos/Thumbs.db" },
        { file: new File([new Uint8Array(3)], ".DS_Store"), path: "Fotos/.DS_Store" },
      ],
      emptyImportFiles(),
    );
    assert.equal(r.error, null);
    assert.deepEqual(r.files.infos.map((i) => i.id).sort(), ["Fotos/Anillo corazón/1.jpg", "Fotos/Aretes perla/1.jpg"]);
    assert.deepEqual(r.notices, [], "los archivos del sistema se ignoran en silencio");
    const again = await collectFiles([{ file: f(jpeg(1200, 1200), "1.jpg"), path: "/Fotos/Anillo corazón/1.jpg" }], r.files);
    assert.equal(again.files.infos.length, 2);
    assert.match(again.notices[0], /ya estaba seleccionada/);
    assert.ok(imageFile(again.files, "fotos/anillo corazón/1.jpg"), "búsqueda por id sin distinguir mayúsculas");
  });

  it("la planilla puede venir dentro de la carpeta; las fotos dañadas quedan marcadas (no se descartan en silencio)", async () => {
    const r = await collectFiles(
      [
        { file: new File([new Uint8Array([0x50, 0x4b, 3, 4])], "productos.xlsx"), path: "Catalogo/productos.xlsx" },
        { file: f(jpeg(2000, 2000, { app1: 30_000 }).slice(0, 4000), "rota.jpg"), path: "Catalogo/rota.jpg" },
        { file: new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], "animada.gif"), path: "Catalogo/animada.gif" },
      ],
      emptyImportFiles(),
    );
    assert.equal(r.files.spreadsheet?.name, "productos.xlsx");
    const byName = Object.fromEntries(r.files.infos.map((i) => [i.name, i.problem]));
    assert.deepEqual(byName, { "rota.jpg": "corrupt", "animada.gif": "format" });
  });

  it("esquema: acepta la forma nueva y la de una pestaña anterior (id = nombre); nunca campos extra", () => {
    const nuevo = imageInfoSchema.parse({ id: "Fotos/a.jpg", name: "a.jpg", size: 10, width: 800, height: 600, problem: null });
    assert.equal(nuevo.id, "Fotos/a.jpg");
    const viejo = imageInfoSchema.parse({ name: "a.jpg", size: 10, problem: null });
    assert.deepEqual([viejo.id, viejo.width], ["a.jpg", null]);
    assert.equal(imageInfoSchema.safeParse({ name: "a.jpg", size: 10, problem: null, tenantId: "x" }).success, false);
    const body = analyzeRowsSchema.safeParse({ rows: [{ row: 2, values: { name: "A" }, photos: new Array(13).fill("a.jpg") }], images: [] });
    assert.equal(body.success, false, "no más fotos elegidas que la galería");
  });
});

describe("detección automática (determinista, nunca por parecido)", () => {
  it("clave del nombre: mayúsculas, tildes, espacios, guiones bajos y copias de Windows", () => {
    assert.equal(photoKey("Anillo Corazón"), "anillo-corazon");
    assert.equal(photoKey("ANILLO_CORAZON"), "anillo-corazon");
    assert.equal(photoKey("anillo-corazon (2)"), "anillo-corazon-2");
    assert.deepEqual(rowPhotoKeys({ name: "Anillo Corazón", color: "Dorado", code: "AN-014" }), ["an-014", "anillo-corazon-dorado", "anillo-corazon"]);
    assert.ok(naturalCompare("2.jpg", "10.jpg") < 0);
    assert.ok(naturalCompare("foto-9", "foto-10") < 0);
  });

  it("1 producto, 1 foto: «Anillo Corazón» => anillo-corazon.jpg, marcada como automática", () => {
    const a = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo Corazón" })], images: [img("anillo-corazon.jpg"), img("otra.jpg")] });
    assert.deepEqual(files(a), ["anillo-corazon.jpg"]);
    assert.equal(a.rows[0].imageSource, "auto");
    assert.equal(a.rows[0].status, "ready");
    assert.deepEqual(a.summary.photos, { matched: 1, auto: 1, ambiguous: 0, missing: 0, unused: ["otra.jpg"] });
  });

  it("1 producto, varias fotos: principal y galería por número (también «(2)» de Windows)", () => {
    const a = analyzeImport({
      ...ctx,
      rows: [row(2, { name: "Anillo Corazón" })],
      images: [img("Anillo Corazón (3).jpg"), img("anillo-corazon-10.jpg"), img("anillo_corazon_2.png"), img("ANILLO-CORAZON.webp")],
    });
    assert.deepEqual(files(a), ["ANILLO-CORAZON.webp", "anillo_corazon_2.png", "Anillo Corazón (3).jpg", "anillo-corazon-10.jpg"]);
  });

  it("carpeta con el nombre del producto: todas sus fotos, la que se llama como el producto primero, luego en orden natural", () => {
    const a = analyzeImport({
      ...ctx,
      rows: [row(2, { name: "Aretes Perla" }), row(3, { name: "Dije Luna" })],
      images: [img("Fotos/Aretes Perla/10.jpg"), img("Fotos/Aretes Perla/2.jpg"), img("Fotos/Aretes Perla/aretes-perla.jpg"), img("Fotos/Dije luna/IMG_2031.jpg")],
    });
    assert.deepEqual(files(a, 0), ["Fotos/Aretes Perla/aretes-perla.jpg", "Fotos/Aretes Perla/2.jpg", "Fotos/Aretes Perla/10.jpg"]);
    assert.deepEqual(files(a, 1), ["Fotos/Dije luna/IMG_2031.jpg"]);
  });

  it("código interno (columna «codigo») tiene prioridad; nombre + color distingue variantes", () => {
    const a = analyzeImport({
      ...ctx,
      rows: [row(2, { name: "Dije Luna", code: "DJ-014" }), row(3, { name: "Anillo Corazón", color: "Dorado" }), row(4, { name: "Anillo Corazón", color: "Plateado", material: "Plata" })],
      images: [img("DJ-014.jpg"), img("dj-014-2.jpg"), img("dije-luna.jpg"), img("anillo-corazon-dorado.jpg"), img("anillo-corazon-plateado.jpg")],
    });
    assert.deepEqual(files(a, 0), ["DJ-014.jpg", "dj-014-2.jpg"]);
    assert.deepEqual(files(a, 1), ["anillo-corazon-dorado.jpg"]);
    assert.deepEqual(files(a, 2), ["anillo-corazon-plateado.jpg"]);
  });

  it("DUDA => no se asigna nada: misma foto en .jpg y .png", () => {
    const a = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo Corazón" })], images: [img("anillo-corazon.jpg"), img("Anillo Corazón.png")] });
    assert.deepEqual(files(a), []);
    assert.equal(a.rows[0].status, "warning");
    assert.deepEqual(a.rows[0].imageCandidates, ["Anillo Corazón.png", "anillo-corazon.jpg"]);
    assert.ok(a.rows[0].issues.some((i) => i.code === "image_ambiguous" && /tenemos varias imágenes posibles para este producto/i.test(i.message)));
    assert.ok(!a.rows[0].issues.some((i) => i.code === "no_image"), "no se repite el aviso de 'sin foto'");
    assert.equal(a.summary.photos.ambiguous, 1);
    assert.deepEqual(a.summary.photos.unused, [], "los candidatos no cuentan como 'sin usar'");
  });

  it("DUDA: dos carpetas con el nombre del producto, o fotos sueltas además de su carpeta", () => {
    const dos = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo" })], images: [img("Nuevas/Anillo/1.jpg"), img("Viejas/anillo/1.jpg")] });
    assert.deepEqual(dos.rows[0].imageCandidates, ["Nuevas/Anillo/1.jpg", "Viejas/anillo/1.jpg"]);
    const mixto = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo" })], images: [img("Anillo/1.jpg"), img("anillo.jpg")] });
    assert.deepEqual(files(mixto), []);
    assert.equal(mixto.rows[0].imageCandidates.length, 2);
    const dentro = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo" })], images: [img("Anillo/1.jpg"), img("Anillo/anillo.jpg")] });
    assert.deepEqual(files(dentro), ["Anillo/anillo.jpg", "Anillo/1.jpg"], "si la foto con su nombre está DENTRO de la carpeta, no hay duda");
  });

  it("DUDA: una foto que coincide con dos filas no es de ninguna (se indica cuál es la otra fila)", () => {
    const a = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo" }), row(3, { name: "Anillo 2" })], images: [img("anillo.jpg"), img("anillo-2.jpg")] });
    assert.deepEqual(files(a, 0), []);
    assert.deepEqual(files(a, 1), []);
    assert.match(a.rows[0].issues.find((i) => i.code === "image_ambiguous")!.message, /fila 3/);
    assert.match(a.rows[1].issues.find((i) => i.code === "image_ambiguous")!.message, /fila 2/);
    // Mismo nombre en dos colores y UNA sola foto sin color: tampoco se adivina.
    const colores = analyzeImport({ ...ctx, rows: [row(2, { name: "Aro", color: "Dorado" }), row(3, { name: "Aro", color: "Plateado" })], images: [img("aro.jpg")] });
    assert.ok(colores.rows.every((r) => r.images.length === 0 && r.imageCandidates.includes("aro.jpg")));
  });

  it("una fila repetida o con error no compite por las fotos de la fila buena", () => {
    const a = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo" }), row(3, { name: "Anillo" }), row(4, { name: "Anillo 2", retailPrice: "" })], images: [img("anillo.jpg"), img("anillo-2.jpg")] });
    assert.equal(a.rows[1].status, "error");
    assert.equal(a.rows[2].status, "error");
    assert.deepEqual(files(a, 0), ["anillo.jpg", "anillo-2.jpg"]);
  });

  it("una foto indicada expresamente por otra fila nunca se asigna sola", () => {
    const a = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo" }), row(3, { name: "Collar", images: "anillo.jpg" })], images: [img("anillo.jpg")] });
    assert.deepEqual(files(a, 0), []);
    assert.deepEqual(files(a, 1), ["anillo.jpg"]);
    assert.equal(a.rows[1].imageSource, "cell");
  });
});

describe("columna «imagenes» y fotos elegidas en el preview", () => {
  it("la columna manda sobre la detección; acepta ruta, nombre, nombre sin extensión o carpeta", () => {
    const images = [img("Fotos/Anillo/1.jpg"), img("Fotos/Anillo/2.jpg"), img("Fotos/Aretes/1.jpg"), img("anillo.jpg"), img("detalle-cierre.png")];
    const a = analyzeImport({
      ...ctx,
      rows: [
        row(2, { name: "Anillo", images: "detalle-cierre" }),
        row(3, { name: "Collar", images: "Fotos/Aretes/1.jpg" }),
        row(4, { name: "Pulsera", images: "Anillo" }),
      ],
      images,
    });
    assert.deepEqual(files(a, 0), ["detalle-cierre.png"], "no mezcla la columna con la detección automática");
    assert.deepEqual(files(a, 1), ["Fotos/Aretes/1.jpg"]);
    assert.equal(files(a, 2).length, 1, "«Anillo» es el nombre de un archivo (anillo.jpg) antes que el de una carpeta");
  });

  it("«1.jpg» en varias carpetas => duda en la columna, con los candidatos", () => {
    const a = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo", images: "1.jpg" })], images: [img("A/1.jpg"), img("B/1.jpg")] });
    assert.deepEqual(files(a), []);
    assert.deepEqual(a.rows[0].imageCandidates, ["A/1.jpg", "B/1.jpg"]);
    assert.match(a.rows[0].issues[0].message, /varias imágenes posibles para «1\.jpg»/);
  });

  it("«sin foto» en la columna => ninguna foto y sin aviso", () => {
    assert.ok(isNoPhotoCell(" Sin Foto ") && isNoPhotoCell("-") && !isNoPhotoCell("sin-foto.jpg"));
    const a = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo", images: "sin foto" })], images: [img("anillo.jpg")] });
    assert.deepEqual(files(a), []);
    assert.equal(a.rows[0].status, "ready");
  });

  it("fotos elegidas: mandan sobre todo, en el orden elegido; [] = sin foto; una que ya no está => aviso", () => {
    const images = [img("anillo.jpg"), img("x/1.jpg"), img("x/2.jpg")];
    const picked = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo", images: "anillo.jpg" }, ["x/2.jpg", "X/1.JPG"])], images });
    assert.deepEqual(files(picked), ["x/2.jpg", "x/1.jpg"]);
    assert.equal(picked.rows[0].imageSource, "picked");
    const none = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo" }, [])], images });
    assert.deepEqual([files(none), none.rows[0].status], [[], "ready"]);
    const gone = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo" }, ["borrada.jpg"])], images });
    assert.match(gone.rows[0].issues[0].message, /«borrada\.jpg» ya no está/);
  });
});

describe("validación de las fotos relacionadas", () => {
  it("dañada, pequeña o en formato no permitido => se excluye con el motivo; baja resolución => aviso", () => {
    const a = analyzeImport({
      ...ctx,
      rows: [row(2, { name: "Anillo" }), row(3, { name: "Aretes" }), row(4, { name: "Dije" }), row(5, { name: "Collar" })],
      images: [
        img("anillo.jpg", { problem: "corrupt" }),
        img("aretes.jpg", { problem: "dimensions", width: 120, height: 90 }),
        img("dije.gif", { problem: "format" }),
        img("collar.jpg", { width: 480, height: 480 }),
      ],
    });
    assert.match(a.rows[0].issues[0].message, /dañada o incompleta/);
    assert.match(a.rows[1].issues[0].message, /demasiado pequeña \(120×90 px\)/);
    assert.match(a.rows[2].issues[0].message, /no es una foto JPG, PNG o WEBP/);
    assert.deepEqual(files(a, 3), ["collar.jpg"]);
    assert.ok(a.rows[3].issues.some((i) => i.code === "image_low_resolution" && /480×480/.test(i.message)));
    assert.equal(a.summary.importable, 4, "una foto mala nunca impide crear el producto");
  });

  it("más fotos que la galería => se usan las primeras 12, con aviso", () => {
    const images = Array.from({ length: 15 }, (_, i) => img(`Anillo/${i + 1}.jpg`));
    const a = analyzeImport({ ...ctx, rows: [row(2, { name: "Anillo" })], images });
    assert.equal(a.rows[0].images.length, IMPORT_LIMITS.imagesPerProduct);
    assert.equal(a.rows[0].images[0].file, "Anillo/1.jpg");
    assert.ok(a.rows[0].issues.some((i) => i.code === "too_many_images"));
  });
});

describe("volumen", () => {
  it("100 productos con 3 fotos cada uno: todos relacionados automáticamente", () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 2, { name: `Pieza ${i + 1}`, color: "Dorado" }));
    const images = rows.flatMap((_, i) => [img(`pieza-${i + 1}-dorado.jpg`), img(`pieza-${i + 1}-dorado-2.jpg`), img(`pieza-${i + 1}-dorado-3.jpg`)]);
    const a = analyzeImport({ ...ctx, rows, images });
    assert.equal(a.summary.importable, 100);
    assert.deepEqual([a.summary.photos.matched, a.summary.photos.auto, a.summary.photos.ambiguous, a.summary.photos.unused.length], [300, 100, 0, 0]);
    assert.deepEqual(files(a, 41), ["pieza-42-dorado.jpg", "pieza-42-dorado-2.jpg", "pieza-42-dorado-3.jpg"]);
  });

  it(`${IMPORT_LIMITS.rows} productos y ${IMPORT_LIMITS.images} fotos: el análisis sigue siendo rápido`, () => {
    const rows = Array.from({ length: IMPORT_LIMITS.rows }, (_, i) => row(i + 2, { name: `Referencia ${i + 1}` }));
    const images = Array.from({ length: IMPORT_LIMITS.images }, (_, i) => img(`Fotos/Referencia ${Math.floor(i / 3) + 1}/${(i % 3) + 1}.jpg`));
    const t0 = performance.now();
    const a = analyzeImport({ ...ctx, rows, images });
    const ms = performance.now() - t0;
    assert.equal(a.summary.photos.matched, IMPORT_LIMITS.images);
    assert.ok(ms < 5000, `tardó ${Math.round(ms)} ms`);
  });

  it("autoAssociate directo: resultado idéntico sin importar el orden de las fotos", () => {
    const images = [img("b/2.jpg"), img("anillo-3.jpg"), img("anillo.jpg"), img("anillo-2.jpg")];
    const one = autoAssociate([{ row: 2, keys: ["anillo"] }], images, new Set());
    const two = autoAssociate([{ row: 2, keys: ["anillo"] }], [...images].reverse(), new Set());
    assert.deepEqual(one.get(2)!.images.map((i) => i.id), ["anillo.jpg", "anillo-2.jpg", "anillo-3.jpg"]);
    assert.deepEqual(two.get(2)!.images.map((i) => i.id), one.get(2)!.images.map((i) => i.id));
    assert.equal(buildPhotoCatalog(images).byId("B/2.JPG")?.id, "b/2.jpg");
  });

  it("límites de la fase 5: 2.000 productos y 6.000 fotos por importación", () => {
    assert.equal(IMPORT_LIMITS.rows, 2000);
    assert.equal(IMPORT_LIMITS.images, 6000);
    assert.ok(IMAGE_DIMENSIONS.lowSide > IMAGE_DIMENSIONS.minSide);
  });
});

describe("filas repetidas y avisos de fotos", () => {
  it("una fila que se omitirá por repetida no muestra avisos de fotos (salvo que se pueda completar)", () => {
    const existing = [
      { id: "p1", reference: "DL-000184", name: "Anillo", categoryId: null, color: null, material: null, importId: null, hasImages: true },
      { id: "p2", reference: "DL-000185", name: "Collar", categoryId: null, color: null, material: null, importId: "imp-1", hasImages: false },
    ];
    const a = analyzeImport({
      categories: [],
      existing,
      rows: [row(2, { name: "Anillo" }), row(3, { name: "Collar" }), row(4, { name: "Dije" })],
      images: [img("collar.jpg"), img("otra.jpg")],
    });
    assert.deepEqual(
      a.rows[0].issues.map((i) => i.code),
      ["duplicate_in_catalog"],
      "sin 'no encontramos su foto' para algo que no se va a crear",
    );
    assert.equal(a.rows[1].images.length, 1, "la ya importada sin fotos conserva su foto para poder completarla");
    assert.match(a.rows[1].issues[0].message, /no tiene fotos\. Puedes agregarle la foto encontrada/);
    assert.ok(a.rows[2].issues.some((i) => i.code === "no_image"), "una fila nueva sin foto sí avisa");
    assert.equal(a.summary.attachable, 1);
  });
});
