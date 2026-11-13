/**
 * El lado de HOMBRE de Delacour (Vértice) en el HTML que llega del servidor, sin JavaScript: el selector Mujer | Hombre, la portada del listado de hombre (nombre, antetítulo y lema de la colección), sus
 * migas, el panel de filtros que conserva el lado, la ficha de una pieza de hombre y la entrada «Para él» del inicio. Negocio y piezas FICTICIOS.
 *
 * Lo que se exige: el lado es DÓNDE se está y no un filtro elegido (no aparece «Quitar filtros» por estar en el lado de hombre); cada pieza conserva su REFERENCIA sobre la foto (`DL-…`, la que usa el
 * bot para identificarla); la entrada del inicio no cambia nada del resto del inicio; y sin la separación (otros negocios, o sin piezas de hombre) todo es exactamente como siempre.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, HOME_COMPLETO, LISTA, NOMBRE_NEGOCIO, producto } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { FichaProductoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FichaProductoJoyeria";
import { ListadoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/ListadoJoyeria";
import { SelectorGenero } from "@/components/catalogo-publico/tienda/joyeria/SelectorGenero";
import { TarjetaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TarjetaJoyeria";
import { TiendaInicioJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { SIN_FILTROS, type FacetasCatalogo, type FiltrosCatalogo } from "@/lib/catalogo/filtros";
import { hrefDeGenero } from "@/lib/catalogo/genero";
import { lineasVisibles } from "@/lib/catalogo/joyeria";
import { calcularLineas } from "@/lib/catalogo/lineas";
import type { PublicCatalogPage, PublicProductDetail } from "@/lib/catalogo/publicacion";
import type { PublicHome } from "@/lib/catalogo/service";
import { joyeriaOf, storefrontConfigFor, type ConfigJoyeria } from "@/lib/catalogo/vitrina";

const routerFalso = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const WHATSAPP = "573000000000";
const REGISTRO = storefrontConfigFor("delacour");
const JOYERIA = joyeriaOf(REGISTRO)!;
const GENERO = JOYERIA.genero!;
const LINEAS_CFG = JOYERIA.lineas!.lineas;
const LISTA_HOMBRE = hrefDeGenero(BASE, "hombre");

const ARETES = "c0000000-0000-4000-8000-0000000000a1";
const DIJES = "c0000000-0000-4000-8000-0000000000a2";
const CADENAS = "c0000000-0000-4000-8000-0000000000a3";
const CATEGORIAS = [
  { id: ARETES, name: "Aretes" },
  { id: DIJES, name: "Dijes" },
  { id: CADENAS, name: "Cadenas" },
];
// Las piezas de hombre de la colección (referencias reales de la importación: DL-000769 en adelante).
const HOMBRES = [769, 770, 771, 772, 773].map((n) => producto(n, { name: `Dije de acero ${n}`, categoryName: "Dijes", material: "Acero" }));
const f = (over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({ ...SIN_FILTROS, ...over });

// ------------------------------------------------------------------------------------------------- ayudas
const cuenta = (html: string, patron: RegExp) => (html.match(patron) ?? []).length;
const pos = (html: string, texto: string) => {
  const i = html.indexOf(texto);
  assert.ok(i >= 0, `falta «${texto}»`);
  return i;
};
/** Los atributos de una etiqueta, sin depender del orden en que React los escribe. */
function atributos(etiqueta: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of etiqueta.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2].replaceAll("&amp;", "&").replaceAll("&quot;", '"');
  return out;
}
/** Dónde empiezan a diferir dos textos (con un poco de contexto de cada uno): el mensaje de una comparación de HTML largo. */
function diferencia(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `difieren en el carácter ${i}: «${a.slice(Math.max(0, i - 60), i + 160)}» ≠ «${b.slice(Math.max(0, i - 60), i + 160)}»`;
}
/** Las referencias escritas SOBRE las fotos (el módulo «marca_referencia»: lo que el cliente ve en una captura y le dicta al bot), en orden. */
const marcasSobreFotos = (html: string) => [...html.matchAll(/<span class="[^"]*\bjoy-ref\b[^"]*"[^>]*>(DL-\d+)<\/span>/g)].map((m) => m[1]);
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const migas = (html: string) => {
  const i = html.indexOf('aria-label="Migas de pan"');
  assert.ok(i >= 0, "faltan las migas");
  return html.slice(i, html.indexOf("</nav>", i));
};
/** Los lados del selector, en orden: [valor, etiqueta, href, ¿actual?]. */
function lados(html: string) {
  const i = html.indexOf('aria-label="Ver la tienda para"');
  assert.ok(i >= 0, "falta el selector Mujer | Hombre");
  const grupo = html.slice(i, html.indexOf("</div>", i));
  return [...grupo.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => {
    const a = atributos(m[0]);
    return { lado: a["data-lado"], etiqueta: m[1], href: a.href, actual: a["aria-current"] === "true" };
  });
}

