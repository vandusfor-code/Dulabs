/**
 * Filtros del listado del tema "joyeria" (el HTML que llega del servidor, sin JavaScript): el panel con sus grupos, conteos y puntos de color, lo marcado según la dirección, el formulario
 * que funciona sin JavaScript, la hoja del celular, los enlaces de la paginación con los filtros, y lo que NO cambia (con búsqueda por texto, o sin opciones, el listado de siempre).
 * Más las guardas de las medidas del CSS tomadas de la referencia. Negocio FICTICIO; nada toca precios, inventario ni pedidos.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, LISTA, producto } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { FiltrosJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FiltrosJoyeria";
import { ListadoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/ListadoJoyeria";
import { TarjetaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TarjetaJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { SIN_FILTROS, type FacetasCatalogo, type FiltrosCatalogo } from "@/lib/catalogo/filtros";
import type { PublicCatalogPage } from "@/lib/catalogo/publicacion";

const routerFalso = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const C1 = "c0000000-0000-4000-8000-0000000000a1";
const C2 = "c0000000-0000-4000-8000-0000000000a2";
const CATEGORIAS = [
  { id: C1, name: "Aretes" },
  { id: C2, name: "Dije" },
];
const FACETAS: FacetasCatalogo = {
  total: 130,
  categorias: [
    { id: C2, nombre: "Dije", n: 82 },
    { id: C1, nombre: "Aretes", n: 48 },
  ],
  colores: [
    { clave: "dorad", etiqueta: "Dorado", n: 85 },
    { clave: "oro ros", etiqueta: "Oro rosa", n: 2 },
    { clave: "plateri", etiqueta: "Platería", n: 2 },
  ],
  materiales: [{ clave: "rodi", etiqueta: "Rodio", n: 112 }],
  precio: { min: 6_000, max: 112_000 },
};
const f = (over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({ ...SIN_FILTROS, ...over });
const pagina = (over: Partial<PublicCatalogPage> = {}): PublicCatalogPage => ({
  business: { name: "Delacour & Orus", whatsapp: "573000000000" },
  context: "retail",
  products: [producto(1), producto(2)],
  categories: CATEGORIAS,
  total: 130,
  page: 2,
  pageSize: 48,
  pageCount: 3,
  ...over,
});
const envolver = (hijos: React.ReactNode) => (
  <AppRouterContext.Provider value={routerFalso}>
    <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp="573000000000">
      {hijos}
    </TiendaProvider>
  </AppRouterContext.Provider>
);
const listado = (over: { data?: PublicCatalogPage; q?: string; categoria?: string; filtros?: FiltrosCatalogo; facetas?: FacetasCatalogo | null; titulo?: string } = {}) =>
  renderToStaticMarkup(
    envolver(
      <ListadoJoyeria
        data={over.data ?? pagina()}
        basePath={BASE}
        q={over.q}
        categoria={over.categoria}
        listPath={LISTA}
        titulo={over.titulo ?? "Todo el catálogo"}
        filtros={over.filtros ?? SIN_FILTROS}
        facetas={"facetas" in over ? over.facetas : FACETAS}
        tile={(p, i) => <TarjetaJoyeria product={p} basePath={BASE} posicion={i} />}
      />,
    ),
  );
const soloPanel = (filtros: FiltrosCatalogo = SIN_FILTROS, facetas: FacetasCatalogo = FACETAS) =>
  renderToStaticMarkup(
    envolver(
      <FiltrosJoyeria basePath={BASE} filtros={filtros} facetas={facetas} cuenta="130 productos">
        <p>lista</p>
      </FiltrosJoyeria>,
    ),
  );
/** La columna de escritorio: lo que hay dentro de `<aside>` (la hoja del celular repite el mismo panel). */
const columna = (html: string) => html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** Los campos `<input>` del HTML con sus atributos (React no escribe los atributos en el orden en que se declaran). */
const campos = (html: string) =>
  [...html.matchAll(/<input ([^>]*?)\/?>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] ?? ""])) as Record<string, string>);

