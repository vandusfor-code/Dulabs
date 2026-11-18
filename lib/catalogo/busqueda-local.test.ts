/**
 * Búsqueda LOCAL de piezas (lib/catalogo/busqueda-local.ts): las reglas de la búsqueda SQL del agente (sin tildes, plural/singular, prefijos, pesos, filtros, orden) sobre un
 * conjunto pequeño en memoria. Sin red ni base: negocio y piezas FICTICIOS.
 *
 * La comparación más importante: sobre los MISMOS datos, `buscarEnPiezas` debe dar lo mismo que la emulación de `dulabs_catalogo_buscar` que usan las demás pruebas
 * (lib/catalogo/testing/in-memory-repository.ts): si una de las dos cambia de criterio, esta prueba lo dice.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { buscarEnPiezas, normalizarParaBusqueda, palabrasDeBusqueda, raizDePalabra, type ConsultaLocal } from "@/lib/catalogo/busqueda-local";
import type { CatalogProduct } from "@/lib/catalogo/domain";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let piezas: CatalogProduct[];
let cat: Record<string, string>;

const consulta = (over: Partial<ConsultaLocal> = {}): ConsultaLocal => ({ text: "", mode: "all", channel: "retail", ...over });
const nombres = (refs: string[]) => refs.map((r) => piezas.find((p) => p.reference === r)!.name);

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  mem.setProfile(A.tenantId, { name: "Joyería de prueba", whatsapp: "573001110000" });
  mem.enableModule(A.tenantId);
  cat = { anillos: (await admin.createCategory(A, { name: "Anillos" })).id, dijes: (await admin.createCategory(A, { name: "Dijes" })).id, aretes: (await admin.createCategory(A, { name: "Aretes" })).id };
  const nuevo = (name: string, o: { cat: string; material?: string; color?: string; retail?: number; wholesale?: number | null; stock?: number; description?: string }) =>
    admin.createProduct(A, { name, categoryId: o.cat, material: o.material, color: o.color, retailPrice: o.retail ?? 20_000, wholesalePrice: o.wholesale ?? null, stock: o.stock ?? 10, description: o.description });
  await nuevo("Anillo corazón", { cat: cat.anillos, material: "Rodio", color: "Dorado", description: "Brilla con tu luz" });
  await nuevo("Anillos pareja", { cat: cat.anillos, material: "Plata 925", color: "Plateado", retail: 45_000 });
  await nuevo("Dije San Benito", { cat: cat.dijes, material: "Acero", color: "Negro", retail: 10_000 });
  await nuevo("Dijes cruz plana", { cat: cat.dijes, material: "Acero", retail: 12_000, stock: 0 });
  await nuevo("Aretes de argolla", { cat: cat.aretes, material: "Rodio", color: "Dorado", retail: 30_000 });
  await nuevo("Pulsera de cuero", { cat: cat.aretes, material: "Cuero", color: "Café", retail: 15_000, description: "Cierre de acero" });
  piezas = (await mem.repo.listProducts(A.tenantId, { status: "ALL", offset: 0, limit: 100 })).items;
});

describe("normalización y raíces", () => {
  it("minúsculas y sin tildes, pero conserva la ñ", () => {
    assert.equal(normalizarParaBusqueda("ÁRBOL de Niño ÑANDÚ"), "arbol de niño ñandu");
  });

  it("plural y singular dan la misma raíz (aretes/arete, dijes/dije, anillos/anillo, collares/collar)", () => {
    for (const [a, b] of [["aretes", "arete"], ["dijes", "dije"], ["anillos", "anillo"], ["collares", "collar"], ["pulseras", "pulsera"], ["cadenas", "cadena"], ["aceros", "acero"]]) {
      assert.equal(raizDePalabra(a), raizDePalabra(b), `${a} ~ ${b}`);
    }
  });

  it("una raíz nunca queda de menos de 3 letras por quitar el plural («tres» no se vuelve «tr»)", () => {
    assert.equal(raizDePalabra("tres"), "tre");
    assert.equal(raizDePalabra("oro"), "oro");
    assert.ok(raizDePalabra("mes").length >= 3);
  });

  it("las palabras vacías (artículos, preposiciones, pronombres, posesivos) y las de una letra no buscan nada", () => {
    assert.deepEqual(palabrasDeBusqueda("un anillo de la sirena para y"), [raizDePalabra("anillo"), raizDePalabra("sirena")]);
    assert.deepEqual(palabrasDeBusqueda("un anillo para mi novio, que sea de tu estilo"), [raizDePalabra("anillo"), raizDePalabra("novio"), raizDePalabra("sea"), raizDePalabra("estilo")]);
  });
});

describe("buscarEnPiezas", () => {
  it("plural/singular y prefijos: «dije» y «dijes» encuentran los dos dijes; «dora» encuentra lo dorado", () => {
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ text: "dije" }))).sort(), ["Dije San Benito", "Dijes cruz plana"]);
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ text: "dijes" }))).sort(), ["Dije San Benito", "Dijes cruz plana"]);
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ text: "dora" }))).sort(), ["Anillo corazón", "Aretes de argolla"]);
  });

  it("sin tildes ni mayúsculas: «CORAZON» encuentra «corazón»", () => {
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ text: "CORAZON" }))), ["Anillo corazón"]);
  });

  it("all = todas las palabras; any = alguna", () => {
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ text: "anillo dorado" }))), ["Anillo corazón"]);
    assert.deepEqual(buscarEnPiezas(piezas, consulta({ text: "anillo plateado dorado" })), []);
    // Alguna: los dos anillos (cumplen con dos palabras cada uno) y los aretes dorados (con una: al final).
    const alguna = nombres(buscarEnPiezas(piezas, consulta({ text: "anillo plateado dorado", mode: "any" })));
    assert.deepEqual([...alguna].sort(), ["Anillo corazón", "Anillos pareja", "Aretes de argolla"]);
    assert.equal(alguna.at(-1), "Aretes de argolla", "una sola coincidencia: al final");
  });

  it("el nombre pesa más que la descripción: «acero» pone primero lo que lo dice en el nombre o el material y al final lo que solo lo menciona", () => {
    const orden = nombres(buscarEnPiezas(piezas, consulta({ text: "acero" })));
    assert.equal(orden.at(-1), "Pulsera de cuero", "solo lo menciona en la descripción");
    assert.equal(orden.length, 3);
  });

  it("filtros: categoría (nombre e id), color, material y precio máximo del canal", () => {
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ category: "dijes" }))).sort(), ["Dije San Benito", "Dijes cruz plana"]);
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ categoryId: cat.anillos }))).sort(), ["Anillo corazón", "Anillos pareja"]);
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ color: "negro" }))), ["Dije San Benito"]);
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ material: "plata" }))), ["Anillos pareja"]);
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ maxPrice: 15_000 }))).sort(), ["Dije San Benito", "Dijes cruz plana", "Pulsera de cuero"]);
  });

  it("el precio máximo es el del CANAL: sin precio mayorista la pieza no cumple en wholesale", () => {
    assert.deepEqual(buscarEnPiezas(piezas, consulta({ channel: "wholesale", maxPrice: 1_000_000 })), []);
  });

  it("referencias excluidas y piezas no activas no salen", async () => {
    const [primera] = buscarEnPiezas(piezas, consulta({ text: "dije" }));
    assert.ok(!buscarEnPiezas(piezas, consulta({ text: "dije", exclude: [primera] })).includes(primera));
    const inactiva = piezas.map((p) => (p.reference === primera ? { ...p, status: "INACTIVE" as const } : p));
    assert.ok(!buscarEnPiezas(inactiva, consulta({ text: "dije" })).includes(primera));
  });

  it("sin texto cumplen todas las activas; las disponibles van antes que las agotadas", () => {
    const refs = buscarEnPiezas(piezas, consulta({ text: "" }));
    assert.equal(refs.length, 6);
    assert.equal(nombres(refs).at(-1), "Dijes cruz plana", "agotado: al final aunque sea el filtro más amplio");
  });

  it("máximo 8 palabras (como la función SQL): la novena no se exige", () => {
    // Las 8 primeras las cumple «Anillo corazón»; la novena («zzzz») no existe en ninguna pieza y, si se exigiera, no saldría nada.
    assert.deepEqual(nombres(buscarEnPiezas(piezas, consulta({ text: "anillo corazon dorado rodio brilla luz anillos corazon zzzz" }))), ["Anillo corazón"]);
    assert.deepEqual(buscarEnPiezas(piezas, consulta({ text: "anillo corazon dorado rodio brilla luz anillos zzzz" })), [], "con la palabra inexistente entre las 8 primeras sí se exige");
  });
});

describe("equivalencia con la emulación de la búsqueda SQL (las mismas piezas, las mismas consultas)", () => {
  const casos: Array<[string, Partial<ConsultaLocal>]> = [
    ["anillo", {}],
    ["anillos", {}],
    ["aretes", {}],
    ["dorado", {}],
    ["rodio dorado", {}],
    ["anillo dorado", {}],
    ["anillo plateado dorado", { mode: "any" }],
    ["plata", {}],
    ["", {}],
    ["", { category: "dijes" }],
    ["", { color: "dorado" }],
    ["", { material: "acero" }],
    ["", { maxPrice: 20_000 }],
    ["acero", { maxPrice: 12_000 }],
    ["pulsera", { channel: "retail" }],
    ["corazon", {}],
  ];
  for (const [text, extra] of casos) {
    it(`«${text}» ${JSON.stringify(extra)}`, async () => {
      const q = consulta({ text, ...extra });
      const local = buscarEnPiezas(piezas, q);
      const sql = await mem.repo.searchCatalog(A.tenantId, { text, mode: q.mode, channel: q.channel, limit: 20, offset: 0, category: q.category ?? null, color: q.color ?? null, material: q.material ?? null, categoryId: q.categoryId ?? null, maxPrice: q.maxPrice ?? null, exclude: [] });
      assert.deepEqual(local, sql?.references ?? []);
    });
  }
});
