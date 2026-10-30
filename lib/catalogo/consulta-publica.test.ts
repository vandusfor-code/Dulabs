/**
 * La consulta que la tienda pública le hace al servicio (lib/catalogo/consulta-publica.ts): donde se juntan lo que trae la dirección y las líneas de CADA tienda. Si aquí se olvidara pasar las
 * líneas, `?linea=plata` se ignoraría en silencio. Además, guardas de CABLEADO sobre los archivos que arman la tienda (el cargador, la página y el marco): no se pueden ejecutar sin base de datos,
 * así que se comprueba por su texto que entregan las líneas a quien las necesita.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { consultaDeCatalogoPublico } from "@/lib/catalogo/consulta-publica";
import { SIN_FILTROS, textoDeFiltros } from "@/lib/catalogo/filtros";
import { lineasDeLaTienda } from "@/lib/catalogo/joyeria";

const base = { context: "retail" as const, token: undefined, q: undefined, categoria: undefined, pagina: 1 };
const ANILLOS = "6292c223-1062-4823-801b-34e06037f534";

describe("lineasDeLaTienda", () => {
  it("Delacour tiene sus cuatro líneas, en el orden pedido; los demás negocios, ninguna", () => {
    assert.deepEqual(lineasDeLaTienda("delacour").map((l) => l.etiqueta), ["Plata", "Rodio", "Acero", "Cover Gold"]);
    assert.deepEqual(lineasDeLaTienda("aqui-si-lo-compras"), []);
    assert.deepEqual(lineasDeLaTienda("no-existe"), []);
  });
});

describe("consultaDeCatalogoPublico", () => {
  it("Delacour: entrega las líneas junto con los filtros de la dirección y la petición de opciones", () => {
    const q = consultaDeCatalogoPublico({ ...base, slug: "delacour", filtros: textoDeFiltros({ ...SIN_FILTROS, lineas: ["plata"], categorias: [ANILLOS] }), opciones: true, pagina: 2 });
    assert.equal(q.slug, "delacour");
    assert.equal(q.page, 2);
    assert.equal(q.facets, true);
    assert.deepEqual(q.filters?.lineas, ["plata"]);
    assert.deepEqual(q.filters?.categorias, [ANILLOS]);
    assert.deepEqual(q.lineas?.map((l) => l.clave), ["plata", "rodio", "acero", "cover-gold"]);
  });

  it("también las entrega sin filtros (para que el panel traiga las líneas con su conteo)", () => {
    const q = consultaDeCatalogoPublico({ ...base, slug: "delacour", opciones: true });
    assert.equal(q.lineas?.length, 4);
    assert.ok(!("filters" in q));
  });

  it("un negocio SIN líneas: la consulta es exactamente la de siempre (ni siquiera existe la propiedad)", () => {
    const q = consultaDeCatalogoPublico({ ...base, slug: "otra-joyeria", filtros: "color=dorad", opciones: true, categoria: ANILLOS });
    assert.ok(!("lineas" in q));
    assert.deepEqual(q, { slug: "otra-joyeria", context: "retail", token: undefined, q: undefined, categoryId: ANILLOS, page: 1, filters: { categorias: [], colores: ["dorad"], materiales: [] }, facets: true });
  });

  it("sin filtros ni opciones solo trae lo básico", () => {
    const q = consultaDeCatalogoPublico({ ...base, slug: "otra-joyeria" });
    assert.deepEqual(q, { slug: "otra-joyeria", context: "retail", token: undefined, q: undefined, categoryId: undefined, page: 1 });
  });

  it("la búsqueda por texto y el token viajan tal cual", () => {
    const q = consultaDeCatalogoPublico({ ...base, slug: "delacour", q: "cadena", token: "abc" });
    assert.equal(q.q, "cadena");
    assert.equal(q.token, "abc");
  });
});

describe("cableado: la configuración de la tienda llega a quien la usa", () => {
  const leer = (...partes: string[]) => readFileSync(path.join(process.cwd(), ...partes), "utf8");
  const loader = leer("lib", "catalogo", "public-loader.ts");
  const pagina = leer("app", "catalogo", "[slug]", "(tienda)", "page.tsx");
  const marco = leer("app", "catalogo", "[slug]", "(tienda)", "layout.tsx");

  it("el cargador del catálogo arma la consulta con las líneas de la tienda (no la escribe a mano)", () => {
    assert.ok(/getCatalog\(consultaDeCatalogoPublico\(/.test(loader), "debe pasar por consultaDeCatalogoPublico");
  });

  it("la página: una `?linea=` hace que la dirección sea un listado, y entrega las líneas al inicio y al listado", () => {
    assert.ok(pagina.includes("linea: param(sp.linea)"), "esListado debe ver la línea");
    assert.ok(/lineas=\{lineasVisibles\(joyeria\.lineas, tienda\.categories, basePath\)\}/.test(pagina), "el inicio recibe las líneas");
    assert.ok(/lineas=\{lineasDelNegocio\}/.test(pagina), "el listado recibe las líneas del negocio");
    assert.ok(pagina.includes("lineasDeLaTienda(tienda.slug)"), "las del negocio salen de su configuración");
  });

  it("el marco de la tienda le entrega las líneas y su acceso a la cabecera", () => {
    const cromo = marco.slice(marco.indexOf("<CromoJoyeria"), marco.indexOf("/>", marco.indexOf("<CromoJoyeria")));
    assert.ok(cromo.includes("lineas={lineas}"), "la cabecera recibe las líneas");
    assert.ok(cromo.includes("lineasHref={hrefLineas(basePath)}"), "la cabecera recibe a dónde lleva «Líneas»");
    assert.ok(marco.includes("lineasVisibles(joyeria.lineas, tienda.categories, basePath)"), "se arman con la configuración y las categorías ya cargadas (sin leer productos)");
  });
});

describe("guardas del CSS de la franja de líneas", () => {
  const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
  const regla = (selector: string) => {
    const i = css.indexOf(`${selector} {`);
    assert.ok(i >= 0, `falta la regla ${selector}`);
    return css.slice(i, css.indexOf("}", i));
  };

  it("la lista es una rejilla de 2 columnas y, desde la tableta, de 4 (sin deslizar)", () => {
    assert.ok(regla(".tienda-joyeria .joy-franja-lineas-lista").includes("display: grid"));
    assert.ok(regla(".tienda-joyeria .joy-franja-lineas-lista").includes("repeat(2, minmax(0, 1fr))"));
    const j = css.indexOf("@media (min-width: 768px) {", css.indexOf(".tienda-joyeria .joy-franja-lineas-lista {"));
    assert.ok(css.slice(j, j + 200).includes("repeat(4, minmax(0, 1fr))"), "cuatro columnas desde 768 px");
  });

  it("cada línea llena su columna: tiene alto propio y NO fija un ancho (lo que se vio con la clase ajena `joy-linea`)", () => {
    const r = regla(".tienda-joyeria .joy-franja-linea");
    assert.ok(r.includes("height: 5.25rem"));
    assert.ok(!/(^|[\s;{])width\s*:/.test(r), "no debe fijar width");
  });

  it("la clase `joy-linea` (el filete dorado de la portada) sigue siendo la de siempre: 4 rem de ancho, sin tocarla", () => {
    assert.ok(regla(".tienda-joyeria .joy-linea").includes("width: 4rem"));
  });
});
