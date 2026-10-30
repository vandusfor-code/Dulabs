/**
 * Las LÍNEAS (Plata, Rodio, Acero, Cover Gold) en el HTML que llega del servidor, sin JavaScript: la franja «Nuestras líneas» del inicio, la página de una línea (título, migas y las categorías para
 * moverse dentro de ella) y el grupo «Línea» del panel de filtros. Negocio FICTICIO. Lo que se exige: las líneas existen y funcionan aunque alguna no tenga piezas (sin «Próximamente», sin «(0)»),
 * las categorías de cada línea son LAS MISMAS de la tienda, y sin líneas todo se ve exactamente como siempre.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, HOME_COMPLETO, LISTA, NOMBRE_NEGOCIO, producto } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { ListadoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/ListadoJoyeria";
import { TarjetaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TarjetaJoyeria";
import { TiendaInicioJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { SIN_FILTROS, type FacetasCatalogo, type FiltrosCatalogo } from "@/lib/catalogo/filtros";
import { lineasVisibles } from "@/lib/catalogo/joyeria";
import { calcularLineas } from "@/lib/catalogo/lineas";
import type { PublicCatalogPage } from "@/lib/catalogo/publicacion";
import { joyeriaOf, storefrontConfigFor, type ConfigJoyeria } from "@/lib/catalogo/vitrina";

const routerFalso = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const WHATSAPP = "573000000000";
const REGISTRO = storefrontConfigFor("delacour");
const JOYERIA = joyeriaOf(REGISTRO)!;
const CONFIG_LINEAS = JOYERIA.lineas!;
const LINEAS_CFG = CONFIG_LINEAS.lineas;
const ANILLOS = "c0000000-0000-4000-8000-0000000000a1";
const ARETES = "c0000000-0000-4000-8000-0000000000a2";
const CADENAS = "c0000000-0000-4000-8000-0000000000a3";
const CATEGORIAS = [
  { id: ANILLOS, name: "Anillos" },
  { id: ARETES, name: "Aretes" },
  { id: CADENAS, name: "Cadenas" },
];
const cuenta = (html: string, patron: RegExp) => (html.match(patron) ?? []).length;
const pos = (html: string, texto: string) => {
  const i = html.indexOf(texto);
  assert.ok(i >= 0, `falta «${texto}»`);
  return i;
};
const hrefsDe = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));

// ------------------------------------------------------------------------------------------------- inicio
function inicio(over: { joyeria?: ConfigJoyeria; lineas?: ReturnType<typeof lineasVisibles> | undefined } = {}): string {
  return renderToStaticMarkup(
    <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp={WHATSAPP}>
      <TiendaInicioJoyeria
        home={HOME_COMPLETO}
        config={REGISTRO}
        joyeria={over.joyeria ?? JOYERIA}
        basePath={BASE}
        listPath={LISTA}
        businessName={NOMBRE_NEGOCIO}
        whatsapp={WHATSAPP}
        lineas={"lineas" in over ? over.lineas : lineasVisibles(CONFIG_LINEAS, CATEGORIAS, BASE)}
      />
    </TiendaProvider>,
  );
}

describe("inicio — la franja «Nuestras líneas»", () => {
  const html = inicio();

  it("está, con su título como h2 real y las cuatro líneas en el orden de la clienta, cada una con su enlace al listado", () => {
    assert.equal(cuenta(html, /id="lineas"/g), 1);
    assert.ok(html.includes('<h2 id="joy-lineas"'));
    assert.ok(html.includes("Nuestras líneas"));
    const seccion = html.slice(pos(html, 'id="lineas"'));
    const fin = seccion.indexOf("</section>");
    const enlaces = [...seccion.slice(0, fin).matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2], m[1]]);
    assert.deepEqual(enlaces, [
      ["Plata", `${BASE}?linea=plata`],
      ["Rodio", `${BASE}?linea=rodio`],
      ["Acero", `${BASE}?linea=acero`],
      ["Cover Gold", `${BASE}?linea=cover-gold`],
    ]);
  });

  it("va tras el video de la colección (donde empieza lo claro) y antes de las categorías; sigue habiendo un solo h1", () => {
    assert.ok(pos(html, 'id="lineas"') > pos(html, 'data-joy-claro=""'));
    assert.ok(pos(html, 'id="lineas"') < pos(html, 'id="categorias"'));
    assert.equal(cuenta(html, /<h1[ >]/g), 1);
  });

  it("las cuatro líneas están SIEMPRE: la franja no depende de cuántas piezas tenga cada una (ni «Próximamente» ni conteos)", () => {
    const seccion = html.slice(pos(html, 'id="lineas"'));
    const bloque = seccion.slice(0, seccion.indexOf("</section>"));
    assert.ok(!/pr[oó]ximamente/i.test(bloque));
    assert.ok(!/\(\d+\)/.test(bloque), "sin conteos en la franja");
    assert.ok(bloque.includes("Cover Gold"));
  });

  it("usa la rejilla de la franja (dos columnas en el celular, cuatro desde la tableta), sin deslizar", () => {
    assert.ok(html.includes('class="joy-franja-lineas-lista"'));
    assert.ok(!html.slice(pos(html, 'id="lineas"'), pos(html, 'id="lineas"') + 900).includes("tienda-scroll"));
  });

  it("GUARDA: la franja no reutiliza clases que ya significan otra cosa en el tema (`joy-linea` es el filete dorado de la portada, de 4 rem de ancho: un enlace con esa clase salía diminuto)", () => {
    const seccion = html.slice(pos(html, 'id="lineas"'));
    const bloque = seccion.slice(0, seccion.indexOf("</section>"));
    const clases = new Set([...bloque.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)));
    for (const ajena of ["joy-linea", "joy-boton-linea", "joy-acabado", "joy-acabados-lista"]) assert.ok(!clases.has(ajena), `usa la clase ajena «${ajena}»`);
    for (const propia of ["joy-franja-lineas", "joy-franja-lineas-lista", "joy-franja-linea"]) assert.ok(clases.has(propia), `falta la clase propia «${propia}»`);
  });

  it("sin líneas (la propiedad ausente o vacía) no hay franja: el inicio es el de siempre", () => {
    assert.ok(!inicio({ lineas: undefined }).includes('id="lineas"'));
    assert.ok(!inicio({ lineas: [] }).includes('id="lineas"'));
  });

  it("con líneas pero sin ellas en la configuración del negocio tampoco se dibuja (la configuración manda)", () => {
    const sinLineas: ConfigJoyeria = { ...JOYERIA };
    delete sinLineas.lineas;
    assert.ok(!inicio({ joyeria: sinLineas }).includes('id="lineas"'));
  });

  it("el resto del inicio no cambia: mismas secciones con o sin líneas", () => {
    const sin = inicio({ lineas: undefined });
    for (const marca of ['id="categorias"', 'id="joy-destacados"', 'id="mayoristas"', 'data-joy-hero=""']) assert.equal(html.includes(marca), sin.includes(marca), marca);
    assert.equal(cuenta(html, /<article class="joy-tarjeta/g), cuenta(sin, /<article class="joy-tarjeta/g));
  });
});

// ------------------------------------------------------------------------------------------------- listado
const f = (over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({ ...SIN_FILTROS, ...over });
const FILAS = [
  { categoryId: ANILLOS, material: "Plata 925" },
  { categoryId: ANILLOS, material: "Plata 925" },
  { categoryId: CADENAS, material: "Plata 925" },
  { categoryId: ANILLOS, material: "Rodio" },
  { categoryId: ARETES, material: "Rodio · 3cm" },
];
const FACETAS: FacetasCatalogo = {
  total: 5,
  categorias: [{ id: ANILLOS, nombre: "Anillos", n: 5 }],
  colores: [],
  materiales: [{ clave: "rodi", etiqueta: "Rodio", n: 2 }],
  precio: { min: 6_000, max: 112_000 },
  lineas: calcularLineas(FILAS, LINEAS_CFG),
};
const pagina = (over: Partial<PublicCatalogPage> = {}): PublicCatalogPage => ({
  business: { name: "Delacour & Orus", whatsapp: WHATSAPP },
  context: "retail",
  products: [producto(1), producto(2), producto(3)],
  categories: CATEGORIAS,
  total: 3,
  page: 1,
  pageSize: 48,
  pageCount: 1,
  ...over,
});
function listado(over: { data?: PublicCatalogPage; q?: string; categoria?: string; filtros?: FiltrosCatalogo; facetas?: FacetasCatalogo | null; titulo?: string; lineas?: typeof LINEAS_CFG } = {}) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={routerFalso}>
      <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp={WHATSAPP}>
        <ListadoJoyeria
          data={over.data ?? pagina()}
          basePath={BASE}
          q={over.q}
          categoria={over.categoria}
          listPath={LISTA}
          titulo={over.titulo ?? "Todo el catálogo"}
          filtros={over.filtros ?? SIN_FILTROS}
          facetas={over.facetas === undefined ? FACETAS : over.facetas}
          lineas={over.lineas ?? LINEAS_CFG}
          tile={(p, i) => <TarjetaJoyeria product={p} basePath={BASE} posicion={i} />}
        />
      </TiendaProvider>
    </AppRouterContext.Provider>,
  );
}
const navDeLinea = (html: string, nombre: string) => {
  const i = html.indexOf(`aria-label="Categorías de ${nombre}"`);
  assert.ok(i >= 0, `falta la navegación de la línea ${nombre}`);
  return html.slice(i, html.indexOf("</nav>", i));
};
const migas = (html: string) => {
  const i = html.indexOf('aria-label="Migas de pan"');
  return html.slice(i, html.indexOf("</nav>", i));
};

describe("la página de una línea", () => {
  const plata = listado({ filtros: f({ lineas: ["plata"] }), titulo: "Plata" });

  it("se titula con la línea (un solo h1) y sus migas son Inicio / Catálogo / Plata, con la línea como página actual", () => {
    assert.equal(cuenta(plata, /<h1[ >]/g), 1);
    assert.ok(plata.includes(">Plata</h1>"));
    const m = migas(plata);
    assert.ok(m.indexOf("Inicio") < m.indexOf("Catálogo") && m.indexOf("Catálogo") < m.indexOf("Plata"), m);
    assert.ok(/aria-current="page"[^>]*>Plata</.test(m), "Plata es la página actual");
    assert.ok(!m.includes("Filtros"), "la línea reemplaza el «Filtros» genérico");
  });

  it("trae «Toda la línea» y LAS MISMAS categorías de la tienda, todas, con la dirección de esa línea y esa categoría", () => {
    const nav = navDeLinea(plata, "Plata");
    const enlaces = [...nav.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map((m) => [m[2].replace(/<[^>]+>/g, ""), m[1].replaceAll("&amp;", "&")]);
    assert.deepEqual(
      enlaces.map((e) => e[0]),
      ["Toda la línea", "Anillos (2)", "Aretes", "Cadenas (1)"],
    );
    assert.deepEqual(enlaces.map((e) => e[1]), [`${BASE}?linea=plata`, `${BASE}?linea=plata&categoria=${ANILLOS}`, `${BASE}?linea=plata&categoria=${ARETES}`, `${BASE}?linea=plata&categoria=${CADENAS}`]);
  });

  it("el conteo de cada categoría es el de DENTRO de la línea, y las que no tienen piezas ahí siguen estando, sin «(0)»", () => {
    const nav = navDeLinea(plata, "Plata");
    assert.ok(nav.includes("(2)") && nav.includes("(1)"));
    assert.ok(!nav.includes("(0)"));
    assert.ok(nav.includes("Aretes"), "Aretes no tiene plata y aun así está");
  });

  it("«Toda la línea» es la actual cuando no hay categoría elegida", () => {
    const nav = navDeLinea(plata, "Plata");
    assert.equal(cuenta(nav, /aria-current="page"/g), 1);
    assert.ok(/aria-current="page"[^>]*>Toda la línea</.test(nav) || /Toda la línea[^]*?aria-current/.test(nav) === false);
    assert.ok(nav.indexOf("aria-current") < nav.indexOf("Anillos"), "la marcada es la primera");
  });

  it("con una categoría elegida: migas Inicio / Catálogo / Plata (enlace) / Anillos, y ese chip queda marcado", () => {
    const html = listado({ filtros: f({ lineas: ["plata"], categorias: [ANILLOS] }), titulo: "Plata · Anillos", categoria: ANILLOS });
    const m = migas(html);
    assert.ok(m.includes(`href="${BASE}?linea=plata"`), "Plata es un enlace a la línea");
    assert.ok(/aria-current="page"[^>]*>Anillos</.test(m), "Anillos es la página actual");
    const nav = navDeLinea(html, "Plata");
    assert.equal(cuenta(nav, /aria-current="page"/g), 1);
    assert.ok(nav.indexOf("aria-current") > nav.indexOf("Toda la línea"), "la marcada ya no es «Toda la línea»");
    assert.ok(html.includes("Plata · Anillos</h1>"));
  });

  it("al moverse entre categorías conserva los demás filtros (color, precio)", () => {
    const html = listado({ filtros: f({ lineas: ["plata"], colores: ["dorad"], precioMax: 30_000 }), titulo: "Plata" });
    const nav = navDeLinea(html, "Plata");
    for (const h of hrefsDe(nav)) assert.ok(h.includes("linea=plata") && h.includes("color=dorad") && h.includes("precio_max=30000"), h);
    assert.ok(hrefsDe(nav).some((h) => h.includes(`categoria=${ANILLOS}`)));
  });

  it("una línea SIN piezas (Cover Gold hoy) es una página completa: sus categorías están y el aviso es el de siempre, sin «Próximamente»", () => {
    const html = listado({ data: pagina({ products: [], total: 0, pageCount: 1 }), filtros: f({ lineas: ["cover-gold"] }), titulo: "Cover Gold" });
    assert.ok(html.includes(">Cover Gold</h1>"));
    const nav = navDeLinea(html, "Cover Gold");
    assert.deepEqual([...nav.matchAll(/<a [^>]*>(.*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, "")), ["Toda la línea", "Anillos", "Aretes", "Cadenas"]);
    assert.ok(html.includes("No encontramos productos con esos filtros"));
    assert.ok(html.includes(`href="${LISTA}"`) && html.includes("Ver todo el catálogo"));
    assert.ok(!/pr[oó]ximamente/i.test(html));
    assert.ok(!html.includes("(0)"));
  });

  it("con varias líneas a la vez no es «la página de una línea»: es un filtro más, como siempre", () => {
    const html = listado({ filtros: f({ lineas: ["plata", "rodio"] }) });
    assert.ok(!html.includes('aria-label="Categorías de'));
    assert.ok(migas(html).includes("Filtros"));
  });

  it("con búsqueda por texto no hay páginas de línea (ni panel): el listado de siempre", () => {
    const html = listado({ q: "anillo", filtros: f({ lineas: ["plata"] }), facetas: null, titulo: "Resultados para «anillo»" });
    assert.ok(!html.includes('aria-label="Categorías de'));
    assert.ok(migas(html).includes("Búsqueda: anillo"));
  });

  it("sin línea elegida o sin las líneas del negocio no aparece nada de esto (el listado es el de siempre)", () => {
    assert.ok(!listado({ filtros: f({ colores: ["dorad"] }) }).includes('aria-label="Categorías de'));
    assert.ok(!listado({ filtros: f({ lineas: ["plata"] }), lineas: [] }).includes('aria-label="Categorías de'));
    assert.ok(!listado().includes('aria-label="Categorías de'));
  });
});

// ------------------------------------------------------------------------------------------------- panel de filtros
describe("el grupo «Línea» del panel de filtros", () => {
  const html = listado({ filtros: f({ lineas: ["rodio"] }), titulo: "Rodio" });
  const grupo = (h: string) => {
    const i = h.indexOf("<legend");
    const j = h.indexOf(">Línea</legend>");
    assert.ok(j >= 0 && i >= 0, "falta el grupo «Línea»");
    return h.slice(j, h.indexOf("</fieldset>", j));
  };

  /** Cada casilla del grupo: su valor y si viene marcada (sin depender del orden en que React escribe los atributos). */
  const entradas = (g: string) => [...g.matchAll(/<input[^>]*name="linea"[^>]*>/g)].map((m) => ({ valor: /value="([^"]+)"/.exec(m[0])?.[1], marcada: /checked/.test(m[0]) }));

  it("lista las cuatro líneas en su orden, con su valor para la dirección y su conteo, y va ANTES de las categorías", () => {
    const g = grupo(html);
    assert.deepEqual(entradas(g).map((e) => e.valor), ["plata", "rodio", "acero", "cover-gold"]);
    assert.ok(html.indexOf(">Línea</legend>") < html.indexOf(">Categoría del producto</legend>"));
    assert.ok(/Plata[^]*?\(3\)/.test(g) && /Rodio[^]*?\(2\)/.test(g));
  });

  it("una línea sin piezas está, sin «(0)»", () => {
    const g = grupo(html);
    assert.ok(g.includes("Acero") && g.includes("Cover Gold"));
    assert.ok(!g.includes("(0)"));
  });

  it("la elegida en la dirección viene marcada y las demás no", () => {
    const g = grupo(html);
    assert.deepEqual(entradas(g).filter((e) => e.marcada).map((e) => e.valor), ["rodio"]);
  });

  it("sin líneas en las facetas (o vacías) no hay grupo: el panel es el de siempre", () => {
    const sinLineas: FacetasCatalogo = { ...FACETAS };
    delete sinLineas.lineas;
    assert.ok(!listado({ facetas: sinLineas }).includes(">Línea</legend>"));
    assert.ok(!listado({ facetas: { ...FACETAS, lineas: [] } }).includes(">Línea</legend>"));
  });

  it("el formulario sin JavaScript manda la línea con los demás filtros (?todo=1&linea=…)", () => {
    assert.ok(html.includes('<input type="hidden" name="todo" value="1"'));
    assert.ok(html.includes('name="linea"'));
  });
});
