import "@/lib/test-helpers/jsdom-setup";
/**
 * Tema "joyeria": las PÁGINAS PROPIAS en el menú de arriba (jsdom). La administradora pone una página («Quiénes somos») en el menú desde el panel; el marco de la tienda se la entrega a la cabecera y esta la
 * dibuja junto a «Inicio», «Catálogo» y «Categorías», con su texto y su dirección, marcada como la actual cuando se está en ella; el menú lateral del celular la lleva igual. Sin páginas en el menú, la
 * cabecera es EXACTAMENTE la de siempre. La barra inferior del celular no marca ninguna pestaña en una página propia.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { CromoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/CromoJoyeria";
import { NavInferior } from "@/components/catalogo-publico/tienda/NavInferior";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { enlacesDePaginas } from "@/lib/cms-comercial/pagina";

/* eslint-disable @typescript-eslint/no-explicit-any */
// jsdom no trae <dialog>.showModal(): se imita lo mínimo (abre/cierra y avisa), que es lo que la tienda necesita.
const dialogo = (window as any).HTMLDialogElement.prototype;
dialogo.showModal = function showModal(this: HTMLElement) {
  this.setAttribute("open", "");
};
dialogo.close = function close(this: HTMLElement) {
  if (!this.hasAttribute("open")) return;
  this.removeAttribute("open");
  this.dispatchEvent(new (window as any).Event("close"));
};
(window as any).matchMedia = (consulta: string) => ({ matches: false, media: consulta, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
(globalThis as any).IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
/* eslint-enable @typescript-eslint/no-explicit-any */

afterEach(cleanup);

const routerFalso = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const BASE = "/catalogo/prueba";
const LISTA = `${BASE}?todo=1`;
const CATEGORIAS = [
  { id: "c1", name: "Aretes" },
  { id: "c2", name: "Dijes" },
];
const NOSOTROS = { texto: "Nosotros", href: `${BASE}/p/quienes-somos` };
const CONTACTO = { texto: "Contacto", href: `${BASE}/p/contacto` };
let n = 0;
const slugNuevo = () => `joy-menu-${++n}`;

function conTienda(slug: string, hijos: React.ReactNode, ruta = BASE, consulta = "") {
  return (
    <AppRouterContext.Provider value={routerFalso}>
      <PathnameContext.Provider value={ruta}>
        <SearchParamsContext.Provider value={new URLSearchParams(consulta) as never}>
          <TiendaProvider slug={slug} context="retail" basePath={BASE} whatsapp="573001112233">
            {hijos}
          </TiendaProvider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}
type Pagina = { texto: string; href: string };
const cromo = (paginas?: readonly Pagina[], over: { categorias?: typeof CATEGORIAS; mayorista?: boolean } = {}) => (
  <CromoJoyeria marca={{ name: "Tienda de prueba", descriptor: "Joyería" }} basePath={BASE} listPath={LISTA} categorias={over.categorias ?? CATEGORIAS} categoriasHref={`${BASE}#categorias`} anuncios={[]} mayorista={over.mayorista ?? true} paginas={paginas} />
);
const enlacesDeLaCabecera = (c: HTMLElement) => [...c.querySelectorAll('nav[aria-label="Menú principal"] a')] as HTMLElement[];
const textos = (els: HTMLElement[]) => els.map((a) => a.textContent);
/** Las filas principales del menú lateral, en orden (sin las categorías que se despliegan debajo de «Categorías»). */
const filasDelMenuLateral = (c: HTMLElement) => [...(c.querySelector("dialog.joy-menu") as HTMLElement).querySelectorAll(".joy-fila-menu:not(.joy-fila-sub)")] as HTMLElement[];

describe("cabecera de la joyería — las páginas del menú", () => {
  it("van después de «Categorías» y antes de «Mayorista», con su texto y su dirección, en el orden que reciben", () => {
    const { container } = render(conTienda(slugNuevo(), cromo([NOSOTROS, CONTACTO])));
    const enlaces = enlacesDeLaCabecera(container);
    assert.deepEqual(textos(enlaces), ["Inicio", "Catálogo", "Categorías", "Nosotros", "Contacto", "Mayorista"]);
    assert.deepEqual(
      enlaces.map((a) => a.getAttribute("href")),
      [BASE, LISTA, `${BASE}#categorias`, `${BASE}/p/quienes-somos`, `${BASE}/p/contacto`, `${BASE}#mayoristas`],
    );
  });

  it("se dibujan como los demás enlaces del menú (no como la píldora de «Mayorista») y nunca se parten en dos líneas", () => {
    const { container } = render(conTienda(slugNuevo(), cromo([NOSOTROS])));
    const enlaces = enlacesDeLaCabecera(container);
    const nosotros = (enlaces.find((a) => a.textContent === "Nosotros") as HTMLElement).className.split(" ");
    const categorias = (enlaces.find((a) => a.textContent === "Categorías") as HTMLElement).className.split(" ");
    for (const clase of categorias) assert.ok(nosotros.includes(clase), `«Nosotros» lleva la clase de «Categorías»: ${clase}`);
    assert.ok(!nosotros.includes("joy-pildora-nav"));
    assert.ok(nosotros.includes("whitespace-nowrap"), "un texto largo no se parte en dos líneas dentro de la cabecera");
  });

  it("estando en una de ellas, solo esa queda marcada como la página actual (ni «Inicio», ni «Catálogo», ni las otras)", () => {
    const { container } = render(conTienda(slugNuevo(), cromo([NOSOTROS, CONTACTO]), NOSOTROS.href));
    const enlaces = enlacesDeLaCabecera(container);
    assert.deepEqual(textos(enlaces.filter((a) => a.getAttribute("aria-current") === "page")), ["Nosotros"]);
  });

  it("en el inicio o en el catálogo ninguna de ellas queda marcada", () => {
    for (const [ruta, consulta] of [[BASE, ""], [BASE, "todo=1"]] as const) {
      const { container, unmount } = render(conTienda(slugNuevo(), cromo([NOSOTROS, CONTACTO]), ruta, consulta));
      const marcadas = textos(enlacesDeLaCabecera(container).filter((a) => a.getAttribute("aria-current") === "page"));
      assert.ok(!marcadas.includes("Nosotros") && !marcadas.includes("Contacto"), `${ruta}?${consulta}: ${marcadas.join(",")}`);
      unmount();
    }
  });

  it("sin páginas en el menú la cabecera es exactamente la de siempre (con la propiedad vacía o sin ella)", () => {
    const sin = render(conTienda(slugNuevo(), cromo()));
    const antes = textos(enlacesDeLaCabecera(sin.container));
    sin.unmount();
    const vacia = render(conTienda(slugNuevo(), cromo([])));
    assert.deepEqual(textos(enlacesDeLaCabecera(vacia.container)), antes);
    assert.deepEqual(antes, ["Inicio", "Catálogo", "Categorías", "Mayorista"]);
  });

  it("siguen apareciendo aunque la tienda no tenga categorías ni mayoristas", () => {
    const { container } = render(conTienda(slugNuevo(), cromo([NOSOTROS], { categorias: [], mayorista: false })));
    assert.deepEqual(textos(enlacesDeLaCabecera(container)), ["Inicio", "Catálogo", "Nosotros"]);
  });

  it("el texto se muestra como texto, nunca como HTML", () => {
    const raro = { texto: "<b>Nosotros</b>", href: `${BASE}/p/x` };
    const { container } = render(conTienda(slugNuevo(), cromo([raro])));
    const enlace = enlacesDeLaCabecera(container).find((a) => a.getAttribute("href") === raro.href) as HTMLElement;
    assert.equal(enlace.textContent, "<b>Nosotros</b>");
    assert.equal(enlace.querySelector("b"), null);
  });
});

describe("cabecera de la joyería — desde qué ancho es la de escritorio", () => {
  /** Las clases que deciden la forma de la cabecera: la rejilla, el botón del menú lateral y el menú de escritorio. */
  const partes = (c: HTMLElement) => {
    const grid = (c.querySelector(".joy-cab > div") as HTMLElement).className;
    const boton = (c.querySelector('button[aria-label="Abrir menú"]')?.parentElement as HTMLElement).className;
    const nav = (c.querySelector('nav[aria-label="Menú principal"]') as HTMLElement).className;
    return { grid, boton, nav, todas: `${grid} ${boton} ${nav}` };
  };

  const clases = (texto: string) => texto.split(/\s+/).filter(Boolean).sort();

  it("sin páginas: EXACTAMENTE las clases de siempre (la de escritorio empieza en 1024 px y reparte el ancho en tres partes iguales): ni una más, ni una menos", () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const p = partes(container);
    assert.deepEqual(clases(p.grid), clases("mx-auto grid h-16 max-w-7xl grid-cols-[96px_minmax(0,1fr)_96px] items-center px-2 sm:px-6 md:h-20 lg:grid-cols-[1fr_auto_1fr] lg:px-8"));
    assert.deepEqual(clases(p.boton), clases("col-start-1 row-start-1 flex items-center lg:hidden"));
    assert.deepEqual(clases(p.nav), clases("col-start-2 row-start-1 hidden items-center gap-7 lg:flex xl:gap-9"));
    const marca = (container.querySelector(".joy-marca") as HTMLElement).className;
    assert.deepEqual(clases(marca), clases("joy-marca col-start-2 row-start-1 flex min-w-0 flex-col items-center justify-center rounded-sm text-center leading-none lg:col-start-1 lg:items-start lg:text-left"));
    const nombre = (container.querySelector(".joy-marca > span") as HTMLElement).className;
    assert.ok(nombre.split(" ").includes("lg:text-[26px]") && nombre.split(" ").includes("md:text-xl"));
    const iconos = (container.querySelector('button[aria-label="Buscar"]')?.parentElement as HTMLElement).className;
    assert.deepEqual(clases(iconos), clases("col-start-3 row-start-1 flex items-center justify-end lg:gap-1"));
  });

  it("con páginas: la de escritorio empieza en 1280 px (por debajo se usa el menú lateral) y, si el menú no cabe en una fila, pasa a dos en vez de apretar la marca o empujar los iconos", () => {
    const { container } = render(conTienda(slugNuevo(), cromo([NOSOTROS])));
    const p = partes(container);
    assert.match(p.grid, /xl:grid-cols-\[minmax\(max-content,1fr\)_minmax\(0,auto\)_minmax\(max-content,1fr\)\]/, "columnas tan anchas como su contenido");
    assert.match(p.boton, /(^| )xl:hidden( |$)/);
    assert.match(p.nav, /(^| )xl:flex( |$)/);
    assert.match(p.nav, /(^| )xl:flex-wrap( |$)/);
    assert.ok(!/(^| )lg:/.test(p.todas), `a 1024 px ya no hay lugar: ninguna clase lg: con páginas: ${p.todas}`);
  });
});

describe("menú lateral del celular — las páginas del menú", () => {
  it("van después de «Mayoristas» y antes de «Categorías», con su dirección", () => {
    const { container, getByLabelText } = render(conTienda(slugNuevo(), cromo([NOSOTROS, CONTACTO])));
    fireEvent.click(getByLabelText("Abrir menú"));
    const filas = filasDelMenuLateral(container);
    assert.deepEqual(textos(filas), ["Inicio", "Todo el catálogo", "Mayoristas", "Nosotros", "Contacto", "Categorías"]);
    assert.equal(filas[3].getAttribute("href"), `${BASE}/p/quienes-somos`);
    assert.equal(filas[4].getAttribute("href"), `${BASE}/p/contacto`);
  });

  it("al tocar una, el menú se cierra", () => {
    const { container, getByLabelText } = render(conTienda(slugNuevo(), cromo([NOSOTROS])));
    fireEvent.click(getByLabelText("Abrir menú"));
    const menu = container.querySelector("dialog.joy-menu") as HTMLElement;
    assert.ok(menu.hasAttribute("open"));
    fireEvent.click(filasDelMenuLateral(container).find((a) => a.textContent === "Nosotros") as HTMLElement);
    assert.equal(menu.hasAttribute("open"), false);
  });

  it("estando en la página, su fila queda marcada como la actual y solo esa", () => {
    const { container, getByLabelText } = render(conTienda(slugNuevo(), cromo([NOSOTROS, CONTACTO]), CONTACTO.href));
    fireEvent.click(getByLabelText("Abrir menú"));
    assert.deepEqual(textos(filasDelMenuLateral(container).filter((a) => a.getAttribute("aria-current") === "page")), ["Contacto"]);
  });

  it("sin páginas el menú lateral es el de siempre", () => {
    const { container, getByLabelText } = render(conTienda(slugNuevo(), cromo()));
    fireEvent.click(getByLabelText("Abrir menú"));
    assert.deepEqual(textos(filasDelMenuLateral(container)), ["Inicio", "Todo el catálogo", "Mayoristas", "Categorías"]);
  });
});

describe("barra inferior del celular — en una página propia no se marca ninguna pestaña", () => {
  const marcadas = (c: HTMLElement) => [...c.querySelectorAll('nav[aria-label="Navegación de la tienda"] a[aria-current="page"]')].map((a) => a.textContent);
  const barra = (rutasAparte?: readonly string[]) => <NavInferior basePath={BASE} categoriasHref={`${BASE}#categorias`} rutasAparte={rutasAparte} />;

  it("con las rutas de las páginas publicadas como rutas aparte (lo que entrega el marco de la tienda), ninguna pestaña queda marcada en ellas", () => {
    const { rutasAparte } = enlacesDePaginas(BASE, { menu: [], paginas: ["quienes-somos", "terminos"] });
    for (const ruta of [`${BASE}/p/quienes-somos`, `${BASE}/p/terminos`]) {
      const { container, unmount } = render(conTienda(slugNuevo(), barra(rutasAparte), ruta));
      assert.deepEqual(marcadas(container), [], ruta);
      unmount();
    }
  });

  it("el inicio y el catálogo siguen marcando lo suyo con esas rutas aparte", () => {
    const { rutasAparte } = enlacesDePaginas(BASE, { menu: [], paginas: ["quienes-somos"] });
    const inicio = render(conTienda(slugNuevo(), barra(rutasAparte), BASE));
    assert.deepEqual(marcadas(inicio.container), ["Inicio"]);
    inicio.unmount();
    const catalogo = render(conTienda(slugNuevo(), barra(rutasAparte), BASE, "todo=1"));
    assert.deepEqual(marcadas(catalogo.container), ["Categorías"]);
  });

  it("sin ellas (el comportamiento de antes) una página propia marcaba «Categorías»: por eso el marco las entrega", () => {
    const { container } = render(conTienda(slugNuevo(), barra(), `${BASE}/p/quienes-somos`));
    assert.deepEqual(marcadas(container), ["Categorías"]);
  });
});