describe("panel de filtros — lo que llega del servidor", () => {
  it("trae los grupos de la referencia, en su orden, con cada opción y su conteo; «Tipo de pieza» no se dibuja porque la tienda no tiene ese dato", () => {
    const h = columna(soloPanel());
    const titulos = [...h.matchAll(/<legend class="joy-filtro-titulo">([^<]+)<\/legend>/g)].map((m) => m[1]);
    assert.deepEqual(titulos, ["Categoría del producto", "Color", "Material", "Rango de precio"]);
    assert.ok(!/Tipo de pieza/i.test(h));
    const t = texto(h);
    for (const s of ["Dije (82)", "Aretes (48)", "Dorado (85)", "Oro rosa (2)", "Platería (2)", "Rodio (112)"]) assert.ok(t.includes(s), s);
  });

  it("cada casilla es un campo real del formulario (categoría por id, color y material por clave) y lo elegido en la dirección sale marcado", () => {
    const h = columna(soloPanel(f({ categorias: [C1], colores: ["dorad", "oro ros"], materiales: ["rodi"] })));
    const casillas = campos(h).filter((c) => c.type === "checkbox");
    assert.equal(casillas.length, 2 + 3 + 1);
    const marcadas = casillas.filter((c) => "checked" in c).map((c) => `${c.name}=${c.value}`);
    assert.deepEqual(marcadas.sort(), [`categoria=${C1}`, "color=dorad", "color=oro ros", "material=rodi"].sort());
  });

  it("solo los colores conocidos llevan punto; «Platería» (que no es un color) y los materiales no", () => {
    const h = columna(soloPanel());
    const filas = h.split('<label ').slice(1);
    const punto = (etiqueta: string) => filas.find((x) => texto(x).includes(etiqueta))?.includes("joy-filtro-punto");
    assert.equal(punto("Dorado"), true);
    assert.equal(punto("Oro rosa"), true);
    assert.equal(punto("Platería"), false);
    assert.equal(punto("Rodio"), false);
    assert.equal(punto("Dije"), false);
  });

  it("el rango de precio muestra «$ mínimo — $ máximo» y dos deslizadores con nombre (mínimo y máximo) y el valor leído en pesos", () => {
    const h = columna(soloPanel());
    assert.ok(texto(h).includes("$ 6.000 — $ 112.000"));
    assert.ok(h.includes('aria-label="Precio mínimo"') && h.includes('aria-label="Precio máximo"'));
    assert.ok(h.includes('aria-valuetext="$ 6.000"') && h.includes('aria-valuetext="$ 112.000"'));
    assert.equal((h.match(/type="range"/g) ?? []).length, 2);
    const con = columna(soloPanel(f({ precioMin: 20_000, precioMax: 50_000 })));
    assert.ok(texto(con).includes("$ 20.000 — $ 50.000"));
    const ocultos = campos(con).filter((c) => c.type === "hidden").map((c) => `${c.name}=${c.value}`);
    assert.deepEqual(ocultos.sort(), ["precio_max=50000", "precio_min=20000", "todo=1"], "sin JavaScript el rango elegido no se pierde al enviar el formulario");
    assert.deepEqual(campos(h).filter((c) => c.type === "hidden").map((c) => c.name), ["todo"], "sin rango elegido no viaja ningún precio");
  });

  it("un rango fuera de los límites (enlace viejo o a mano) se dibuja dentro de ellos", () => {
    const h = columna(soloPanel(f({ precioMin: 1, precioMax: 9_999_999 })));
    assert.ok(texto(h).includes("$ 6.000 — $ 112.000"));
  });

  it("los grupos sin datos no se dibujan: sin materiales no hay «Material»; sin precios (o todos iguales) no hay deslizador", () => {
    const sinMateriales = columna(soloPanel(SIN_FILTROS, { ...FACETAS, materiales: [] }));
    assert.ok(!sinMateriales.includes(">Material<") && sinMateriales.includes(">Color<"));
    for (const precio of [null, { min: 15_000, max: 15_000 }]) {
      const h = columna(soloPanel(SIN_FILTROS, { ...FACETAS, precio }));
      assert.ok(!h.includes("Rango de precio") && !h.includes('type="range"'));
    }
  });

  it("sin JavaScript es un formulario GET al listado («?todo=1&…») con su botón «Aplicar filtros»", () => {
    const h = columna(soloPanel());
    assert.ok(new RegExp(`<form [^>]*action="${BASE}"`).test(h) && /<form [^>]*method="get"/.test(h));
    assert.deepEqual(campos(h).find((c) => c.type === "hidden"), { type: "hidden", name: "todo", value: "1" });
    assert.ok(/<noscript><button type="submit"[^>]*>Aplicar filtros<\/button><\/noscript>/.test(h));
  });

  it("«Quitar filtros» solo aparece con filtros elegidos y lleva al listado completo; el contador del botón del celular cuenta los grupos elegidos", () => {
    assert.ok(!columna(soloPanel()).includes("Quitar filtros"));
    const con = soloPanel(f({ categorias: [C1, C2], colores: ["dorad"], precioMax: 50_000 }));
    assert.ok(/<a [^>]*href="[^"]*\?todo=1"[^>]*>(<svg[\s\S]*?<\/svg>)?Quitar filtros<\/a>/.test(columna(con)));
    assert.ok(con.includes('<span class="joy-filtro-contador">4<span class="sr-only"> filtros activos</span></span>'), "2 categorías + 1 color + el precio = 4");
    assert.ok(soloPanel(f({ materiales: ["rodi"] })).includes('<span class="joy-filtro-contador">1<span class="sr-only"> filtro activo</span></span>'));
    assert.ok(!soloPanel().includes("joy-filtro-contador"));
  });

  it("la hoja del celular es un diálogo con su nombre, el título «Filtros» y el botón «Cerrar filtros»; el botón «Filtrar» la abre y solo se ve en celular", () => {
    const h = soloPanel();
    assert.ok(/<dialog[^>]*aria-label="Filtros del catálogo"[^>]*class="joy-hoja"/.test(h) || /<dialog[^>]*class="joy-hoja"[^>]*aria-label="Filtros del catálogo"/.test(h));
    assert.ok(h.includes('aria-label="Cerrar filtros"') && h.includes(">Filtros</h2>"));
    assert.ok(/<button type="button" aria-haspopup="dialog" class="[^"]*lg:hidden[^"]*">/.test(h));
    assert.ok(/<aside class="hidden w-60 shrink-0 lg:block"/.test(h), "la columna solo se ve en escritorio");
  });

  it("como en la referencia: cada conteo es un elemento aparte pegado al borde derecho de su fila (con un espacio para el lector de pantalla) y la barra lleva el conteo a la izquierda y «Filtrar» a la derecha", () => {
    const h = columna(soloPanel());
    assert.ok(/<span class="joy-filtro-texto">Dije<\/span> <span class="joy-filtro-n">\(82\)<\/span><\/label>/.test(h), h.slice(h.indexOf("Dije") - 60, h.indexOf("Dije") + 120));
    const barra = soloPanel();
    assert.ok(barra.indexOf('<p role="status">130 productos</p>') < barra.indexOf('aria-haspopup="dialog"'), "primero el conteo, después el botón");
  });

  it("el pie de la hoja trae el botón «Filtrar» (cierra la hoja) y la leyenda «N productos con los filtros actuales»; el título «Filtros» va en sans", () => {
    const h = soloPanel();
    const hoja = h.slice(h.indexOf("<dialog"), h.indexOf("</dialog>"));
    assert.ok(/<div class="joy-hoja-pie"><button type="button" class="[^"]*w-full[^"]*">Filtrar<\/button><p role="status" class="[^"]*">130 productos con los filtros actuales<\/p><\/div>/.test(hoja), hoja.slice(-420));
    assert.ok(hoja.indexOf("joy-hoja-cuerpo") < hoja.indexOf("joy-hoja-pie"), "el pie va después del cuerpo con desplazamiento");
    assert.ok(/<h2 class="text-lg font-medium text-fg">Filtros<\/h2>/.test(hoja) && !/<h2[^>]*font-serif-tienda[^>]*>Filtros/.test(hoja));
  });

  it("el panel de escritorio y el de la hoja no repiten ningún id (cada casilla tiene el suyo)", () => {
    const ids = [...soloPanel().matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 2 * (2 + 3 + 1 + 2));
    assert.equal(new Set(ids).size, ids.length, "ids repetidos");
  });

  it("la lista y la paginación llegan dentro del contenedor que se atenúa mientras carga, con el conteo anunciado como estado", () => {
    const h = soloPanel();
    assert.ok(/<div class="joy-resultados" aria-busy="false"><p>lista<\/p><\/div>/.test(h));
    assert.ok(h.includes('<p role="status">130 productos</p>'));
  });
});

