/**
 * Carga masiva del Catálogo — lector de planillas, análisis, servicio y ZIP.
 * Sin red ni BD (repositorio en memoria); ningún test toca Supabase.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import ExcelJS from "exceljs";
import { COLUMNS, columnFor } from "@/lib/catalogo/import/columnas";
import { parseCsv, decodeCsv, toCsv } from "@/lib/catalogo/import/csv";
import { analyzeImport, parseMoney, parseStock } from "@/lib/catalogo/import/analisis";
import { buildImageIndex, imageProblem, sniffImage, splitImageCell } from "@/lib/catalogo/import/fotos";
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";
import { ImportFileError, readSpreadsheet, rowsFromTable } from "@/lib/catalogo/import/planilla";
import { buildTemplateCsv, buildTemplateXlsx } from "@/lib/catalogo/import/plantilla";
import { analyzeRowsSchema, importRowsSchema, photoUrlsSchema } from "@/lib/catalogo/import/esquemas";
import { ImportStartError, runImport, type ImportProgress, type ImportRunDeps } from "@/lib/catalogo/import/proceso";
import { createCatalogImportService } from "@/lib/catalogo/import/servicio";
import type { ImageInfo, RawRow } from "@/lib/catalogo/import/types";
import { isSystemEntry, readZipIndex, ZipError } from "@/lib/catalogo/import/zip";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository, WEBP_HEAD } from "@/lib/catalogo/testing/in-memory-repository";

const DELACOUR: CatalogActor = { tenantId: "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4", userId: "admin" };
const OTRO: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-000000000002", userId: "otro" };

const enc = new TextEncoder();
const img = (name: string, problem: ImageInfo["problem"] = null, size = 50_000): ImageInfo => ({ name, size, problem });
const row = (n: number, values: RawRow["values"]): RawRow => ({ row: n, values });
const base = (n: number, over: RawRow["values"] = {}): RawRow => row(n, { name: `Pieza ${n}`, retailPrice: "10000", stock: "3", ...over });

async function xlsxBytes(rows: Array<Array<string | number | null>>, sheet = "Productos"): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(sheet);
  rows.forEach((r) => hoja.addRow(r));
  return new Uint8Array((await libro.xlsx.writeBuffer()) as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Planilla: CSV / XLSX / archivos inválidos
// ---------------------------------------------------------------------------

describe("lector de planillas", () => {
  it("CSV válido separado por punto y coma (Excel en español), con comillas y BOM", async () => {
    const csv = '﻿nombre;categoria;precio_detal;precio_mayor;stock;imagenes\r\n"Anillo ""corazón""";Anillos;129.900;79900;5;"anillo.jpg, anillo-2.jpg"\r\n;;;;;\r\nAretes perla;Aretes;$ 89,900;;12;\r\n';
    const r = await readSpreadsheet("productos.csv", enc.encode(csv));
    assert.deepEqual(r.rows, [
      row(2, { name: 'Anillo "corazón"', category: "Anillos", retailPrice: "129.900", wholesalePrice: "79900", stock: "5", images: "anillo.jpg, anillo-2.jpg" }),
      row(4, { name: "Aretes perla", category: "Aretes", retailPrice: "$ 89,900", stock: "12" }),
    ]);
  });

  it("CSV guardado por Excel en Windows (Windows-1252): tildes y ñ correctas", () => {
    const bytes = new Uint8Array([...enc.encode("nombre,precio_detal,stock\r\nPi"), 0xf1, 0x61, 0x20, 0x61, 0x6e, 0x69, 0x6c, 0x6c, 0xf3, ...enc.encode(",1000,1")]);
    assert.equal(parseCsv(decodeCsv(bytes))[1][0], "Piña anilló");
  });

  it("XLSX válido: encabezados con sinónimos, filas vacías ignoradas, número de fila real", async () => {
    const bytes = await xlsxBytes([
      ["Nombre del producto", "Categoría", "Precio", "Precio mayorista", "Cantidad", "Fotos", "Referencia"],
      ["Dije luna", "Dijes", 64900, null, 0, "dije-luna.jpg"],
      [null, null, null, null, null, null],
      ["Pulsera oro", "pulseras", 159900, 99000, 2, ""],
    ]);
    const r = await readSpreadsheet("catalogo.xlsx", bytes);
    assert.equal(r.sheetName, "Productos");
    assert.deepEqual(r.rows, [
      row(2, { name: "Dije luna", category: "Dijes", retailPrice: "64900", stock: "0", images: "dije-luna.jpg" }),
      row(4, { name: "Pulsera oro", category: "pulseras", retailPrice: "159900", wholesalePrice: "99000", stock: "2" }),
    ]);
    assert.ok(r.notices.some((n) => n.includes("«Referencia»")), "la referencia del archivo se ignora con aviso");
  });

  it("plantilla XLSX y CSV: se leen de vuelta con sus 3 ejemplos (mismas columnas)", async () => {
    const xlsx = await readSpreadsheet("plantilla-productos.xlsx", await buildTemplateXlsx(["Anillos", "Aretes"]));
    assert.equal(xlsx.rows.length, 3);
    assert.equal(xlsx.rows[0].values.name, "Anillo corazón");
    assert.equal(xlsx.rows[0].values.images, "anillo-corazon.jpg, anillo-corazon-detalle.jpg");
    const csv = await readSpreadsheet("plantilla-productos.csv", enc.encode(buildTemplateCsv()));
    assert.deepEqual(
      csv.rows.map((r) => r.values.name),
      ["Anillo corazón", "Aretes perla", "Dije luna"],
    );
  });

  it("archivos inválidos => mensaje claro (nunca un error técnico)", async () => {
    await assert.rejects(readSpreadsheet("viejo.xls", enc.encode("x")), (e: Error) => e instanceof ImportFileError && /\.xlsx/.test(e.message));
    await assert.rejects(readSpreadsheet("foto.png", enc.encode("x")), (e: Error) => e instanceof ImportFileError && /Excel \(\.xlsx\) o CSV/.test(e.message));
    await assert.rejects(readSpreadsheet("falso.xlsx", enc.encode("hola")), (e: Error) => e instanceof ImportFileError && /no es un Excel válido/.test(e.message));
    await assert.rejects(readSpreadsheet("vacio.csv", new Uint8Array()), /vacío/);
    await assert.rejects(readSpreadsheet("sin-precio.csv", enc.encode("nombre,stock\nAnillo,1")), /Falta la columna «precio_detal»/);
    await assert.rejects(readSpreadsheet("sin-encabezados.csv", enc.encode("Anillo,1000,2\nAretes,2000,3")), /No encontramos los encabezados/);
    await assert.rejects(readSpreadsheet("solo-encabezados.csv", enc.encode("nombre,precio_detal,stock\n")), /no tiene productos/);
    await assert.rejects(readSpreadsheet("comillas.csv", enc.encode('nombre,precio_detal,stock\n"Anillo,1000,2')), /comillas sin cerrar/);
  });

  it("archivo demasiado grande o con demasiadas filas", async () => {
    await assert.rejects(readSpreadsheet("grande.csv", new Uint8Array(IMPORT_LIMITS.spreadsheetBytes + 1)), /pesa más de 4 MB/);
    const muchas = ["nombre,precio_detal,stock", ...Array.from({ length: IMPORT_LIMITS.rows + 1 }, (_, i) => `P${i},1000,1`)].join("\n");
    await assert.rejects(readSpreadsheet("muchas.csv", enc.encode(muchas)), /más de 1000 productos/);
  });

  it("encabezados: sinónimos, tildes, mayúsculas y guiones; referencia/sku se ignoran", () => {
    assert.equal(columnFor("  Precio_Detal (COP) *"), "retailPrice");
    assert.equal(columnFor("DESCRIPCIÓN"), "description");
    assert.equal(columnFor("imagen principal"), "images");
    assert.equal(columnFor("Referencia"), "ignored");
    assert.equal(columnFor("SKU"), "ignored");
    assert.equal(columnFor("otra cosa"), null);
    assert.throws(() => rowsFromTable([{ row: 1, cells: ["nombre"] }]), ImportFileError);
  });
});

// ---------------------------------------------------------------------------
// Análisis (puro)
// ---------------------------------------------------------------------------

describe("números de la planilla", () => {
  it("precio COP: formatos reales aceptados; decimales, negativos y texto rechazados", () => {
    for (const [raw, v] of [["129900", 129900], ["129.900", 129900], ["$ 129,900", 129900], ["129900.00", 129900], ["1.290.000", 1290000], ["129.900,00", 129900], ["COP 50000", 50000]] as const) {
      assert.equal(parseMoney(raw, "el precio").value, v, raw);
    }
    assert.match(parseMoney("129900.5", "el precio detal").issue!.text, /decimales/);
    assert.match(parseMoney("-100", "el precio detal").issue!.text, /negativo/);
    assert.match(parseMoney("gratis", "el precio detal").issue!.text, /«gratis» no es un número válido/);
    assert.deepEqual(parseMoney("", "x"), { value: null, issue: null });
  });

  it("stock: entero >= 0", () => {
    assert.equal(parseStock("5").value, 5);
    assert.equal(parseStock("0").value, 0);
    assert.equal(parseStock("5.0").value, 5);
    assert.equal(parseStock("1.000").value, 1000);
    assert.match(parseStock("-2").issue!.text, /negativo/);
    assert.match(parseStock("2.5").issue!.text, /entero/);
    assert.match(parseStock("muchos").issue!.text, /no es un número/);
  });
});

describe("análisis de filas", () => {
  const ctx = { categories: [{ id: "c-anillos", name: "Anillos" }], existing: [] as { reference: string; name: string; categoryId: string | null; color: string | null; material: string | null }[] };

  it("fila completa => lista, con los valores validados por las reglas del dominio", () => {
    const a = analyzeImport({ ...ctx, rows: [row(2, { name: "  Anillo corazón ", category: "anillos", retailPrice: "129.900", wholesalePrice: "79900", stock: "5", material: "Oro", images: "a.jpg" })], images: [img("a.jpg")] });
    assert.equal(a.rows[0].status, "ready");
    assert.deepEqual(a.rows[0].product, {
      name: "Anillo corazón",
      description: null,
      material: "Oro",
      color: null,
      retailPrice: 129900,
      wholesalePrice: 79900,
      stock: 5,
      category: { kind: "existing", id: "c-anillos", name: "Anillos" },
    });
    assert.deepEqual(a.summary, { total: 1, ready: 1, warnings: 0, errors: 0, duplicates: 0, importable: 1, photos: { matched: 1, missing: 0, unused: [] } });
  });

  it("errores comprensibles por fila: sin nombre, sin precio, precio inválido, stock inválido, textos largos", () => {
    const a = analyzeImport({
      ...ctx,
      images: [],
      rows: [
        row(3, { retailPrice: "1000", stock: "1" }),
        row(24, { name: "Collar", stock: "1" }),
        row(25, { name: "Collar", retailPrice: "abc", stock: "1" }),
        row(26, { name: "Collar", retailPrice: "1000", stock: "-3" }),
        row(27, { name: "Collar", retailPrice: "1000", stock: "dos" }),
        row(28, { name: "x".repeat(121), retailPrice: "1000", stock: "1" }),
        row(29, { name: "Collar", retailPrice: "1000" }),
      ],
    });
    const msgs = a.rows.map((r) => r.issues.map((i) => i.message));
    assert.deepEqual(msgs[0], ["Fila 3: el nombre es obligatorio."]);
    assert.deepEqual(msgs[1], ["Fila 24: el precio detal es obligatorio."]);
    assert.deepEqual(msgs[2], ["Fila 25: el precio detal «abc» no es un número válido."]);
    assert.deepEqual(msgs[3], ["Fila 26: el stock no puede ser negativo."]);
    assert.deepEqual(msgs[4], ["Fila 27: el stock «dos» no es un número válido."]);
    assert.deepEqual(msgs[5], ["Fila 28: el nombre admite máximo 120 caracteres."]);
    assert.deepEqual(msgs[6], ["Fila 29: el stock es obligatorio (usa 0 si está agotado)."]);
    assert.ok(a.rows.every((r) => r.status === "error" && r.product === null));
    assert.equal(a.summary.importable, 0);
  });

  it("categoría inexistente => plan 'crear'; variantes Anillos/anillos/ANILLOS/Anillós son UNA sola", () => {
    const a = analyzeImport({
      ...ctx,
      images: [],
      rows: [base(2, { category: "Argollas" }), base(3, { category: "argollas" }), base(4, { category: "ARGOLLAS" }), base(5, { category: "Argóllas" })],
    });
    assert.equal(a.categories.length, 1);
    assert.deepEqual({ ...a.categories[0], spellings: a.categories[0].spellings.length }, { key: "argollas", label: "Argollas", spellings: 4, rows: 4, suggestion: null, decision: { action: "create" } });
    assert.ok(a.rows.every((r) => r.product?.category.kind === "new"));
  });

  it("singular/plural de una existente => se sugiere usarla ('Anillo' -> 'Anillos'); la persona decide", () => {
    const rows = [base(2, { category: "Anillo" })];
    const a = analyzeImport({ ...ctx, images: [], rows });
    assert.deepEqual(a.categories[0].suggestion, { id: "c-anillos", name: "Anillos" });
    assert.deepEqual(a.rows[0].product?.category, { kind: "existing", id: "c-anillos", name: "Anillos" });
    const crear = analyzeImport({ ...ctx, images: [], rows, decisions: { anillo: { action: "create" } } });
    assert.deepEqual(crear.rows[0].product?.category, { kind: "new", key: "anillo", label: "Anillo" });
    const ninguna = analyzeImport({ ...ctx, images: [], rows, decisions: { anillo: { action: "none" } } });
    assert.deepEqual(ninguna.rows[0].product?.category, { kind: "none" });
    const invalida = analyzeImport({ ...ctx, images: [], rows, decisions: { anillo: { action: "use", categoryId: "no-existe" } } });
    assert.deepEqual(invalida.rows[0].product?.category, { kind: "existing", id: "c-anillos", name: "Anillos" }, "una decisión inválida vuelve a la propuesta");
  });

  it("imágenes: principal + galería en orden; inexistente e inválida => advertencia; sin foto => advertencia", () => {
    const a = analyzeImport({
      ...ctx,
      images: [img("Anillo-Corazon.JPG"), img("anillo-2.jpeg"), img("aretes.heic", "heic"), img("sobrante.png")],
      rows: [base(2, { images: "anillo-corazon.jpg; anillo-2, anillo3.jpg" }), base(3, { images: "aretes.heic" }), base(4)],
    });
    assert.deepEqual(a.rows[0].images, [
      { requested: "anillo-corazon.jpg", file: "Anillo-Corazon.JPG" },
      { requested: "anillo-2", file: "anillo-2.jpeg" },
    ]);
    assert.ok(a.rows[0].issues.some((i) => i.message === "Fila 2: no encontramos la imagen «anillo3.jpg». Agrégala antes de importar o súbela después desde el producto."));
    assert.equal(a.rows[0].status, "warning");
    assert.ok(a.rows[1].issues.some((i) => i.code === "image_invalid" && /HEIC/.test(i.message)));
    assert.deepEqual(a.rows[1].images, []);
    assert.ok(a.rows[2].issues.some((i) => i.code === "no_image"));
    assert.equal(a.summary.importable, 3, "las advertencias no impiden importar");
    assert.deepEqual(a.summary.photos, { matched: 2, missing: 1, unused: ["sobrante.png"] });
  });

  it("sin ninguna foto en todo el lote => un solo aviso general (no una advertencia por fila)", () => {
    const a = analyzeImport({ ...ctx, images: [], rows: [base(2), base(3)] });
    assert.ok(a.rows.every((r) => r.status === "ready"));
    assert.equal(a.notices.length, 1);
  });

  it("más de 12 fotos en una fila => se usan las primeras 12", () => {
    const names = Array.from({ length: 14 }, (_, i) => `f${i}.jpg`);
    const a = analyzeImport({ ...ctx, images: names.map((n) => img(n)), rows: [base(2, { images: names.join(",") })] });
    assert.equal(a.rows[0].images.length, IMPORT_LIMITS.imagesPerProduct);
    assert.ok(a.rows[0].issues.some((i) => i.code === "too_many_images"));
  });

  it("repetidos: en el archivo => error; en el catálogo => se omite salvo que se fuerce", () => {
    const existing = [{ reference: "DL-000184", name: "Anillo Corazón", categoryId: "c-anillos", color: "Dorado", material: null }];
    const rows = [
      base(2, { name: "Anillo corazón", category: "Anillos", color: "dorado" }),
      base(3, { name: "Aretes", color: "Plateado" }),
      base(4, { name: "aretes ", color: "plateado" }),
      base(5, { name: "Aretes", color: "Dorado" }),
    ];
    const a = analyzeImport({ categories: ctx.categories, existing, images: [], rows });
    assert.equal(a.rows[0].status, "duplicate");
    assert.match(a.rows[0].issues[0].message, /ya existe «Anillo Corazón» en tu catálogo \(DL-000184\)/);
    assert.equal(a.rows[1].status, "ready");
    assert.equal(a.rows[2].status, "error");
    assert.equal(a.rows[2].issues[0].message, "Fila 4: repite el producto de la fila 3 (mismo nombre, categoría, color y material).");
    assert.equal(a.rows[3].status, "ready", "mismo nombre, otro color => producto distinto");
    assert.deepEqual([a.summary.duplicates, a.summary.errors, a.summary.importable], [1, 1, 2]);
    const forzado = analyzeImport({ categories: ctx.categories, existing, images: [], rows, force: [2] });
    assert.equal(forzado.rows[0].status, "warning");
    assert.equal(forzado.rows[0].forced, true);
    assert.equal(forzado.summary.importable, 3);
  });
});

describe("fotos: firma real, nombres y validez", () => {
  it("formato por los primeros bytes, nunca por la extensión", () => {
    assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
    assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png");
    assert.equal(sniffImage(WEBP_HEAD), "webp");
    assert.equal(sniffImage(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), "heic");
    assert.equal(sniffImage(enc.encode("%PDF-1.7 xxxxxxxx")), "unknown");
    assert.equal(imageProblem("jpeg", 0), "empty");
    assert.equal(imageProblem("unknown", 10), "format");
    assert.equal(imageProblem("jpeg", IMPORT_LIMITS.imageBytes + 1), "size");
    assert.equal(imageProblem("png", 10), null);
  });

  it("celda de imágenes: separadores, comillas y repetidos", () => {
    assert.deepEqual(splitImageCell(' "a.jpg" , b.jpg;c.png | a.JPG\nfotos/d.webp '), ["a.jpg", "b.jpg", "c.png", "fotos/d.webp"]);
    const idx = buildImageIndex([img("d.webp"), img("x.jpg"), img("x.png")]);
    assert.equal(idx.find("fotos/d.webp")?.name, "d.webp", "la carpeta del nombre pedido no importa");
    assert.equal(idx.find("x")?.name, undefined, "nombre base ambiguo => no se adivina");
  });
});

// ---------------------------------------------------------------------------
// Servicio: creación segura, parcial, idempotente y aislada por tenant
// ---------------------------------------------------------------------------

describe("servicio de carga masiva", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let catalog: ReturnType<typeof createCatalogService>;
  let imports: ReturnType<typeof createCatalogImportService>;

  beforeEach(() => {
    mem = createInMemoryCatalogRepository();
    catalog = createCatalogService({ repo: mem.repo });
    imports = createCatalogImportService({ repo: mem.repo, catalog });
  });

  const req = (rows: RawRow[], extra: Partial<Parameters<typeof imports.createRows>[2]> = {}) => ({ rows, images: [], decisions: {}, force: [], ...extra });

  it("crea los productos con referencias de la BD (secuenciales, nunca del archivo) y stock controlado", async () => {
    await catalog.createProduct(DELACOUR, { name: "Existente", retailPrice: 1000, stock: 1 });
    const imp = await imports.start(DELACOUR, { fileName: "productos.xlsx", totalRows: 3 });
    const res = await imports.createRows(DELACOUR, imp.id, req([base(2), base(3), base(4, { name: "DL-000999" })]));
    assert.deepEqual(
      res.map((r) => [r.row, r.status, r.reference]),
      [
        [2, "created", "DL-000002"],
        [3, "created", "DL-000003"],
        [4, "created", "DL-000004"],
      ],
    );
    const p = await catalog.getProduct(DELACOUR, res[0].productId!);
    assert.deepEqual([p.tracksStock, p.stock, p.pricing.retail], [true, 3, 10000]);
  });

  it("importación parcial: 1 error de validación y 1 fallo de BD no detienen las demás filas", async () => {
    mem.failInsert((d) => d.name === "Falla BD");
    const imp = await imports.start(DELACOUR, { fileName: "p.csv", totalRows: 4 });
    const res = await imports.createRows(DELACOUR, imp.id, req([base(2), base(3, { retailPrice: "" }), base(4, { name: "Falla BD" }), base(5)]));
    assert.deepEqual(
      res.map((r) => r.status),
      ["created", "error", "error", "created"],
    );
    assert.equal(res[1].message, "Fila 3: el precio detal es obligatorio.");
    assert.equal(res[2].message, "Fila 4: no se pudo crear el producto. Intenta de nuevo.", "nunca un error técnico");
    const done = await imports.finish(DELACOUR, imp.id, { skipped: 0, errors: 2, photosUploaded: 0, photosFailed: 0 });
    assert.deepEqual([done.status, done.created, done.errors], ["completada", 2, 2]);
    await assert.rejects(imports.createRows(DELACOUR, imp.id, req([base(9)])), /ya terminó/);
  });

  it("reintento del mismo lote (red caída / doble clic): idempotente, nunca duplica", async () => {
    const imp = await imports.start(DELACOUR, { fileName: "p.csv", totalRows: 2 });
    const primero = await imports.createRows(DELACOUR, imp.id, req([base(2, { images: "a.jpg" }), base(3)], { images: [img("a.jpg")] }));
    const segundo = await imports.createRows(DELACOUR, imp.id, req([base(2, { images: "a.jpg" }), base(3)], { images: [img("a.jpg")] }));
    assert.deepEqual(
      segundo.map((r) => [r.status, r.reference, r.images]),
      primero.map((r) => [r.status, r.reference, r.images]),
    );
    assert.equal(mem.snapshot(DELACOUR.tenantId).length, 2);
  });

  it("categorías nuevas: se crean UNA vez aunque aparezcan en varios lotes y con otra escritura", async () => {
    const imp = await imports.start(DELACOUR, { fileName: "p.csv", totalRows: 3 });
    await imports.createRows(DELACOUR, imp.id, req([base(2, { category: "Argollas" })]));
    await imports.createRows(DELACOUR, imp.id, req([base(3, { category: "ARGOLLAS" }), base(4, { category: "argollas" })]));
    const cats = await catalog.listCategories(DELACOUR);
    assert.deepEqual(
      cats.map((c) => c.name),
      ["Argollas"],
    );
    const productos = mem.snapshot(DELACOUR.tenantId);
    assert.ok(productos.every((p) => p.categoryId === cats[0].id && p.categoryName === "Argollas"));
  });

  it("repetidos del catálogo se omiten (o se crean si se fuerza); los productos existentes quedan INTACTOS", async () => {
    const existente = await catalog.createProduct(DELACOUR, { name: "Anillo corazón", retailPrice: 5000, stock: 9, color: "Dorado" });
    const antes = mem.snapshot(DELACOUR.tenantId);
    const imp = await imports.start(DELACOUR, { fileName: "p.csv", totalRows: 2 });
    const res = await imports.createRows(DELACOUR, imp.id, req([base(2, { name: "ANILLO CORAZÓN", color: "dorado", retailPrice: "99999", stock: "0" }), base(3)]));
    assert.deepEqual(
      res.map((r) => r.status),
      ["skipped", "created"],
    );
    assert.match(res[0].message!, new RegExp(existente.reference));
    assert.deepEqual(mem.snapshot(DELACOUR.tenantId).find((p) => p.id === existente.id), antes[0], "nunca se actualiza un producto existente");
    const forzado = await imports.createRows(DELACOUR, imp.id, req([base(2, { name: "ANILLO CORAZÓN", color: "dorado" })], { force: [2] }));
    assert.equal(forzado[0].status, "created");
    assert.notEqual(forzado[0].reference, existente.reference);
  });

  it("multi-tenant: la importación de otro negocio no existe; sus productos y categorías no se tocan ni se usan", async () => {
    await catalog.createCategory(OTRO, { name: "Anillos" });
    const ajeno = await catalog.createProduct(OTRO, { name: "Pieza 2", retailPrice: 10000, stock: 3 });
    const impOtro = await imports.start(OTRO, { fileName: "otro.csv", totalRows: 1 });
    await assert.rejects(imports.createRows(DELACOUR, impOtro.id, req([base(2)])), /no existe/);
    await assert.rejects(imports.finish(DELACOUR, impOtro.id, { skipped: 0, errors: 0, photosUploaded: 0, photosFailed: 0 }), /no existe/);

    const imp = await imports.start(DELACOUR, { fileName: "p.csv", totalRows: 1 });
    const res = await imports.createRows(DELACOUR, imp.id, req([base(2, { category: "Anillos" })]));
    assert.equal(res[0].status, "created", "el mismo producto en OTRO negocio no es un repetido");
    const [cat] = await catalog.listCategories(DELACOUR);
    assert.equal(cat.name, "Anillos");
    assert.notEqual(cat.id, (await catalog.listCategories(OTRO))[0].id, "se crea en Delacour, no se reutiliza la del otro negocio");
    assert.deepEqual(await imports.history(DELACOUR).then((h) => h.map((i) => i.fileName)), ["p.csv"]);

    // Fotos: solo a productos creados por ESTA importación.
    const fotos = await imports.photoUploadUrls(DELACOUR, imp.id, [{ productId: ajeno.id, mimeType: "image/webp", bytes: 10, thumbBytes: 10 }]);
    assert.deepEqual(fotos, [{ productId: ajeno.id, ok: false, message: "El producto no pertenece a esta importación." }]);
  });

  it("fotos: la primera es la principal y las demás van a la galería existente (mismas verificaciones)", async () => {
    const imp = await imports.start(DELACOUR, { fileName: "p.csv", totalRows: 1 });
    const [creado] = await imports.createRows(DELACOUR, imp.id, req([base(2, { images: "a.jpg, b.jpg" })], { images: [img("a.jpg"), img("b.jpg")] }));
    assert.deepEqual(creado.images, ["a.jpg", "b.jpg"]);
    const tickets = await imports.photoUploadUrls(
      DELACOUR,
      imp.id,
      creado.images.map(() => ({ productId: creado.productId!, mimeType: "image/webp" as const, bytes: 10, thumbBytes: 10 })),
    );
    const subidos = tickets.map((t) => {
      assert.ok(t.ok);
      mem.putObject(t.upload.image.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
      mem.putObject(t.upload.thumb.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
      return t.upload;
    });
    // La segunda subida es inválida (firma falsa): se rechaza SOLO esa foto.
    mem.putObject(subidos[1].image.path, { size: 10, contentType: "image/webp", head: enc.encode("no es imagen xxxx") });
    const conf = await imports.confirmPhotos(
      DELACOUR,
      imp.id,
      subidos.map((u, i) => ({ productId: creado.productId!, uploadId: u.uploadId, mimeType: "image/webp" as const, width: 800, height: 800, makePrimary: i === 0 })),
    );
    assert.deepEqual(
      conf.map((c) => c.ok),
      [true, false],
    );
    const detalle = await catalog.getProduct(DELACOUR, creado.productId!);
    assert.equal(detalle.images.length, 1);
    assert.equal(detalle.images[0].isPrimary, true);
    assert.ok(detalle.primaryImage, "la principal queda como foto del producto");
  });

  it("producto sin imagen: se crea igual, sin fotos pendientes", async () => {
    const imp = await imports.start(DELACOUR, { fileName: "p.csv", totalRows: 1 });
    const [r] = await imports.createRows(DELACOUR, imp.id, req([base(2)]));
    assert.deepEqual([r.status, r.images], ["created", []]);
  });

  it("análisis (preview) no escribe nada", async () => {
    const a = await imports.analyze(DELACOUR, req([base(2, { category: "Nueva" })]));
    assert.equal(a.summary.importable, 1);
    assert.equal(mem.snapshot(DELACOUR.tenantId).length, 0);
    assert.deepEqual(await catalog.listCategories(DELACOUR), []);
  });
});

describe("límites del contrato HTTP", () => {
  it("lotes acotados y sin campos extra (ni tenant, ni referencia)", () => {
    const rows = Array.from({ length: IMPORT_LIMITS.rowsPerBatch + 1 }, (_, i) => base(i + 2));
    assert.equal(importRowsSchema.safeParse({ rows }).success, false);
    assert.equal(importRowsSchema.safeParse({ rows: rows.slice(0, 2) }).success, true);
    assert.equal(importRowsSchema.safeParse({ rows: rows.slice(0, 2), tenantId: DELACOUR.tenantId }).success, false);
    assert.equal(importRowsSchema.safeParse({ rows: [{ row: 2, values: { name: "x", referencia: "DL-1" } }] }).success, false);
    const fotos = Array.from({ length: IMPORT_LIMITS.images + 1 }, (_, i) => img(`f${i}.jpg`));
    assert.equal(analyzeRowsSchema.safeParse({ rows: [base(2)], images: fotos }).success, false, "demasiadas imágenes");
    const items = Array.from({ length: IMPORT_LIMITS.photosPerBatch + 1 }, () => ({ productId: "00000000-0000-4000-8000-000000000001", mimeType: "image/webp", bytes: 10, thumbBytes: 10 }));
    assert.equal(photoUrlsSchema.safeParse({ items }).success, false);
  });
});

// ---------------------------------------------------------------------------
// ZIP (lector nativo)
// ---------------------------------------------------------------------------

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP mínimo para pruebas (CRC en 0: el lector no lo usa; deflate se verifica al descomprimir). */
async function makeZip(files: Array<{ name: string; data: Uint8Array; deflate?: boolean; flags?: number; declaredSize?: number }>): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const body = f.deflate ? await deflateRaw(f.data) : f.data;
    const flags = (f.flags ?? 0) | 0x800;
    const local = new Uint8Array(30 + name.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, f.deflate ? 8 : 0, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, f.declaredSize ?? f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, f.deflate ? 8 : 0, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.declaredSize ?? f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

describe("ZIP de fotos + planilla", () => {
  it("lee entradas guardadas y comprimidas (con carpetas y nombres con tildes)", async () => {
    const foto = new Uint8Array(5000).fill(7);
    const zip = await makeZip([
      { name: "catalogo/productos.csv", data: enc.encode("nombre,precio_detal,stock\nAnillo,1000,1") },
      { name: "catalogo/imágenes/anillo-corazón.jpg", data: foto, deflate: true },
      { name: "__MACOSX/catalogo/._anillo.jpg", data: new Uint8Array(4) },
    ]);
    const entries = readZipIndex(zip, IMPORT_LIMITS.zipEntries);
    assert.deepEqual(
      entries.map((e) => e.path),
      ["catalogo/productos.csv", "catalogo/imágenes/anillo-corazón.jpg", "__MACOSX/catalogo/._anillo.jpg"],
    );
    assert.equal(entries.filter((e) => !isSystemEntry(e.path)).length, 2);
    assert.deepEqual(await entries[1].read(10_000), foto);
    assert.equal(new TextDecoder().decode(await entries[0].read(10_000)).split("\n")[1], "Anillo,1000,1");
  });

  it("rechaza ZIP inválido, cifrado, con demasiadas entradas y 'zip bombs'", async () => {
    assert.throws(() => readZipIndex(enc.encode("no es zip"), 10), (e: Error) => e instanceof ZipError && e.reason === "invalid");
    const cifrado = await makeZip([{ name: "a.jpg", data: new Uint8Array(10), flags: 1 }]);
    assert.throws(() => readZipIndex(cifrado, 10), (e: Error) => e instanceof ZipError && e.reason === "encrypted");
    const varios = await makeZip([1, 2, 3].map((i) => ({ name: `${i}.jpg`, data: new Uint8Array(1) })));
    assert.throws(() => readZipIndex(varios, 2), (e: Error) => e instanceof ZipError && e.reason === "too_many_entries");
    // Declara 100 bytes pero al descomprimir son 1 MB: se corta.
    const bomba = await makeZip([{ name: "a.jpg", data: new Uint8Array(1024 * 1024), deflate: true, declaredSize: 100 }]);
    const [e] = readZipIndex(bomba, 10);
    await assert.rejects(e.read(1000), (err: Error) => err instanceof ZipError && err.reason === "too_large");
  });
});

describe("plantilla CSV", () => {
  it("encabezados de la plantilla = columnas reconocidas", () => {
    const [header] = parseCsv(buildTemplateCsv());
    assert.deepEqual(
      header.map((h) => columnFor(h)),
      COLUMNS.map((c) => c.key),
    );
    assert.equal(toCsv([["a,b", 'c"d']]), '"a,b","c""d"');
  });
});

// ---------------------------------------------------------------------------
// Orquestación en el navegador (con el servicio REAL en memoria detrás)
// ---------------------------------------------------------------------------

describe("orquestación de la importación", () => {
  function setup() {
    const mem = createInMemoryCatalogRepository();
    const catalog = createCatalogService({ repo: mem.repo });
    const imports = createCatalogImportService({ repo: mem.repo, catalog });
    const calls: string[] = [];
    let fail429 = 0;
    const ok = <T,>(data: T) => ({ ok: true as const, data });
    const deps: ImportRunDeps<{ uploadId: string; image: { path: string }; thumb: { path: string } }> = {
      startImport: async (fileName, totalRows) => ok({ import: await imports.start(DELACOUR, { fileName, totalRows }) }),
      importRows: async (id, body) => {
        calls.push(`rows:${body.rows.map((r) => r.row).join(",")}`);
        if (fail429 > 0) {
          fail429--;
          return { ok: false as const, error: { code: "RATE_LIMITED", message: "Demasiadas solicitudes.", status: 429 } };
        }
        return ok({ results: await imports.createRows(DELACOUR, id, body) });
      },
      photoUrls: async (id, items) => {
        calls.push(`urls:${items.length}`);
        return ok({ results: (await imports.photoUploadUrls(DELACOUR, id, items)) as never });
      },
      confirmPhotos: async (id, items) => {
        calls.push(`confirm:${items.map((i) => (i.makePrimary ? "P" : "g")).join("")}`);
        return ok({ results: await imports.confirmPhotos(DELACOUR, id, items) });
      },
      finishImport: async (id, counts) => ok({ import: await imports.finish(DELACOUR, id, counts) }),
      prepare: async (file) => {
        if (file.name.startsWith("rota")) throw new Error("No pudimos leer esta imagen. Usa una foto JPG, PNG o WEBP.");
        return { image: new Blob([new Uint8Array(10)]), thumb: new Blob([new Uint8Array(10)]), mimeType: "image/webp", width: 800, height: 800 };
      },
      upload: async (ticket) => {
        mem.putObject(ticket.image.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
        mem.putObject(ticket.thumb.path, { size: 10, contentType: "image/webp", head: WEBP_HEAD });
        return ok(null);
      },
      imageFile: (name) => new File([new Uint8Array(10)], name),
      sleep: async () => {},
    };
    return { mem, catalog, deps, calls, set429: (n: number) => (fail429 = n) };
  }

  it("lotes de filas y de fotos; principal primero; una foto rota no afecta al resto; 429 se reintenta", async () => {
    const { mem, catalog, deps, calls, set429 } = setup();
    set429(1);
    const rows = Array.from({ length: IMPORT_LIMITS.rowsPerBatch + 2 }, (_, i) => base(i + 2, { images: i === 0 ? "a.jpg, b.jpg, rota.jpg" : "" }));
    const images = [img("a.jpg"), img("b.jpg"), img("rota.jpg")];
    const progress: ImportProgress[] = [];
    const report = await runImport({ fileName: "p.xlsx", rows, images, decisions: {}, force: [] }, deps, (p) => progress.push(p));

    assert.equal(report.rows.filter((r) => r.status === "created").length, rows.length);
    assert.equal(calls.filter((c) => c.startsWith("rows:")).length, 3, "1 reintento por 429 + 2 lotes");
    assert.ok(calls.includes("confirm:Pg"), "principal y luego galería, en orden");
    assert.equal(report.photosUploaded, 2);
    assert.deepEqual(
      report.photoFailures.map((f) => [f.row, f.file]),
      [[2, "rota.jpg"]],
    );
    assert.equal(report.record?.status, "completada");
    assert.equal(report.record?.created, rows.length);
    const detalle = await catalog.getProduct(DELACOUR, report.rows[0].productId!);
    assert.deepEqual(
      detalle.images.map((i) => i.isPrimary),
      [true, false],
    );
    assert.equal(progress.at(-1)?.phase, "finishing");
    assert.equal(mem.snapshot(DELACOUR.tenantId).length, rows.length);
  });

  it("si la red falla en un lote, esas filas quedan con error y el resto continúa; reintentar no duplica", async () => {
    const { deps, mem } = setup();
    let caida = true;
    const original = deps.importRows;
    deps.importRows = async (id, body) => {
      if (caida && body.rows[0].row === 2) {
        caida = false;
        // La petición llegó y creó los productos, pero la respuesta se perdió (peor caso).
        await original(id, body);
        return { ok: false as const, error: { code: "NETWORK_ERROR", message: "Sin conexión.", status: 0 } };
      }
      return original(id, body);
    };
    const report = await runImport({ fileName: "p.csv", rows: [base(2), base(3)], images: [], decisions: {}, force: [] }, deps, () => {});
    assert.deepEqual(
      report.rows.map((r) => r.status),
      ["created", "created"],
      "el reintento automático recupera los ya creados (idempotente)",
    );
    assert.equal(mem.snapshot(DELACOUR.tenantId).length, 2);
  });

  it("si no se puede iniciar (p. ej. carga masiva no activada), no se crea nada y se informa", async () => {
    const { deps, mem } = setup();
    deps.startImport = async () => ({ ok: false as const, error: { code: "FEATURE_UNAVAILABLE", message: "La carga masiva todavía no está activada.", status: 503 } });
    await assert.rejects(runImport({ fileName: "p.csv", rows: [base(2)], images: [], decisions: {}, force: [] }, deps, () => {}), (e: Error) => e instanceof ImportStartError && /no está activada/.test(e.message));
    assert.equal(mem.snapshot(DELACOUR.tenantId).length, 0);
  });
});