function envolver(hijos: React.ReactNode, marcaReferencia = true) {
  return (
    <AppRouterContext.Provider value={routerFalso}>
      <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp={WHATSAPP} marcaReferencia={marcaReferencia}>
        {hijos}
      </TiendaProvider>
    </AppRouterContext.Provider>
  );
}

// ------------------------------------------------------------------------------------------------- selector
describe("el selector Mujer | Hombre", () => {
  const dibujar = (hombre: boolean, variante?: "nav" | "menu" | "listado") => renderToStaticMarkup(<SelectorGenero basePath={BASE} hombre={hombre} etiquetas={{ mujer: "Mujer", hombre: "Hombre" }} variante={variante} />);

  it("son dos ENLACES normales (sirven sin JavaScript y se pueden compartir): Mujer a la tienda de siempre y Hombre al listado de hombre", () => {
    const h = dibujar(false);
    assert.ok(h.includes('role="group"') && h.includes('aria-label="Ver la tienda para"'));
    assert.deepEqual(
      lados(h).map((l) => [l.lado, l.etiqueta, l.href]),
      [
        ["mujer", "Mujer", BASE],
        ["hombre", "Hombre", `${BASE}?genero=hombre`],
      ],
    );
  });

  it("el lado actual va marcado (aria-current) y es uno solo, en los dos sentidos", () => {
    assert.deepEqual(lados(dibujar(false)).map((l) => l.actual), [true, false]);
    assert.deepEqual(lados(dibujar(true)).map((l) => l.actual), [false, true]);
  });

  it("la variante del menú lateral y la del listado llevan su clase (la cabecera de escritorio, la base)", () => {
    const clases = (h: string) => /class="([^"]*joy-genero[^"]*)"/.exec(h)![1].split(" ");
    assert.deepEqual(clases(dibujar(false)), ["joy-genero"]);
    assert.deepEqual(clases(dibujar(false, "menu")), ["joy-genero", "joy-genero-menu"]);
    assert.deepEqual(clases(dibujar(false, "listado")), ["joy-genero", "joy-genero-listado"]);
  });
});