describe("listado joyería con filtros — la página completa", () => {
  it("sin búsqueda y con opciones, el panel reemplaza a la columna de categorías y a los chips de siempre", () => {
    const h = listado();
    assert.ok(h.includes("joy-filtro-grupo"));
    assert.ok(!h.includes("joy-cat-lateral") && !h.includes("joy-chip"));
    assert.equal((h.match(/<h1[ >]/g) ?? []).length, 1);
  });

  it("la paginación conserva los filtros elegidos y la página 1 no se escribe", () => {
    const h = listado({ filtros: f({ categorias: [C1, C2], colores: ["dorad"], precioMax: 50_000 }) });
    const base = `${BASE}?categoria=${C1}&amp;categoria=${C2}&amp;color=dorad&amp;precio_max=50000`;
    assert.ok(h.includes(`href="${base}"`), "anterior = página 1 (sin «pagina»)");
    assert.ok(h.includes(`href="${base}&amp;pagina=3"`), "siguiente");
    assert.ok(h.includes("Página 2 de 3"));
    const sinFiltros = listado();
    assert.ok(sinFiltros.includes(`href="${LISTA}"`) && sinFiltros.includes(`href="${BASE}?pagina=3"`));
  });

  it("migas y título: una sola categoría la nombra; varias o solo color/material/precio dicen «Filtros»; sin filtros no hay tercera miga", () => {
    const una = listado({ filtros: f({ categorias: [C2] }), titulo: "Dije" });
    assert.ok(una.includes(">Dije</span>") && una.includes('aria-current="page"'));
    const varias = listado({ filtros: f({ categorias: [C1, C2] }) });
    assert.ok(texto(varias).includes("Catálogo / Filtros"));
    const color = listado({ filtros: f({ colores: ["dorad"] }) });
    assert.ok(texto(color).includes("Catálogo / Filtros"));
    assert.ok(/<a [^>]*href="[^"]*\?todo=1"[^>]*>Catálogo<\/a>/.test(color), "«Catálogo» vuelve al listado completo");
    assert.ok(!texto(listado()).includes("Catálogo / Filtros"));
  });

  it("sin resultados dice que no hay productos con esos filtros y ofrece volver al listado completo", () => {
    const h = listado({ data: pagina({ products: [], total: 0, pageCount: 1, page: 1 }), filtros: f({ colores: ["dorad"], precioMin: 100_000 }) });
    assert.ok(h.includes("No encontramos productos con esos filtros"));
    assert.ok(h.includes(`href="${LISTA}"`) && h.includes("Ver todo el catálogo"));
    assert.ok(listado({ data: pagina({ products: [], total: 0, pageCount: 1, page: 1 }) }).includes("Pronto verás productos aquí"));
  });

  it("con búsqueda por texto no hay panel: rigen la columna de categorías y las direcciones de siempre (la búsqueda se conserva)", () => {
    const h = listado({ q: "cadena", data: pagina({ search: { relaxed: false, capped: false } }) });
    assert.ok(!h.includes("joy-filtro-grupo") && h.includes("joy-cat-lateral") && h.includes("joy-chip"));
    assert.ok(h.includes(`?q=cadena&amp;pagina=3`));
    assert.ok(h.includes("Búsqueda: cadena"));
  });

  it("si el catálogo es demasiado grande para contar (sin opciones), tampoco hay panel: el listado de siempre", () => {
    for (const facetas of [null, undefined]) {
      const h = listado({ facetas, categoria: C2 });
      assert.ok(!h.includes("joy-filtro-grupo") && h.includes("joy-cat-lateral-activa"));
      assert.ok(h.includes(`?categoria=${C2}&amp;pagina=3`));
    }
  });
});

