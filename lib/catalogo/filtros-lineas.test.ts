/**
 * El filtro por LÍNEA (`?linea=plata`) dentro de los filtros del catálogo público (lib/catalogo/filtros.ts): cómo se lee de la dirección, cómo viaja en ella, qué piezas cumplen y cómo se
 * cuentan las líneas en las facetas. Y lo que NO cambia: sin línea, los filtros, las direcciones y las facetas tienen EXACTAMENTE la forma de siempre.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIN_FILTROS, calcularFacetas, cumpleFiltros, filtrosDeTexto, hayFiltros, leerFiltros, paramsDeFiltros, soloUnaCategoria, textoDeFiltros, urlFiltros, type FilaFaceta } from "@/lib/catalogo/filtros";
import { PARAMS_LISTADO, esListado, esListadoDeUrl } from "@/lib/catalogo/inicio";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

const LINEAS = storefrontConfigFor("delacour").joyeria!.lineas!.lineas;
const ANILLOS = "6292c223-1062-4823-801b-34e06037f534";
const ARETES = "edf4d808-2264-4eb1-9d88-b41a9eccccb7";
const BASE = "/catalogo/delacour";

const fila = (over: Partial<FilaFaceta> = {}): FilaFaceta => ({ categoryId: ANILLOS, color: "Dorado", material: "Rodio", price: 20_000, ...over });

describe("leerFiltros: la dirección trae la línea", () => {
  it("una línea válida se lee tal cual, en minúsculas", () => {
    assert.deepEqual(leerFiltros({ linea: "plata" }), { lineas: ["plata"], categorias: [], colores: [], materiales: [] });
    assert.deepEqual(leerFiltros({ linea: "Cover-Gold" }).lineas, ["cover-gold"]);
    assert.deepEqual(leerFiltros({ linea: "  rodio " }).lineas, ["rodio"]);
  });

  it("varias líneas (repetidas o no) se leen sin duplicar", () => {
    assert.deepEqual(leerFiltros({ linea: ["plata", "rodio", "plata"] }).lineas, ["plata", "rodio"]);
  });

  it("lo que no es una clave de línea bien formada se ignora (nunca un error)", () => {
    for (const mal of ["", "Plata Ley", "pla/ta", "../x", "a".repeat(31), "cover--gold"]) assert.equal(leerFiltros({ linea: mal }).lineas, undefined, mal);
    assert.equal(leerFiltros({ linea: ["", "???"] }).lineas, undefined);
  });

  it("tiene un tope de valores, como los demás grupos", () => {
    const muchas = Array.from({ length: 30 }, (_, i) => `linea-${i}`);
    assert.equal(leerFiltros({ linea: muchas }).lineas!.length, 12);
  });

  it("SIN línea la forma es la de siempre: ni siquiera existe la propiedad", () => {
    assert.deepEqual(leerFiltros({ color: "dorado" }), { categorias: [], colores: ["dorad"], materiales: [] });
    assert.ok(!("lineas" in leerFiltros({})));
    assert.deepEqual(SIN_FILTROS, { categorias: [], colores: [], materiales: [] });
  });
});

describe("la línea viaja en la dirección", () => {
  it("«?linea=plata» y «?linea=plata&categoria=…»: la línea va primero y la dirección es estable", () => {
    assert.equal(urlFiltros(BASE, { ...SIN_FILTROS, lineas: ["plata"] }), `${BASE}?linea=plata`);
    assert.equal(urlFiltros(BASE, { ...SIN_FILTROS, lineas: ["plata"], categorias: [ANILLOS] }), `${BASE}?linea=plata&categoria=${ANILLOS}`);
    assert.equal(urlFiltros(BASE, { ...SIN_FILTROS, lineas: ["cover-gold"], colores: ["dorad"] }, 2), `${BASE}?linea=cover-gold&color=dorad&pagina=2`);
  });

  it("ida y vuelta: lo que se escribe se lee igual (el texto sirve de argumento a las cargas con caché)", () => {
    const f = { ...SIN_FILTROS, lineas: ["plata", "rodio"], categorias: [ANILLOS, ARETES], precioMax: 30_000 };
    assert.equal(textoDeFiltros(f), `linea=plata&linea=rodio&categoria=${ANILLOS}&categoria=${ARETES}&precio_max=30000`);
    assert.deepEqual(filtrosDeTexto(textoDeFiltros(f)), f);
  });

  it("sin línea las direcciones son las de siempre", () => {
    assert.equal(urlFiltros(BASE, SIN_FILTROS), `${BASE}?todo=1`);
    assert.equal(urlFiltros(BASE, { ...SIN_FILTROS, categorias: [ANILLOS] }), `${BASE}?categoria=${ANILLOS}`);
    assert.deepEqual(paramsDeFiltros({ ...SIN_FILTROS, lineas: [] }), [], "una lista vacía no escribe nada");
  });

  it("una dirección con línea es un LISTADO (el servidor y el navegador deciden igual)", () => {
    assert.ok(PARAMS_LISTADO.includes("linea"));
    assert.equal(esListado({ linea: "plata" }), true);
    assert.equal(esListado({}), false);
    assert.equal(esListadoDeUrl(new URLSearchParams("linea=rodio")), true);
    assert.equal(esListadoDeUrl(new URLSearchParams("")), false);
  });
});

describe("hayFiltros y soloUnaCategoria con línea", () => {
  it("una línea es un filtro; con una línea, una categoría ya no es «solo una categoría» (hay que filtrar en memoria)", () => {
    assert.equal(hayFiltros({ ...SIN_FILTROS, lineas: ["plata"] }), true);
    assert.equal(hayFiltros({ ...SIN_FILTROS, lineas: [] }), false);
    assert.equal(soloUnaCategoria({ ...SIN_FILTROS, categorias: [ANILLOS] }), ANILLOS);
    assert.equal(soloUnaCategoria({ ...SIN_FILTROS, categorias: [ANILLOS], lineas: ["plata"] }), null);
  });
});

describe("cumpleFiltros con líneas", () => {
  // `null` = el negocio no tiene líneas (con `undefined` un parámetro con valor por defecto usaría las de Delacour).
  const cumple = (f: Partial<ReturnType<typeof leerFiltros>>, over: Partial<FilaFaceta> = {}, lineas: typeof LINEAS | null = LINEAS) => cumpleFiltros(fila(over), { ...SIN_FILTROS, ...f }, lineas ?? undefined);

  it("la pieza cumple si su material es de la línea (con cualquier variante escrita)", () => {
    assert.equal(cumple({ lineas: ["rodio"] }), true);
    assert.equal(cumple({ lineas: ["rodio"] }, { material: "Rodio · 3cm" }), true);
    assert.equal(cumple({ lineas: ["plata"] }), false);
    assert.equal(cumple({ lineas: ["plata"] }, { material: "Plata 925" }), true);
    assert.equal(cumple({ lineas: ["cover-gold"] }, { material: "COVERGOLD" }), true);
  });

  it("una pieza sin material no está en ninguna línea (pero sigue en el catálogo completo)", () => {
    assert.equal(cumple({ lineas: ["rodio"] }, { material: null }), false);
    assert.equal(cumple({}, { material: null }), true);
  });

  it("varias líneas: basta con una (OR); la línea y los demás filtros se suman (AND)", () => {
    assert.equal(cumple({ lineas: ["plata", "rodio"] }), true);
    assert.equal(cumple({ lineas: ["rodio"], categorias: [ANILLOS] }), true);
    assert.equal(cumple({ lineas: ["rodio"], categorias: [ARETES] }), false);
    assert.equal(cumple({ lineas: ["rodio"], colores: ["dorad"] }), true);
    assert.equal(cumple({ lineas: ["rodio"], colores: ["platead"] }), false);
    assert.equal(cumple({ lineas: ["rodio"], precioMax: 10_000 }), false);
  });

  it("sin las líneas del negocio, una `?linea=` no significa nada: se ignora y NO vacía la lista", () => {
    assert.equal(cumple({ lineas: ["plata"] }, {}, null), true);
    assert.equal(cumple({ lineas: ["plata"] }, {}, []), true);
  });

  it("sin línea en el filtro, el resultado es el de siempre", () => {
    assert.equal(cumple({}), true);
    assert.equal(cumple({ categorias: [ARETES] }), false);
  });
});

describe("calcularFacetas con líneas", () => {
  const catalogo = [{ id: ANILLOS, name: "Anillos" }, { id: ARETES, name: "Aretes" }, { id: "vacia", name: "Vacía" }];
  const filas: FilaFaceta[] = [
    fila({ material: "Rodio" }),
    fila({ material: "Rodio · 3cm" }),
    fila({ categoryId: ARETES, material: "Plata 925" }),
    fila({ categoryId: ARETES, material: "Rodio" }),
    fila({ categoryId: ARETES, material: null }),
  ];

  it("sin las líneas del negocio la forma es la de siempre: la propiedad ni existe", () => {
    const fx = calcularFacetas(filas, catalogo);
    assert.ok(!("lineas" in fx));
    assert.equal(fx.total, 5);
    assert.deepEqual(fx.categorias.map((c) => [c.nombre, c.n]), [["Anillos", 2], ["Aretes", 3]]);
  });

  it("con las líneas: cada línea con su conteo, en su orden y también las que no tienen piezas", () => {
    const fx = calcularFacetas(filas, catalogo, LINEAS);
    assert.deepEqual(fx.lineas!.map((l) => [l.clave, l.n]), [["plata", 1], ["rodio", 3], ["acero", 0], ["cover-gold", 0]]);
    assert.deepEqual(fx.lineas!.find((l) => l.clave === "rodio")!.categorias, [{ id: ANILLOS, n: 2 }, { id: ARETES, n: 1 }]);
  });

  it("con una línea elegida, las CATEGORÍAS se cuentan dentro de ella (el resto sigue siendo de todo el catálogo)", () => {
    const fx = calcularFacetas(filas, catalogo, LINEAS, ["plata"]);
    assert.deepEqual(fx.categorias.map((c) => [c.nombre, c.n]), [["Aretes", 1]], "solo hay aretes de plata");
    assert.equal(fx.total, 5, "el total no cambia");
    assert.deepEqual(fx.materiales.map((m) => m.etiqueta).sort(), ["Plata 925", "Rodio", "Rodio · 3cm"].sort(), "los materiales siguen siendo los de todo el catálogo");
    const dos = calcularFacetas(filas, catalogo, LINEAS, ["plata", "rodio"]);
    assert.deepEqual(dos.categorias.map((c) => [c.nombre, c.n]), [["Anillos", 2], ["Aretes", 2]]);
  });

  it("una línea elegida sin piezas deja las categorías vacías (el panel no inventa opciones)", () => {
    assert.deepEqual(calcularFacetas(filas, catalogo, LINEAS, ["acero"]).categorias, []);
  });

  it("elegir líneas sin las líneas del negocio no cambia nada", () => {
    assert.deepEqual(calcularFacetas(filas, catalogo, undefined, ["plata"]), calcularFacetas(filas, catalogo));
  });
});