// ------------------------------------------------------------------------------------------------- listado
const FILAS_HOMBRE = [
  { categoryId: DIJES, material: "Acero" },
  { categoryId: DIJES, material: "Acero" },
  { categoryId: DIJES, material: "Acero" },
  { categoryId: CADENAS, material: "Acero" },
];
const FACETAS_HOMBRE: FacetasCatalogo = {
  total: 4,
  categorias: [
    { id: DIJES, nombre: "Dijes", n: 3 },
    { id: CADENAS, nombre: "Cadenas", n: 1 },
  ],
  colores: [{ clave: "plat", etiqueta: "Plateado", n: 4 }],
  materiales: [{ clave: "acer", etiqueta: "Acero", n: 4 }],
  precio: { min: 40_000, max: 60_000 },
  lineas: calcularLineas(FILAS_HOMBRE, LINEAS_CFG),
};
const paginaHombre = (over: Partial<PublicCatalogPage> = {}): PublicCatalogPage => ({
  business: { name: NOMBRE_NEGOCIO, whatsapp: WHATSAPP },
  context: "retail",
  products: HOMBRES.slice(0, 4),
  categories: CATEGORIAS,
  total: 4,
  page: 1,
  pageSize: 48,
  pageCount: 1,
  ...over,
});
function listado(over: { data?: PublicCatalogPage; filtros?: FiltrosCatalogo; facetas?: FacetasCatalogo | null; titulo?: string; listPath?: string; genero?: { config: typeof GENERO; hombre: boolean } | null; marca?: boolean } = {}) {
  return renderToStaticMarkup(
    envolver(
      <ListadoJoyeria
        data={over.data ?? paginaHombre()}
        basePath={BASE}
        listPath={over.listPath ?? LISTA_HOMBRE}
        titulo={over.titulo ?? "Vértice"}
        filtros={over.filtros ?? f({ genero: "hombre" })}
        facetas={over.facetas === undefined ? FACETAS_HOMBRE : over.facetas}
        lineas={LINEAS_CFG}
        genero={over.genero === null ? undefined : (over.genero ?? { config: GENERO, hombre: true })}
        tile={(p, i) => <TarjetaJoyeria product={p} basePath={BASE} posicion={i} />}
      />,
      over.marca ?? true,
    ),
  );
}