describe("reglas de CSS del panel de filtros (guardas de las medidas de la referencia)", () => {
  const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
  const regla = (selector: string) => {
    const i = css.indexOf(selector + " {");
    assert.ok(i >= 0, `falta la regla ${selector}`);
    return css.slice(i, css.indexOf("}", i));
  };

  it("grupos: filete de 1 px, 28 px de aire; títulos de 12 px en mayúsculas con 0,16 em; casillas de 16 px con esquinas de 3 px; filas de 14 px en peso 300 separadas 10 px", () => {
    const grupo = regla(".tienda-joyeria .joy-filtro-grupo");
    assert.match(grupo, /border-bottom:\s*1px solid var\(--color-edge\)/);
    assert.match(grupo, /padding:\s*0 0 1\.75rem/);
    assert.match(regla(".tienda-joyeria .joy-filtro-grupo + .joy-filtro-grupo"), /margin-top:\s*1\.75rem/);
    const ultimo = regla(".tienda-joyeria .joy-filtro-grupo:last-of-type");
    assert.match(ultimo, /border-bottom:\s*0/);
    assert.match(ultimo, /padding-bottom:\s*0/);
    const titulo = regla(".tienda-joyeria .joy-filtro-titulo");
    assert.match(titulo, /font-size:\s*0\.75rem/);
    assert.match(titulo, /letter-spacing:\s*0\.16em/);
    assert.match(titulo, /text-transform:\s*uppercase/);
    const caja = regla(".tienda-joyeria .joy-filtro-caja");
    assert.match(caja, /width:\s*1rem/);
    assert.match(caja, /height:\s*1rem/);
    assert.match(caja, /border-radius:\s*3px/);
    assert.match(regla(".tienda-joyeria .joy-filtro-lista"), /gap:\s*0\.625rem/);
    const fila = regla(".tienda-joyeria .joy-filtro-fila");
    assert.match(fila, /font-size:\s*0\.875rem/);
    assert.match(fila, /font-weight:\s*300/);
  });

  it("accesibilidad: los bordes de los controles tienen contraste ≥ 3:1 sobre el crema (medido: casilla 3,3:1; casilla marcada y perilla 3,8:1) y el conteo no usa transparencia", () => {
    assert.match(css, /--joy-control: color-mix\(in srgb, var\(--color-mist\) 75%, var\(--color-card\)\);/);
    assert.match(css, /--joy-control-oro: color-mix\(in srgb, var\(--joy-oro\) 50%, var\(--tienda-oro\)\);/);
    assert.match(regla(".tienda-joyeria .joy-filtro-caja"), /border:\s*1px solid var\(--joy-control\)/);
    assert.match(regla(".tienda-joyeria .joy-filtro-caja:checked"), /border-color:\s*var\(--joy-control-oro\)/);
    assert.match(regla(".tienda-joyeria .joy-rango-input::-webkit-slider-thumb"), /var\(--joy-control-oro\) 6\.5px 7\.5px/);
    assert.match(regla(".tienda-joyeria .joy-rango-input::-moz-range-thumb"), /var\(--joy-control-oro\) 6\.5px 7\.5px/);
    assert.doesNotMatch(regla(".tienda-joyeria .joy-filtro-n"), /opacity|rgb\([^)]*\/|rgba/);
  });

  it("el conteo de cada opción va pegado al borde derecho (12 px, cifras tabulares) y el pie de la hoja respeta la zona segura del teléfono", () => {
    const n = regla(".tienda-joyeria .joy-filtro-n");
    assert.match(n, /margin-left:\s*auto/);
    assert.match(n, /font-size:\s*0\.75rem/);
    assert.match(n, /font-variant-numeric:\s*tabular-nums/);
    const pie = regla(".tienda-joyeria .joy-hoja-pie");
    assert.match(pie, /padding:\s*1rem 1\.25rem calc\(1rem \+ env\(safe-area-inset-bottom\)\)/);
    assert.match(pie, /border-top:\s*1px solid var\(--color-edge\)/);
    assert.match(regla(".tienda-joyeria .joy-hoja-pie .joy-boton-linea"), /border-color:\s*color-mix\(in srgb, var\(--joy-oro\) 70%, transparent\)/);
    assert.match(regla(".tienda-joyeria .joy-rango-texto"), /color:\s*var\(--color-fg\)/);
  });

  it("deslizador: perillas solo con puntero (el resto del campo lo deja pasar), 24 px de área táctil y la línea del tramo elegido en dorado", () => {
    assert.match(regla(".tienda-joyeria .joy-rango-input"), /pointer-events:\s*none/);
    assert.match(regla(".tienda-joyeria .joy-rango-input::-webkit-slider-thumb"), /pointer-events:\s*auto/);
    assert.match(regla(".tienda-joyeria .joy-rango-input::-webkit-slider-thumb"), /width:\s*1\.5rem/);
    assert.match(regla(".tienda-joyeria .joy-rango-input::-moz-range-thumb"), /pointer-events:\s*auto/);
    assert.match(css, /\.tienda-joyeria \.joy-rango-activa \{\n  left:[^}]*background-color:\s*var\(--joy-oro\)/);
    assert.match(regla(".tienda-joyeria .joy-rango-texto"), /font-variant-numeric:\s*tabular-nums/);
  });

  it("hoja del celular: 88 % de alto, esquinas de 18 px arriba, velo 0,35 con 8 px de desenfoque", () => {
    const hoja = regla(".tienda-joyeria dialog.joy-hoja");
    assert.match(hoja, /max-height:\s*88dvh/);
    assert.match(hoja, /border-radius:\s*18px 18px 0 0/);
    const velo = regla(".tienda-joyeria dialog.joy-hoja::backdrop");
    assert.match(velo, /background:\s*rgb\(30 25 20 \/ 0\.35\)/);
    assert.match(velo, /backdrop-filter:\s*blur\(8px\)/);
  });

  it("hoja del celular: abre en 0,305 s con la curva medida y cierra en 0,31 s; el velo entra en 0,13 s y sale en 0,206 s; todo bajo prefers-reduced-motion: no-preference", () => {
    const inicio = css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  .tienda-joyeria dialog.joy-hoja {");
    assert.ok(inicio >= 0, "el movimiento de la hoja está dentro de «sin preferencia de movimiento reducido»");
    const bloque = css.slice(inicio, css.indexOf("@media (prefers-reduced-motion: reduce)", inicio));
    assert.match(bloque, /\.tienda-joyeria dialog\.joy-hoja \{\n    translate: 0 100%;\n    transition:\n      translate 0\.31s ease,/);
    assert.match(bloque, /\.tienda-joyeria dialog\.joy-hoja\[open\] \{\n    translate: 0 0;\n    transition:\n      translate 0\.305s cubic-bezier\(0\.16, 1, 0\.3, 1\),/);
    assert.match(bloque, /dialog\.joy-hoja::backdrop \{\n    opacity: 0;\n    transition:\n      opacity 0\.206s ease,/);
    assert.match(bloque, /dialog\.joy-hoja\[open\]::backdrop \{\n    opacity: 1;\n    transition:\n      opacity 0\.13s ease-out,/);
    assert.match(bloque, /@starting-style \{\n    \.tienda-joyeria dialog\.joy-hoja\[open\] \{\n      translate: 0 100%;/);
    // Fuera de ese bloque la hoja no declara transiciones: con movimiento reducido aparece y desaparece al instante.
    const fuera = css.slice(0, inicio) + css.slice(inicio + bloque.length);
    assert.doesNotMatch(fuera, /dialog\.joy-hoja[^{]*\{[^}]*transition/);
  });

  it("la lista se atenúa mientras carga (con una espera de 0,15 s para que una respuesta inmediata no parpadee) y sin movimiento reducido no se anima", () => {
    assert.match(regla(".tienda-joyeria .joy-resultados[data-pendiente]"), /opacity:\s*0\.55;\n  transition:\s*opacity 0\.2s ease 0\.15s/);
    assert.match(css, /prefers-reduced-motion: reduce\) \{\n  \.tienda-joyeria \.joy-filtro-fila,[\s\S]*?\.tienda-joyeria \.joy-resultados\[data-pendiente\] \{\n    transition: none;/);
  });
});
