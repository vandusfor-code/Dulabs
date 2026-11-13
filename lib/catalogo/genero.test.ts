/**
 * Hombre / Mujer (Delacour · Vértice) — lo PURO, sin base de datos ni pantalla: qué es el «para quién» de una pieza, cómo viaja en la dirección (`?genero=hombre`), cuándo la tienda se pinta con la
 * paleta de hombre y cómo entran el filtro y el campo «Para» en los esquemas. Negocios y piezas FICTICIOS.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENEROS, productCreateSchema, productListQuerySchema, productUpdateSchema } from "@/lib/catalogo/domain";
import { SIN_FILTROS, cumpleFiltros, hayFiltros, leerFiltros, paramsDeFiltros, soloUnaCategoria, textoDeFiltros, filtrosDeTexto, urlFiltros } from "@/lib/catalogo/filtros";
import { ATRIBUTO_TEMA_GENERO, claveDeReferencia, conjuntoDeHombres, esGenero, generoDe, generoDeParam, hrefDeGenero, hrefListadoDeGenero, referenciaDeRuta, temaDeHombre } from "@/lib/catalogo/genero";
import { esListado, esListadoDeUrl } from "@/lib/catalogo/inicio";
import { generoDeLaTienda } from "@/lib/catalogo/joyeria";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

const BASE = "/catalogo/delacour";
const HOMBRES = conjuntoDeHombres(["DL-000769", "dl-000770"]);

describe("el «para quién» de una pieza", () => {
  it("son dos lados, Mujer y Hombre, y lo que no se marca es de mujer", () => {
    assert.deepEqual([...GENEROS], ["mujer", "hombre"]);
    assert.ok(esGenero("mujer") && esGenero("hombre"));
    for (const raro of ["", "Hombre", "otro", null, undefined, 3, ["hombre"]]) assert.equal(esGenero(raro), false, String(raro));
    assert.equal(generoDe("DL-000001", HOMBRES), "mujer");
  });

  it("la referencia se compara sin mayúsculas ni espacios: «dl-000769» y «DL-000769» son la misma pieza", () => {
    assert.equal(claveDeReferencia("  dl-000769 "), "DL-000769");
    assert.equal(generoDe("dl-000769", HOMBRES), "hombre");
    assert.equal(generoDe("DL-000770", HOMBRES), "hombre");
    assert.equal(generoDe("DL-000771", HOMBRES), "mujer");
    assert.equal(conjuntoDeHombres(undefined).size, 0);
    assert.equal(conjuntoDeHombres(null).size, 0);
    assert.equal(conjuntoDeHombres(new Set(["dl-1"])).has("DL-1"), true);
  });
});

describe("la dirección ?genero=", () => {
  it("solo «hombre» cuenta (sin mayúsculas ni espacios, y solo el primer valor); el lado de mujer es el de siempre y no se escribe", () => {
    assert.equal(generoDeParam("hombre"), "hombre");
    assert.equal(generoDeParam(" HOMBRE "), "hombre");
    assert.equal(generoDeParam(["hombre", "mujer"]), "hombre");
    assert.equal(generoDeParam(["mujer", "hombre"]), undefined, "solo el primero");
    for (const nada of ["mujer", "otro", "", "hombres", null, undefined]) assert.equal(generoDeParam(nada), undefined, String(nada));
  });

  it("los dos lados tienen su INICIO: mujer es la tienda de siempre y hombre su propio inicio (?genero=hombre)", () => {
    assert.equal(hrefDeGenero(BASE, "mujer"), BASE);
    assert.equal(hrefDeGenero(BASE, "hombre"), `${BASE}?genero=hombre`);
  });

  it("y su LISTADO: el de mujer es ?todo=1 (el de siempre) y el de hombre ?genero=hombre&todo=1", () => {
    assert.equal(hrefListadoDeGenero(BASE, "mujer"), `${BASE}?todo=1`);
    assert.equal(hrefListadoDeGenero(BASE, "hombre"), `${BASE}?genero=hombre&todo=1`);
  });

  it("?genero=hombre SOLO es el INICIO de hombre (no abre el listado); el listado lleva todo=1 o algún filtro, como el de mujer", () => {
    assert.equal(esListado({ genero: "hombre" }), false, "el inicio de hombre");
    assert.equal(esListado({ genero: "" }), false);
    assert.equal(esListado({ genero: "hombre", todo: "1" }), true, "el listado de hombre");
    assert.equal(esListado({ genero: "hombre", color: "platead" }), true);
    assert.equal(esListado({ genero: "hombre", q: "ancla" }), true);
    assert.equal(esListadoDeUrl(new URLSearchParams("?genero=hombre")), false);
    assert.equal(esListadoDeUrl(new URLSearchParams("?genero=hombre&todo=1")), true);
    assert.equal(esListadoDeUrl(new URLSearchParams("?genero=hombre&categoria=c1")), true);
    assert.equal(esListadoDeUrl(new URLSearchParams("")), false);
  });
});

describe("el filtro «genero» en lib/catalogo/filtros.ts", () => {
  it("se lee de la dirección y viaja primero en el orden estable; sin él los filtros son EXACTAMENTE los de siempre", () => {
    assert.deepEqual(leerFiltros({ genero: "hombre" }), { genero: "hombre", categorias: [], colores: [], materiales: [] });
    assert.deepEqual(leerFiltros({}), { categorias: [], colores: [], materiales: [] }, "ni la propiedad vacía");
    assert.ok(!("genero" in leerFiltros({ genero: "mujer" })), "?genero=mujer no es un filtro");
    assert.ok(!("genero" in leerFiltros({ genero: "x" })));
    assert.deepEqual(paramsDeFiltros({ ...SIN_FILTROS, genero: "hombre", lineas: ["acero"], colores: ["negr"] }), [["genero", "hombre"], ["linea", "acero"], ["color", "negr"]]);
  });

  it("la dirección del listado de hombre, con y sin otros filtros, y el viaje de ida y vuelta por texto", () => {
    // sin nada más, el listado de hombre lleva todo=1 (`?genero=hombre` solo es su inicio), igual que el de mujer
    assert.equal(urlFiltros(BASE, { ...SIN_FILTROS, genero: "hombre" }), `${BASE}?genero=hombre&todo=1`);
    assert.equal(urlFiltros(BASE, SIN_FILTROS), `${BASE}?todo=1`);
    assert.equal(urlFiltros(BASE, { ...SIN_FILTROS, genero: "hombre", lineas: ["acero"] }, 2), `${BASE}?genero=hombre&linea=acero&pagina=2`);
    const f = { ...SIN_FILTROS, genero: "hombre" as const, lineas: ["acero"], precioMax: 20_000 };
    assert.deepEqual(filtrosDeTexto(textoDeFiltros(f)), leerFiltros({ genero: "hombre", linea: "acero", precio_max: "20000" }));
    assert.deepEqual(filtrosDeTexto(textoDeFiltros(f)), f);
  });

  it("es un filtro: cuenta como filtro puesto y ya no es «solo una categoría» (esa consulta de la base mezclaría los dos lados)", () => {
    assert.equal(hayFiltros({ ...SIN_FILTROS, genero: "hombre" }), true);
    assert.equal(hayFiltros(SIN_FILTROS), false);
    const c = "c0000000-0000-4000-8000-0000000000a1";
    assert.equal(soloUnaCategoria({ ...SIN_FILTROS, categorias: [c] }), c);
    assert.equal(soloUnaCategoria({ ...SIN_FILTROS, categorias: [c], genero: "hombre" }), null);
  });

  it("filtra por lado: sin dato la pieza es de mujer; sin el filtro no se mira el lado", () => {
    const hombre = { genero: "hombre" as const, categoryId: null, color: null, material: null, price: 1 };
    const mujer = { genero: "mujer" as const, categoryId: null, color: null, material: null, price: 1 };
    const sinDato = { categoryId: null, color: null, material: null, price: 1 };
    const soloHombre = { ...SIN_FILTROS, genero: "hombre" as const };
    const soloMujer = { ...SIN_FILTROS, genero: "mujer" as const };
    assert.deepEqual([hombre, mujer, sinDato].map((x) => cumpleFiltros(x, soloHombre)), [true, false, false]);
    assert.deepEqual([hombre, mujer, sinDato].map((x) => cumpleFiltros(x, soloMujer)), [false, true, true]);
    assert.deepEqual([hombre, mujer, sinDato].map((x) => cumpleFiltros(x, SIN_FILTROS)), [true, true, true]);
  });
});

describe("referenciaDeRuta y temaDeHombre: cuándo la tienda se pinta con la paleta de Vértice", () => {
  it("la referencia de una ficha sale de su ruta; cualquier otra ruta no tiene", () => {
    assert.equal(referenciaDeRuta(BASE, `${BASE}/productos/dl-000769`), "DL-000769");
    assert.equal(referenciaDeRuta(BASE, `${BASE}/productos/DL-000769/thumb.webp`), "DL-000769");
    assert.equal(referenciaDeRuta(BASE, BASE), null);
    assert.equal(referenciaDeRuta(BASE, `${BASE}/mayoristas`), null);
    assert.equal(referenciaDeRuta(BASE, `/catalogo/otra/productos/dl-000769`), null, "de otra tienda no");
    assert.equal(referenciaDeRuta(BASE, `${BASE}/productos/no-es-una-referencia`), null);
    assert.equal(referenciaDeRuta(BASE, `${BASE}/productos/%E0%A4%A`), null, "una ruta mal codificada no rompe nada");
  });

  it("sí en el listado de hombre y en la ficha de una pieza de hombre; no en lo demás", () => {
    const t = (pathname: string, genero: string | null) => temaDeHombre({ basePath: BASE, pathname, genero, hombres: HOMBRES });
    assert.equal(t(BASE, "hombre"), true, "listado de hombre");
    assert.equal(t(`${BASE}/productos/dl-000769`, null), true, "ficha de una pieza de hombre (con la ruta en minúsculas)");
    assert.equal(t(`${BASE}/productos/dl-000770`, null), true);
    assert.equal(t(`${BASE}/productos/dl-000001`, null), false, "ficha de una pieza de mujer");
    assert.equal(t(BASE, null), false, "la tienda de siempre");
    assert.equal(t(BASE, "mujer"), false);
    assert.equal(t(`${BASE}/mayoristas`, null), false);
  });

  it("sin piezas de hombre no hay tema: una dirección ?genero=hombre vieja no pinta de oscuro una tienda que no tiene ese lado", () => {
    assert.equal(temaDeHombre({ basePath: BASE, pathname: BASE, genero: "hombre", hombres: new Set() }), false);
  });

  it("el atributo que usa el CSS se llama igual aquí y allá (si uno cambia y el otro no, la tienda dejaría de cambiar de color)", () => {
    assert.equal(ATRIBUTO_TEMA_GENERO, "data-tema-genero");
  });
});

describe("la configuración de Delacour", () => {
  it("el lado de hombre de Delacour es Vértice, con los textos de su catálogo; los demás negocios no tienen separación", () => {
    const g = generoDeLaTienda("delacour")!;
    assert.equal(g.mujer.etiqueta, "Mujer");
    assert.equal(g.hombre.etiqueta, "Hombre");
    assert.equal(g.hombre.casa, "Delacour");
    assert.equal(g.hombre.marca, "Vértice");
    assert.equal(g.hombre.antetitulo, "Colección masculina");
    assert.equal(g.hombre.lema, "Identidad forjada en acero");
    assert.match(g.hombre.entrada.texto, /dijes de acero para hombre/);
    assert.equal(generoDeLaTienda("otra-tienda"), undefined);
    assert.equal(storefrontConfigFor("delacour").joyeria!.genero, g);
  });
});

describe("los esquemas de la API", () => {
  const base = { name: "Dije", retailPrice: 1000, stock: 1 };

  it("crear: «gender» es opcional y solo admite mujer u hombre (los demás campos siguen igual)", () => {
    assert.equal(productCreateSchema.safeParse(base).success, true);
    assert.equal(productCreateSchema.safeParse({ ...base, gender: "hombre" }).success, true);
    assert.equal(productCreateSchema.safeParse({ ...base, gender: "mujer" }).success, true);
    const mal = productCreateSchema.safeParse({ ...base, gender: "otro" });
    assert.equal(mal.success, false);
    assert.match(mal.error!.issues[0].message, /Mujer u Hombre/);
  });

  it("editar: «gender» solo ya es un cambio válido (clasificar desde la lista); un valor raro se rechaza", () => {
    assert.equal(productUpdateSchema.safeParse({ gender: "hombre" }).success, true);
    assert.equal(productUpdateSchema.safeParse({}).success, false, "sin cambios sigue rechazándose");
    assert.equal(productUpdateSchema.safeParse({ gender: "x" }).success, false);
  });

  it("el listado del panel: «genero» opcional (vacío = todas) y con un mensaje claro si no es válido", () => {
    assert.equal(productListQuerySchema.parse({}).genero, undefined);
    assert.equal(productListQuerySchema.parse({ genero: "" }).genero, undefined);
    assert.equal(productListQuerySchema.parse({ genero: "hombre" }).genero, "hombre");
    const mal = productListQuerySchema.safeParse({ genero: "otro" });
    assert.equal(mal.success, false);
    assert.match(mal.error!.issues[0].message, /Para no es válido/);
  });
});
