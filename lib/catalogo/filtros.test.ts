/**
 * Filtros del catálogo público (lo puro): cómo se agrupan los valores escritos a mano, las facetas con su rango de precio, qué productos cumplen los filtros y cómo viajan en la dirección.
 * Los datos de las pruebas imitan lo que tiene hoy el catálogo de Delacour (colores y materiales escritos de varias formas, productos sin color y tres sin precio).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calcularFacetas,
  claveDe,
  cumpleFiltros,
  filtrosDeTexto,
  formatoPrecio,
  hayFiltros,
  leerFiltros,
  paramsDeFiltros,
  puntoDeColor,
  SIN_FILTROS,
  soloUnaCategoria,
  textoDeFiltros,
  urlFiltros,
  type FilaFaceta,
  type FiltrosCatalogo,
} from "@/lib/catalogo/filtros";

const C1 = "c0000000-0000-4000-8000-0000000000a1";
const C2 = "c0000000-0000-4000-8000-0000000000a2";
const C3 = "c0000000-0000-4000-8000-0000000000a3";
const CATEGORIAS = [
  { id: C1, name: "Aretes" },
  { id: C2, name: "Dije" },
  { id: C3, name: "Vacía" },
];
const fila = (over: Partial<FilaFaceta> = {}): FilaFaceta => ({ categoryId: C2, color: null, material: null, price: 15_000, ...over });
const f = (over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({ ...SIN_FILTROS, ...over });

describe("claves de agrupación", () => {
  it("«Dorada», «dorado», «Dorado» y «Doradas» son el mismo color; «RODIO» y «Rodio», el mismo material", () => {
    const claves = new Set(["Dorada", "dorado", "Dorado", "Doradas", " DORADO "].map(claveDe));
    assert.deepEqual([...claves], ["dorad"]);
    assert.equal(claveDe("RODIO"), claveDe("Rodio"));
    assert.equal(claveDe("Roja"), claveDe("rojo"));
    assert.equal(claveDe("Negra"), claveDe("NEGRO"));
  });

  it("los colores distintos siguen distintos (plateado, platinado, plata, dorado, oro rosa)", () => {
    const claves = ["Plateado", "Platinado", "Plata", "Dorado", "Oro Rosa"].map(claveDe);
    assert.equal(new Set(claves).size, claves.length);
  });

  it("sin tildes ni signos; la ñ se conserva; vacío o sin letras no es una clave", () => {
    assert.equal(claveDe("Platería"), claveDe("plateria"));
    assert.equal(claveDe("Oro-Rosa."), claveDe("oro rosa"));
    assert.equal(claveDe("Piña"), "piñ");
    for (const v of [null, undefined, "", "   ", "---", "..."]) assert.equal(claveDe(v), null);
  });

  it("es estable: la clave de una clave es la misma (la dirección guarda claves y se vuelven a leer)", () => {
    for (const v of ["Dorada", "RODIO", "Oro Rosa", "Platinada", "Acero Inoxidable", "Azul", "Verde", "Piña", "Platería"]) {
      const k = claveDe(v) as string;
      assert.equal(claveDe(k), k, v);
    }
  });
});

describe("facetas", () => {
  const filas: FilaFaceta[] = [
    ...Array.from({ length: 3 }, () => fila({ color: "Dorada", material: "RODIO" })),
    fila({ color: "dorado", material: "Rodio" }),
    fila({ color: "Dorado" }),
    fila({ color: "Plateada", categoryId: C1, material: "Rodio", price: 6_000 }),
    fila({ color: "Plateado" }),
    fila({ color: "Platinado", categoryId: C1 }),
    fila({ color: "Oro Rosa", price: 112_000 }),
    fila({ color: null, price: 0 }),
    fila({ price: null }),
  ];
  const fx = calcularFacetas(filas, CATEGORIAS);

  it("cuenta los productos activos y solo ofrece las categorías que tienen productos, en el orden del catálogo", () => {
    assert.equal(fx.total, filas.length);
    assert.deepEqual(fx.categorias.map((c) => [c.nombre, c.n]), [["Aretes", 2], ["Dije", 9]]);
  });

  it("agrupa colores y materiales escritos de varias formas, en orden alfabético (como la referencia), con la etiqueta en masculino", () => {
    assert.deepEqual(fx.colores.map((c) => [c.etiqueta, c.n]), [["Dorado", 5], ["Oro rosa", 1], ["Plateado", 2], ["Platinado", 1]]);
    assert.deepEqual(fx.materiales.map((m) => [m.etiqueta, m.n]), [["Rodio", 5]]);
    assert.deepEqual(fx.colores.map((c) => c.clave), ["dorad", "oro ros", "platead", "platinad"]);
  });

  it("el orden alfabético ignora mayúsculas y tildes y respeta el español", () => {
    const filas = ["Zafiro", "árbol", "Azul", "BICOLOR", "Blanco", "ñandú"].map((color) => fila({ color }));
    assert.deepEqual(calcularFacetas(filas, CATEGORIAS).colores.map((c) => c.etiqueta), ["Árbol", "Azul", "Bicolor", "Blanco", "Ñandú", "Zafiro"]);
  });

  it("los productos sin color o sin material no crean una opción «sin dato»", () => {
    assert.ok(!fx.colores.some((c) => /sin|null|undefined/i.test(c.etiqueta)));
    assert.equal(fx.colores.reduce((n, c) => n + c.n, 0), 9, "9 de 11 productos tienen color");
  });

  it("el rango de precio ignora lo que no tiene precio (0 o a consultar) y se redondea al paso del deslizador", () => {
    assert.deepEqual(fx.precio, { min: 6_000, max: 112_000 });
    assert.deepEqual(calcularFacetas([fila({ price: 6_400 }), fila({ price: 11_250 })], CATEGORIAS).precio, { min: 6_000, max: 12_000 });
    assert.equal(calcularFacetas([fila({ price: 0 }), fila({ price: null })], CATEGORIAS).precio, null);
    assert.equal(calcularFacetas([], CATEGORIAS).total, 0);
  });
});

describe("qué productos cumplen los filtros", () => {
  const dorado = fila({ color: "Dorada", material: "RODIO", price: 20_000 });
  const plateado = fila({ color: "Plateado", material: null, price: 10_000, categoryId: C1 });
  const sinDatos = fila({ color: null, material: null, price: null });

  it("sin filtros cumple todo", () => {
    for (const p of [dorado, plateado, sinDatos]) assert.equal(cumpleFiltros(p, SIN_FILTROS), true);
  });

  it("dentro de un grupo basta con uno de los valores", () => {
    assert.equal(cumpleFiltros(dorado, f({ colores: ["dorad", "platead"] })), true);
    assert.equal(cumpleFiltros(plateado, f({ colores: ["dorad", "platead"] })), true);
    assert.equal(cumpleFiltros(dorado, f({ categorias: [C1, C2] })), true);
    assert.equal(cumpleFiltros(plateado, f({ categorias: [C1, C2] })), true);
  });

  it("entre grupos deben cumplirse todos", () => {
    assert.equal(cumpleFiltros(dorado, f({ colores: ["dorad"], categorias: [C2] })), true);
    assert.equal(cumpleFiltros(dorado, f({ colores: ["dorad"], categorias: [C1] })), false);
    assert.equal(cumpleFiltros(dorado, f({ colores: ["dorad"], materiales: ["rodi"], precioMin: 15_000, precioMax: 25_000 })), true);
    assert.equal(cumpleFiltros(dorado, f({ colores: ["dorad"], materiales: ["acero"] })), false);
  });

  it("un producto sin color (o sin material) no cumple un filtro de color (o de material)", () => {
    assert.equal(cumpleFiltros(sinDatos, f({ colores: ["dorad"] })), false);
    assert.equal(cumpleFiltros(plateado, f({ materiales: ["rodi"] })), false);
    assert.equal(cumpleFiltros(fila({ categoryId: null }), f({ categorias: [C1] })), false);
  });

  it("el rango de precio incluye los extremos; un producto a consultar queda fuera si hay rango", () => {
    assert.equal(cumpleFiltros(dorado, f({ precioMin: 20_000, precioMax: 20_000 })), true);
    assert.equal(cumpleFiltros(dorado, f({ precioMin: 20_001 })), false);
    assert.equal(cumpleFiltros(dorado, f({ precioMax: 19_999 })), false);
    assert.equal(cumpleFiltros(sinDatos, f({ precioMin: 0 })), false);
    assert.equal(cumpleFiltros(sinDatos, f({ precioMax: 999_999 })), false);
  });

  it("un precio en 0 es un producto sin precio, no uno barato: un tope de precio no lo deja pasar", () => {
    const enCero = { ...dorado, price: 0 };
    assert.equal(cumpleFiltros(enCero, f({ precioMax: 50_000 })), false);
    assert.equal(cumpleFiltros(enCero, f({ precioMin: 1 })), false);
    assert.equal(cumpleFiltros(enCero, f({ precioMin: 0, precioMax: 999_999 })), false);
    assert.equal(cumpleFiltros(enCero, f({ colores: ["dorad"] })), true, "sin rango de precio sigue apareciendo como siempre");
  });

  it("hayFiltros y soloUnaCategoria distinguen el listado de siempre del filtrado", () => {
    assert.equal(hayFiltros(SIN_FILTROS), false);
    assert.equal(hayFiltros(f({ precioMax: 5 })), true);
    assert.equal(soloUnaCategoria(f({ categorias: [C1] })), C1);
    assert.equal(soloUnaCategoria(f({ categorias: [C1, C2] })), null);
    assert.equal(soloUnaCategoria(f({ categorias: [C1], colores: ["dorad"] })), null);
    assert.equal(soloUnaCategoria(SIN_FILTROS), null);
  });
});

describe("filtros en la dirección", () => {
  it("lee categorías (una o varias), colores, materiales y rango; el enlace de siempre «?categoria=<id>» sigue siendo válido", () => {
    assert.deepEqual(leerFiltros({ categoria: C1 }), f({ categorias: [C1] }));
    const v = leerFiltros({ categoria: [C1, C2, C1], color: ["Dorado", "dorada", "Oro Rosa"], material: "RODIO", precio_min: "8000", precio_max: "30000" });
    assert.deepEqual(v, { categorias: [C1, C2], colores: ["dorad", "oro ros"], materiales: ["rodi"], precioMin: 8_000, precioMax: 30_000 });
  });

  it("ignora lo que no es válido: ids que no son UUID, precios que no son enteros, valores vacíos", () => {
    const v = leerFiltros({ categoria: ["no-es-un-id", C2], color: ["", "  ", "---"], material: [], precio_min: "abc", precio_max: "-5" });
    assert.deepEqual(v, f({ categorias: [C2] }));
    assert.deepEqual(leerFiltros({ precio_min: "12.5", precio_max: "1e3" }), SIN_FILTROS);
    assert.deepEqual(leerFiltros({}), SIN_FILTROS);
  });

  it("si el mínimo es mayor que el máximo los invierte; pone tope al número de valores por grupo", () => {
    assert.deepEqual(leerFiltros({ precio_min: "50000", precio_max: "10000" }), f({ precioMin: 10_000, precioMax: 50_000 }));
    const muchos = Array.from({ length: 40 }, (_, i) => `color${String.fromCharCode(97 + (i % 26))}${i}`);
    assert.equal(leerFiltros({ color: muchos }).colores.length, 12);
  });

  it("escribir y volver a leer devuelve los mismos filtros (también con espacios en la clave)", () => {
    const original = f({ categorias: [C1, C3], colores: ["dorad", "oro ros"], materiales: ["rodi"], precioMin: 6_000, precioMax: 112_000 });
    const url = urlFiltros("/catalogo/delacour", original);
    const qs = new URL(url, "https://x.test").searchParams;
    const sp: Record<string, string[]> = {};
    for (const [k, val] of qs) (sp[k] ??= []).push(val);
    assert.deepEqual(leerFiltros(sp), original);
    assert.deepEqual(paramsDeFiltros(original).map(([k]) => k), ["categoria", "categoria", "color", "color", "material", "precio_min", "precio_max"]);
  });

  it("el precio del rango se escribe «$ 38.000» (con punto de miles, también en 4 cifras)", () => {
    assert.equal(formatoPrecio(38_000), "$ 38.000");
    assert.equal(formatoPrecio(6_000), "$ 6.000");
    assert.equal(formatoPrecio(249_999), "$ 249.999");
    assert.equal(formatoPrecio(1_250_000), "$ 1.250.000");
    assert.equal(formatoPrecio(0), "$ 0");
  });

  it("como texto estable (argumento de la carga con caché por petición): ida y vuelta sin pérdidas, y vacío sin filtros", () => {
    const original = f({ categorias: [C1, C3], colores: ["dorad", "oro ros"], materiales: ["rodi"], precioMin: 6_000 });
    const texto = textoDeFiltros(original);
    assert.equal(texto, `categoria=${C1}&categoria=${C3}&color=dorad&color=oro+ros&material=rodi&precio_min=6000`);
    assert.deepEqual(filtrosDeTexto(texto), original);
    assert.equal(textoDeFiltros(SIN_FILTROS), "");
    assert.deepEqual(filtrosDeTexto(""), SIN_FILTROS);
    assert.deepEqual(filtrosDeTexto("categoria=no-es-uuid&precio_min=abc"), SIN_FILTROS, "lo inválido se ignora");
  });

  it("sin filtros la dirección es el listado completo de siempre; con página, la lleva; la página 1 no se escribe", () => {
    assert.equal(urlFiltros("/catalogo/delacour", SIN_FILTROS), "/catalogo/delacour?todo=1");
    assert.equal(urlFiltros("/catalogo/delacour", SIN_FILTROS, 1), "/catalogo/delacour?todo=1");
    assert.equal(urlFiltros("/catalogo/delacour", SIN_FILTROS, 3), "/catalogo/delacour?pagina=3");
    assert.equal(urlFiltros("/catalogo/delacour", f({ colores: ["dorad"] }), 2), "/catalogo/delacour?color=dorad&pagina=2");
    assert.ok(!urlFiltros("/catalogo/delacour", f({ colores: ["dorad"] })).includes("todo="));
  });
});

describe("puntos de color", () => {
  it("los colores conocidos llevan su punto (con cualquier género o plural); los que no se conocen, ninguno", () => {
    for (const v of ["Dorado", "Dorada", "Plateado", "Platinada", "Negro", "Rojo", "Oro rosa"]) assert.match(puntoDeColor(claveDe(v) as string) ?? "", /^#[0-9a-f]{6}$/i, v);
    assert.equal(puntoDeColor(claveDe("Plateria") as string), null);
    assert.equal(puntoDeColor(claveDe("Multicolor") as string), null);
  });
});