describe("el listado del lado de hombre: la portada de la colección", () => {
  const h = listado();

  it("el título es UN solo h1, el de la colección, con el rótulo de Vértice (casa, antetítulo y lema) en su lugar", () => {
    assert.equal(cuenta(h, /<h1[ >]/g), 1);
    assert.match(h, /<h1 class="joy-vertice-titulo">Vértice<\/h1>/);
    const cab = h.slice(pos(h, 'class="joy-vertice-cabecera'));
    for (const frase of ["Delacour", "Colección masculina", "Identidad forjada en acero", "4 productos"]) assert.ok(texto(cab.slice(0, cab.indexOf("</header>"))).includes(frase), frase);
    assert.ok(h.indexOf("joy-vertice-casa") < h.indexOf("joy-vertice-antetitulo") && h.indexOf("joy-vertice-antetitulo") < h.indexOf("joy-vertice-titulo") && h.indexOf("joy-vertice-titulo") < h.indexOf("joy-vertice-lema"));
  });

  it("el selector está bajo las migas, con Hombre como el lado actual y las direcciones de siempre", () => {
    assert.equal(cuenta(h, /aria-label="Ver la tienda para"/g), 1);
    assert.deepEqual(
      lados(h).map((l) => [l.lado, l.href, l.actual]),
      [
        ["mujer", BASE, false],
        ["hombre", LISTA_HOMBRE, true],
      ],
    );
    assert.ok(h.includes("joy-genero joy-genero-listado"));
    assert.ok(h.indexOf('aria-label="Migas de pan"') < h.indexOf('aria-label="Ver la tienda para"'));
  });

  it("las migas son Inicio / Hombre, con «Hombre» como la página actual (no «Catálogo»)", () => {
    const m = migas(h);
    assert.ok(/aria-current="page"[^>]*>Hombre</.test(m), m);
    assert.ok(!m.includes("Catálogo") && !m.includes("Filtros"));
    assert.ok(m.indexOf("Inicio") < m.indexOf("Hombre"));
  });

  it("el lado NO es un filtro: sin nada más elegido no hay «Quitar filtros» ni «Filtros» en las migas", () => {
    assert.ok(!h.includes("Quitar filtros"));
    assert.ok(!h.includes("No encontramos productos"));
  });

  it("cada pieza de la colección trae su REFERENCIA sobre la foto (`DL-…`), la que usa el bot para identificarla — y debajo del nombre", () => {
    assert.deepEqual(marcasSobreFotos(h), ["DL-000769", "DL-000770", "DL-000771", "DL-000772"]);
    for (const p of HOMBRES.slice(0, 4)) assert.equal(cuenta(h, new RegExp(`>${p.reference}<`, "g")), 2, `${p.reference}: la marca sobre la foto y la referencia bajo el nombre`);
    assert.ok(!h.includes(`>${HOMBRES[4].reference}<`), "la quinta no está en esta página");
    assert.equal(cuenta(h, /<article class="joy-tarjeta/g), 4);
    // la marca sobre la foto es la del módulo del negocio: sin él, ninguna (la referencia bajo el nombre sigue)
    const sinModulo = listado({ marca: false });
    assert.deepEqual(marcasSobreFotos(sinModulo), []);
    assert.equal(cuenta(sinModulo, />DL-000769</g), 1);
  });

  it("el panel de filtros se queda en el lado de hombre: el formulario sin JavaScript manda genero=hombre con los demás filtros", () => {
    const entradas = [...h.matchAll(/<input[^>]*name="genero"[^>]*>/g)].map((m) => atributos(m[0]));
    assert.ok(entradas.length >= 1, "falta el campo oculto del lado");
    for (const e of entradas) assert.deepEqual([e.type, e.value], ["hidden", "hombre"]);
    assert.ok(h.includes('name="todo"'));
  });

  it("con un filtro puesto: el lema se va, «Hombre» es un enlace de vuelta al listado de hombre y «Quitar filtros» se queda EN el lado de hombre", () => {
    const con = listado({ filtros: f({ genero: "hombre", colores: ["plat"] }), titulo: "Vértice" });
    assert.ok(!con.includes("joy-vertice-lema"));
    const m = migas(con);
    assert.ok(m.includes(`href="${LISTA_HOMBRE}"`) && m.includes(">Hombre<"), m);
    assert.ok(/aria-current="page"[^>]*>Filtros</.test(m), m);
    const quitar = /<a [^>]*>(?:(?!<\/a>).)*Quitar filtros<\/a>/.exec(con.replaceAll("\n", " "));
    assert.ok(quitar, "falta «Quitar filtros»");
    assert.equal(atributos(quitar![0]).href, `${BASE}?genero=hombre`);
  });

  it("la página de una línea dentro de Hombre ofrece solo las categorías que TIENEN piezas (la colección es nueva: no se ofrecen vacías)", () => {
    const acero = listado({ filtros: f({ genero: "hombre", lineas: ["acero"] }), titulo: "Vértice · Acero" });
    const nav = acero.slice(pos(acero, 'aria-label="Categorías de Acero"'));
    const chips = [...nav.slice(0, nav.indexOf("</nav>")).matchAll(/<a [^>]*>(.*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    assert.deepEqual(chips, ["Toda la línea", "Dijes (3)", "Cadenas (1)"]);
    // el mismo listado fuera del lado de hombre las ofrece todas, como siempre
    const mujer = listado({ filtros: f({ lineas: ["acero"] }), titulo: "Acero", listPath: LISTA, genero: { config: GENERO, hombre: false } });
    const navMujer = mujer.slice(pos(mujer, 'aria-label="Categorías de Acero"'));
    const chipsMujer = [...navMujer.slice(0, navMujer.indexOf("</nav>")).matchAll(/<a [^>]*>(.*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    assert.deepEqual(chipsMujer, ["Toda la línea", "Aretes", "Dijes (3)", "Cadenas (1)"]);
  });
});

describe("el listado del lado de mujer y el de una tienda sin separación", () => {
  it("en el lado de mujer (con separación) el selector marca Mujer, no hay portada de Vértice y la tienda es la de siempre", () => {
    const h = listado({ filtros: SIN_FILTROS, titulo: "Todo el catálogo", listPath: LISTA, genero: { config: GENERO, hombre: false }, data: paginaHombre({ products: [producto(1), producto(2)], total: 2 }) });
    assert.deepEqual(lados(h).map((l) => l.actual), [true, false]);
    assert.ok(!h.includes("joy-vertice"), "nada de la colección masculina");
    assert.ok(h.includes("font-serif-tienda") && h.includes(">Todo el catálogo</h1>"));
    assert.ok(/aria-current="page"[^>]*>Catálogo</.test(migas(h)));
    assert.ok(!h.includes('name="genero"'), "sin lado en el formulario");
    assert.ok(!h.includes("Colección masculina"));
  });

  it("sin la propiedad `genero` (otros negocios, o una tienda sin piezas de hombre) NO hay selector ni nada de Vértice: la página es la de siempre", () => {
    const h = listado({ filtros: SIN_FILTROS, titulo: "Todo el catálogo", listPath: LISTA, genero: null });
    for (const rastro of ["joy-genero", "joy-vertice", "Ver la tienda para", "Colección masculina", 'name="genero"', "genero="]) assert.ok(!h.includes(rastro), `quedó «${rastro}»`);
    assert.ok(/aria-current="page"[^>]*>Catálogo</.test(migas(h)));
  });

  it("el listado de mujer es IDÉNTICO con y sin selector salvo el selector mismo (nada más cambia de lugar)", () => {
    const base = { filtros: SIN_FILTROS, titulo: "Todo el catálogo", listPath: LISTA, data: paginaHombre({ products: [producto(1), producto(2)], total: 2 }) };
    const con = listado({ ...base, genero: { config: GENERO, hombre: false } });
    const sin = listado({ ...base, genero: null });
    const sinSelector = con.replace(/<div class="joy-genero[^>]*>[\s\S]*?<\/div>/, "");
    assert.equal(sinSelector, sin);
  });
});

// ------------------------------------------------------------------------------------------------- ficha
describe("la ficha de una pieza de hombre", () => {
  const detalle = (over: Partial<PublicProductDetail> = {}): PublicProductDetail => ({
    ...producto(769),
    name: "Dije ancla de acero",
    description: "Dije de acero inoxidable.",
    material: "Acero",
    color: "Plateado",
    price: 48_000,
    categoryId: DIJES,
    categoryName: "Dijes",
    gallery: [{ imageUrl: "/a-main.webp", detailUrl: "/a-detail.webp", thumbUrl: "/a-thumb.webp" }],
    ...over,
  });
  const ficha = (p: PublicProductDetail, hombre: boolean | null) =>
    renderToStaticMarkup(
      envolver(<FichaProductoJoyeria producto={p} categorias={CATEGORIAS} basePath={BASE} listPath={hombre ? LISTA_HOMBRE : LISTA} genero={hombre === null ? undefined : { config: GENERO, hombre }} />),
    );
  const enlacesDeMigas = (h: string) => [...migas(h).matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], atributos(m[0]).href]);

  it("las migas son Inicio / Hombre / Dijes / la pieza, y apuntan al lado de hombre (listado y categoría), no a la tienda de mujer", () => {
    assert.deepEqual(enlacesDeMigas(ficha(detalle(), true)), [
      ["Inicio", BASE],
      ["Hombre", LISTA_HOMBRE],
      ["Dijes", `${BASE}?genero=hombre&categoria=${DIJES}`],
    ]);
  });

  it("lleva el rótulo «Delacour · Vértice» sobre el nombre, y la categoría del rótulo también va al lado de hombre", () => {
    const h = ficha(detalle(), true);
    assert.ok(texto(h).includes("Delacour · Vértice"));
    assert.ok(h.includes('class="joy-vertice-antetitulo mb-2"'));
    const enlaces = [...h.matchAll(/<a [^>]*>Dijes<\/a>/g)].map((m) => atributos(m[0]).href);
    assert.ok(enlaces.length >= 2 && enlaces.every((x) => x === `${BASE}?genero=hombre&categoria=${DIJES}`), enlaces.join(" | "));
  });

  it("conserva TODO lo que dice la ficha: nombre, referencia, precio, material y color — y la REFERENCIA sobre la foto para el bot", () => {
    const h = ficha(detalle(), true);
    const t = texto(h);
    for (const frase of ["Dije ancla de acero", "Ref. DL-000769", "Dije de acero inoxidable.", "Acero", "Plateado", "Disponible"]) assert.ok(t.includes(frase), frase);
    assert.ok(h.includes(">DL-000769<"), "la marca sobre la foto");
    assert.ok(!ficha(detalle(), true).includes("Precio a consultar"));
    // sin el módulo, sin marca sobre la foto (pero la ficha sigue diciendo «Ref.»)
    const sinMarca = renderToStaticMarkup(envolver(<FichaProductoJoyeria producto={detalle()} categorias={CATEGORIAS} basePath={BASE} listPath={LISTA_HOMBRE} genero={{ config: GENERO, hombre: true }} />, false));
    assert.ok(!sinMarca.includes(">DL-000769<") && texto(sinMarca).includes("Ref. DL-000769"));
  });

  it("una pieza de mujer (o una tienda sin separación) tiene la ficha de siempre: «Catálogo», categoría con ?categoria= y nada de Vértice", () => {
    for (const hombre of [false, null] as const) {
      const h = ficha(detalle({ ...producto(1), categoryId: DIJES }), hombre);
      assert.deepEqual(enlacesDeMigas(h), [
        ["Inicio", BASE],
        ["Catálogo", LISTA],
        ["Dijes", `${BASE}?categoria=${encodeURIComponent(DIJES)}`],
      ]);
      assert.ok(!h.includes("Vértice") && !h.includes("joy-vertice"));
    }
  });
});

// ------------------------------------------------------------------------------------------------- inicio
describe("la entrada «Para él» del inicio", () => {
  const CONFIG_LINEAS = JOYERIA.lineas!;
  const HOME_HOMBRE: PublicHome = { ...HOME_COMPLETO, hombre: { total: 76, items: HOMBRES } };
  function inicio(over: { home?: PublicHome; joyeria?: ConfigJoyeria } = {}): string {
    return renderToStaticMarkup(
      envolver(
        <TiendaInicioJoyeria
          home={over.home ?? HOME_HOMBRE}
          config={REGISTRO}
          joyeria={over.joyeria ?? JOYERIA}
          basePath={BASE}
          listPath={LISTA}
          businessName={NOMBRE_NEGOCIO}
          whatsapp={WHATSAPP}
          lineas={lineasVisibles(CONFIG_LINEAS, CATEGORIAS, BASE)}
        />,
      ),
    );
  }
  const franja = (h: string) => {
    const i = pos(h, '<section id="vertice"');
    return h.slice(i, h.indexOf("</section>", i));
  };
  const h = inicio();

  it("es una sección con su título h2 real (Vértice), su rótulo y su lema, y sigue habiendo un solo h1", () => {
    assert.equal(cuenta(h, /id="vertice"/g), 1);
    assert.ok(h.includes('<section id="vertice" aria-labelledby="joy-vertice"'));
    assert.match(franja(h), /<h2 id="joy-vertice" class="joy-vertice-titulo">Vértice<\/h2>/);
    const t = texto(franja(h));
    for (const frase of ["Delacour", "Para él", "Identidad forjada en acero", "Una colección de dijes de acero para hombre", "Ver la colección"]) assert.ok(t.includes(frase), frase);
    assert.equal(cuenta(h, /<h1[ >]/g), 1);
  });

  it("el botón lleva al listado de hombre (`?genero=hombre`)", () => {
    const boton = /<a [^>]*class="[^"]*joy-vertice-boton[^"]*"[^>]*>/.exec(franja(h));
    assert.ok(boton, "falta el botón");
    assert.equal(atributos(boton![0]).href, LISTA_HOMBRE);
  });

  it("muestra hasta 4 piezas, cada una con su foto y su REFERENCIA (`DL-…`) como en cualquier tarjeta de la tienda", () => {
    const f4 = franja(h);
    assert.ok(f4.includes('aria-label="Piezas de Vértice"'));
    assert.equal(cuenta(f4, /<article class="joy-tarjeta/g), 4);
    assert.deepEqual(marcasSobreFotos(f4), ["DL-000769", "DL-000770", "DL-000771", "DL-000772"], "la marca sobre cada foto, en orden");
    for (const p of HOMBRES.slice(0, 4)) {
      assert.equal(cuenta(f4, new RegExp(`>${p.reference}<`, "g")), 2, `${p.reference}: la marca sobre la foto y la referencia bajo el nombre`);
      assert.ok(f4.includes(p.thumbUrl!.replaceAll("&", "&amp;")), `falta la foto de ${p.reference}`);
    }
    assert.ok(!f4.includes(`>${HOMBRES[4].reference}<`), "la quinta no entra");
  });

  it("sus fotos se cargan al acercarse (lazy): la franja está muy por debajo de la primera pantalla y no le quita prioridad de carga a la portada", () => {
    const f4 = franja(h);
    const imgs = [...f4.matchAll(/<img [^>]*>/g)].map((m) => atributos(m[0]));
    assert.equal(imgs.length, 4);
    for (const a of imgs) assert.deepEqual([a.loading, a.fetchpriority ?? a.fetchPriority ?? "auto"], ["lazy", "auto"], a.src);
    // y las precargas de la página (lo que el navegador pide ya) son SOLO las de la primera pantalla: ninguna foto de hombre
    const precargas = [...h.matchAll(/<link rel="preload" as="image" href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(precargas.length > 0 && precargas.every((x) => !/dl-0007\d\d/.test(x)), precargas.join(" | "));
  });

  it("va después de «Nuestras líneas» y antes de las categorías (entre lo de la marca y lo de la tienda de siempre)", () => {
    assert.ok(pos(h, 'id="lineas"') < pos(h, 'id="vertice"'));
    assert.ok(pos(h, 'id="vertice"') < pos(h, 'id="categorias"'));
  });

  it("el resto del inicio NO cambia: quitada la franja, el HTML es idéntico al de una tienda sin piezas de hombre", () => {
    const sin = inicio({ home: HOME_COMPLETO });
    assert.ok(!sin.includes('id="vertice"'));
    // (cada bloque del inicio va en su propio <div>: se quita junto con su envoltorio)
    const conFranjaQuitada = h.replace(/<div><section id="vertice"[\s\S]*?<\/section><\/div>/, "");
    assert.ok(conFranjaQuitada === sin, diferencia(conFranjaQuitada, sin));
  });

  it("sin piezas de hombre (la propiedad ausente o en cero) o sin la separación en la configuración del negocio, la franja no existe", () => {
    assert.ok(!inicio({ home: { ...HOME_COMPLETO } }).includes('id="vertice"'));
    assert.ok(!inicio({ home: { ...HOME_COMPLETO, hombre: { total: 0, items: [] } } }).includes('id="vertice"'));
    const sinSeparacion: ConfigJoyeria = { ...JOYERIA };
    delete sinSeparacion.genero;
    const h2 = inicio({ joyeria: sinSeparacion });
    for (const rastro of ["id=\"vertice\"", "joy-vertice", "genero=hombre"]) assert.ok(!h2.includes(rastro), rastro);
  });

  it("con piezas de hombre pero sin fotos aún, la franja dibuja el texto y el botón (sin la lista de piezas)", () => {
    const h3 = inicio({ home: { ...HOME_COMPLETO, hombre: { total: 3, items: [] } } });
    assert.ok(h3.includes('id="vertice"') && h3.includes("joy-vertice-boton"));
    assert.ok(!h3.includes("joy-vertice-piezas"));
  });
});
