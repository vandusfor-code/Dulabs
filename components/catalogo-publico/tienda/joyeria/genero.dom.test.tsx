import "@/lib/test-helpers/jsdom-setup";
/**
 * El lado de HOMBRE de Delacour (Vértice): lo que hace el cliente (jsdom). La señal que pinta toda la tienda (`TemaGenero`) sigue a la dirección —el listado de hombre y la ficha de una pieza de hombre
 * sí; lo demás no— sin esperar a que llegue la página nueva; la cabecera y el menú lateral traen el selector Mujer | Hombre con el lado actual marcado; y el panel de filtros se queda en el lado de
 * hombre al marcar, quitar o limpiar filtros. Negocio y piezas FICTICIOS; nada de esto toca precios, stock ni pedidos.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { CromoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/CromoJoyeria";
import { FiltrosJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FiltrosJoyeria";
import { TemaGenero } from "@/components/catalogo-publico/tienda/joyeria/TemaGenero";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { SIN_FILTROS, type FacetasCatalogo, type FiltrosCatalogo } from "@/lib/catalogo/filtros";

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

const BASE = "/catalogo/prueba";
const LISTA = `${BASE}?todo=1`;
const HOMBRES = ["DL-000769", "DL-000770"];
const CATEGORIAS = [
  { id: "c1", name: "Aretes" },
  { id: "c2", name: "Dijes" },
];

const empujes: Array<{ url: string; opciones: unknown }> = [];
const router = {
  back() {},
  forward() {},
  refresh() {},
  replace() {},
  prefetch() {},
  push(url: string, opciones?: unknown) {
    empujes.push({ url, opciones });
  },
} as never;

let n = 0;
const slugNuevo = () => `joy-genero-${++n}`;
/** Las direcciones que da el navegador: la ruta y los parámetros (lo que Next entrega a usePathname y useSearchParams). */
function conRuta(ruta: string, consulta: string, hijos: React.ReactNode, slug = "joy-genero-fijo") {
  return (
    <AppRouterContext.Provider value={router}>
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

beforeEach(() => {
  empujes.length = 0;
  window.localStorage.clear();
  document.body.innerHTML = "";
});
afterEach(async () => {
  await act(async () => {}); // termina lo que haya quedado pendiente (transiciones, efectos) antes de desmontar
  cleanup();
});

// ------------------------------------------------------------------------------------------------- la señal del tema
describe("TemaGenero — la señal que pinta toda la tienda con la paleta de Vértice", () => {
  const marca = (c: HTMLElement) => c.querySelector('[data-tema-genero="hombre"]');
  const dibujar = (ruta: string, consulta: string, hombres: readonly string[] = HOMBRES) => conRuta(ruta, consulta, <TemaGenero basePath={BASE} hombres={hombres} />);

  it("en el listado de hombre (?genero=hombre) hay señal: un <span hidden> vacío, que no es contenido de la página", () => {
    const { container } = render(dibujar(BASE, "genero=hombre"));
    const s = marca(container) as HTMLElement;
    assert.ok(s, "falta la señal");
    assert.equal(s.tagName, "SPAN");
    assert.equal(s.hasAttribute("hidden"), true);
    assert.equal(s.textContent, "");
    assert.equal(s.children.length, 0);
  });

  it("en la tienda de siempre, el listado de mujer y las demás páginas NO hay señal", () => {
    for (const [ruta, consulta] of [
      [BASE, ""],
      [BASE, "todo=1"],
      [BASE, "genero=mujer"],
      [BASE, "genero=otro"],
      [`${BASE}/mayoristas`, ""],
      [`${BASE}/p/nuestra-esencia`, ""],
    ] as const) {
      const { container, unmount } = render(dibujar(ruta, consulta));
      assert.equal(marca(container), null, `${ruta}?${consulta}`);
      unmount();
    }
  });

  it("en la ficha de una pieza de hombre hay señal desde la primera pantalla (aunque la dirección diga la referencia en minúsculas); en la de una pieza de mujer no", () => {
    const a = render(dibujar(`${BASE}/productos/dl-000769`, ""));
    assert.ok(marca(a.container), "ficha de hombre en minúsculas");
    a.unmount();
    const b = render(dibujar(`${BASE}/productos/DL-000770`, ""));
    assert.ok(marca(b.container), "ficha de hombre en mayúsculas");
    b.unmount();
    const c = render(dibujar(`${BASE}/productos/dl-000001`, ""));
    assert.equal(marca(c.container), null, "ficha de mujer");
  });

  it("sin piezas de hombre en la tienda no hay señal, ni aunque la dirección pida ?genero=hombre (un enlace viejo no pinta de oscuro una tienda que no tiene ese lado)", () => {
    const { container } = render(dibujar(BASE, "genero=hombre", []));
    assert.equal(marca(container), null);
  });

  it("sigue a la dirección al navegar (sin recargar): entra al lado de hombre, sale de él, y pasa de la ficha de hombre a la de mujer", () => {
    const { container, rerender } = render(dibujar(BASE, ""));
    assert.equal(marca(container), null);
    rerender(dibujar(BASE, "genero=hombre"));
    assert.ok(marca(container), "al tocar «Hombre»");
    rerender(dibujar(`${BASE}/productos/dl-000770`, ""));
    assert.ok(marca(container), "ya en la ficha de una pieza de hombre");
    rerender(dibujar(`${BASE}/productos/dl-000001`, ""));
    assert.equal(marca(container), null, "al pasar a una pieza de mujer");
    rerender(dibujar(BASE, ""));
    assert.equal(marca(container), null);
  });
});

// ------------------------------------------------------------------------------------------------- cabecera y menú lateral
describe("cabecera y menú lateral — el selector Mujer | Hombre", () => {
  const GENERO = { etiquetas: { mujer: "Mujer", hombre: "Hombre" }, hombres: HOMBRES };
  /** `null` = la tienda sin separación (sin la propiedad `genero`). */
  const cromo = (genero: typeof GENERO | null = GENERO) => (
    <CromoJoyeria marca={{ name: "Tienda de prueba", descriptor: "Joyería" }} basePath={BASE} listPath={LISTA} categorias={CATEGORIAS} categoriasHref={`${BASE}#categorias`} anuncios={[]} mayorista genero={genero ?? undefined} />
  );
  const nav = (c: HTMLElement) => c.querySelector('nav[aria-label="Menú principal"]') as HTMLElement;
  const menu = (c: HTMLElement) => c.querySelector("dialog.joy-menu") as HTMLDialogElement;
  const lados = (grupo: Element) => [...grupo.querySelectorAll("a")].map((a) => ({ lado: a.getAttribute("data-lado"), texto: a.textContent, href: a.getAttribute("href"), actual: a.getAttribute("aria-current") === "true" }));
  const enlace = (donde: HTMLElement, texto: string) => within(donde).getByText(texto, { selector: "a" });

  it("la cabecera de escritorio abre con el selector (antes de «Inicio») y el menú lateral lo trae arriba de todo, cada uno con sus dos enlaces", () => {
    const { container } = render(conRuta(BASE, "", cromo(), slugNuevo()));
    const grupos = container.querySelectorAll(".joy-genero");
    assert.equal(grupos.length, 2);
    const enCabecera = nav(container).querySelector(".joy-genero")!;
    assert.equal(nav(container).firstElementChild, enCabecera, "el selector es lo primero de la navegación");
    const enMenu = menu(container).querySelector(".joy-genero")!;
    assert.ok(enMenu.classList.contains("joy-genero-menu"));
    const primerEnlace = menu(container).querySelector("a.joy-fila-menu")!;
    assert.ok(enMenu.compareDocumentPosition(primerEnlace) & Node.DOCUMENT_POSITION_FOLLOWING, "y va antes de «Inicio»");
    for (const g of [enCabecera, enMenu]) {
      assert.deepEqual(
        lados(g).map((l) => [l.lado, l.texto, l.href]),
        [
          ["mujer", "Mujer", BASE],
          ["hombre", "Hombre", `${BASE}?genero=hombre`],
        ],
      );
    }
  });

  it("en el inicio o en el listado de mujer el lado actual es Mujer (en la cabecera y en el menú)", () => {
    for (const [ruta, consulta] of [
      [BASE, ""],
      [BASE, "todo=1"],
      [`${BASE}/mayoristas`, ""],
      [`${BASE}/productos/dl-000001`, ""],
    ] as const) {
      const { container, unmount } = render(conRuta(ruta, consulta, cromo(), slugNuevo()));
      for (const g of container.querySelectorAll(".joy-genero")) assert.deepEqual(lados(g).map((l) => l.actual), [true, false], `${ruta}?${consulta}`);
      unmount();
    }
  });

  it("en el inicio de hombre, su listado y la ficha de una pieza de hombre el lado actual es Hombre; «Inicio» está marcado en el inicio de hombre y «Catálogo» en su listado (como en el lado de mujer)", () => {
    // [ruta, consulta, ¿«Inicio» marcado?, ¿«Catálogo» marcado?]
    for (const [ruta, consulta, inicio, catalogo] of [
      [BASE, "genero=hombre", true, false],
      [BASE, "genero=hombre&todo=1", false, true],
      [BASE, "genero=hombre&color=platead", false, true],
      [`${BASE}/productos/dl-000769`, "", false, false],
    ] as const) {
      const { container, unmount } = render(conRuta(ruta, consulta, cromo(), slugNuevo()));
      for (const g of container.querySelectorAll(".joy-genero")) assert.deepEqual(lados(g).map((l) => l.actual), [false, true], `${ruta}?${consulta}`);
      const marcado = (a: HTMLElement) => a.getAttribute("aria-current") === "page";
      assert.equal(marcado(enlace(nav(container), "Inicio")), inicio, `«Inicio» de la cabecera en ${ruta}?${consulta}`);
      assert.equal(marcado(enlace(nav(container), "Catálogo")), catalogo, `«Catálogo» de la cabecera en ${ruta}?${consulta}`);
      assert.equal(marcado(enlace(menu(container), "Todo el catálogo")), catalogo, `«Todo el catálogo» del menú en ${ruta}?${consulta}`);
      unmount();
    }
  });

  it("en el lado de hombre «Inicio» y «Catálogo» (cabecera y menú) llevan al inicio y al listado de HOMBRE; en el de mujer, a los de siempre", () => {
    const hombre = render(conRuta(BASE, "genero=hombre", cromo(), slugNuevo()));
    assert.equal(enlace(nav(hombre.container), "Inicio").getAttribute("href"), `${BASE}?genero=hombre`);
    assert.equal(enlace(nav(hombre.container), "Catálogo").getAttribute("href"), `${BASE}?genero=hombre&todo=1`);
    assert.equal(enlace(menu(hombre.container), "Inicio").getAttribute("href"), `${BASE}?genero=hombre`);
    assert.equal(enlace(menu(hombre.container), "Todo el catálogo").getAttribute("href"), `${BASE}?genero=hombre&todo=1`);
    hombre.unmount();
    const mujer = render(conRuta(BASE, "", cromo(), slugNuevo()));
    assert.equal(enlace(nav(mujer.container), "Inicio").getAttribute("href"), BASE);
    assert.equal(enlace(nav(mujer.container), "Catálogo").getAttribute("href"), LISTA);
    assert.equal(enlace(menu(mujer.container), "Todo el catálogo").getAttribute("href"), LISTA);
  });

  it("en el listado de mujer «Catálogo» sí está marcado (como siempre)", () => {
    const { container } = render(conRuta(BASE, "todo=1", cromo(), slugNuevo()));
    assert.equal(enlace(nav(container), "Catálogo").getAttribute("aria-current"), "page");
    assert.equal(enlace(menu(container), "Todo el catálogo").getAttribute("aria-current"), "page");
  });

  it("el lado actual sigue a la dirección al navegar, sin recargar (Mujer → Hombre → ficha de mujer → Mujer)", () => {
    const slug = slugNuevo();
    const { container, rerender } = render(conRuta(BASE, "todo=1", cromo(), slug));
    const actual = () => lados(nav(container).querySelector(".joy-genero")!).find((l) => l.actual)!.lado;
    assert.equal(actual(), "mujer");
    rerender(conRuta(BASE, "genero=hombre", cromo(), slug));
    assert.equal(actual(), "hombre");
    rerender(conRuta(`${BASE}/productos/dl-000001`, "", cromo(), slug));
    assert.equal(actual(), "mujer");
  });

  it("sin la separación (otro negocio, o sin piezas de hombre) no hay selector y la cabecera es la de siempre (ancho de lg, no el amplio)", () => {
    const { container } = render(conRuta(BASE, "", cromo(null), slugNuevo()));
    assert.equal(container.querySelectorAll(".joy-genero").length, 0);
    assert.ok(nav(container).className.includes("lg:flex") && !nav(container).className.includes("xl:flex"), nav(container).className);
    assert.deepEqual([...nav(container).querySelectorAll("a")].map((a) => a.textContent), ["Inicio", "Catálogo", "Categorías", "Mayorista"]);
  });

  it("con el selector la cabecera pide el ancho amplio (desde xl; por debajo se usa el menú lateral, que ya trae el selector)", () => {
    const { container } = render(conRuta(BASE, "", cromo(), slugNuevo()));
    assert.ok(nav(container).className.includes("xl:flex") && !nav(container).className.includes("lg:flex"), nav(container).className);
    // y los accesos van más juntos (24 px y no 36) para caber en UNA fila: sin esto «Mayorista» bajaba a una segunda fila (medido en la tienda en vivo a 1920 px)
    assert.ok(nav(container).className.includes("xl:gap-x-6") && !nav(container).className.includes("xl:gap-x-9"), nav(container).className);
    assert.deepEqual(
      [...nav(container).querySelectorAll("a")].map((a) => a.textContent),
      ["Mujer", "Hombre", "Inicio", "Catálogo", "Categorías", "Mayorista"],
    );
  });

  it("la cabecera ancha SIN selector (páginas propias en el menú) conserva su espacio de siempre (36 px): el ajuste es solo para el selector", () => {
    const sinSelector = (
      <CromoJoyeria
        marca={{ name: "Tienda de prueba", descriptor: "Joyería" }}
        basePath={BASE}
        listPath={LISTA}
        categorias={CATEGORIAS}
        categoriasHref={`${BASE}#categorias`}
        anuncios={[]}
        mayorista
        paginas={[{ texto: "Nuestra Esencia", href: `${BASE}/p/nuestra-esencia` }]}
      />
    );
    const { container } = render(conRuta(BASE, "", sinSelector, slugNuevo()));
    assert.ok(nav(container).className.includes("xl:gap-x-9") && !nav(container).className.includes("xl:gap-x-6"), nav(container).className);
  });

  it("elegir un lado desde el menú lateral lo cierra (como cualquier otro destino del menú)", async () => {
    const { container, getByLabelText } = render(conRuta(BASE, "", cromo(), slugNuevo()));
    const dlg = menu(container);
    fireEvent.click(getByLabelText("Abrir menú"));
    await waitFor(() => assert.equal(dlg.hasAttribute("open"), true));
    document.addEventListener("click", (e) => e.preventDefault(), { capture: true, once: true }); // jsdom no navega: solo se comprueba que el menú se cierra
    fireEvent.click(dlg.querySelector('a[data-lado="hombre"]')!);
    await waitFor(() => assert.equal(dlg.hasAttribute("open"), false));
  });
});

// ------------------------------------------------------------------------------------------------- panel de filtros
describe("filtros joyería — el lado de hombre se queda al filtrar", () => {
  const FACETAS: FacetasCatalogo = {
    total: 4,
    categorias: [{ id: "c2", nombre: "Dijes", n: 4 }],
    colores: [
      { clave: "platead", etiqueta: "Plateado", n: 3 },
      { clave: "negr", etiqueta: "Negro", n: 1 },
    ],
    materiales: [{ clave: "acer", etiqueta: "Acero", n: 4 }],
    precio: { min: 40_000, max: 60_000 },
  };
  const f = (over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({ ...SIN_FILTROS, ...over });
  const panel = (filtros: FiltrosCatalogo) => (
    <AppRouterContext.Provider value={router}>
      <FiltrosJoyeria basePath={BASE} filtros={filtros} facetas={FACETAS} cuenta="4 productos">
        <p>lista</p>
      </FiltrosJoyeria>
    </AppRouterContext.Provider>
  );
  const aside = (c: HTMLElement) => c.querySelector("aside") as HTMLElement;
  const caja = (zona: HTMLElement, nombre: string) => within(zona).getByLabelText(nombre) as HTMLInputElement;
  const urls = () => empujes.map((e) => e.url);

  it("marcar un color en el lado de hombre navega a ?genero=hombre&color=… (no sale al listado de mujer)", () => {
    const { container } = render(panel(f({ genero: "hombre" })));
    fireEvent.click(caja(aside(container), "Plateado (3)"));
    assert.deepEqual(empujes, [{ url: `${BASE}?genero=hombre&color=platead`, opciones: { scroll: false } }]);
  });

  it("desmarcar la última opción vuelve al listado completo de HOMBRE (?genero=hombre&todo=1: no al de mujer, y no al inicio de hombre)", () => {
    const { container } = render(panel(f({ genero: "hombre", colores: ["platead"] })));
    fireEvent.click(caja(aside(container), "Plateado (3)"));
    assert.deepEqual(urls(), [`${BASE}?genero=hombre&todo=1`]);
  });

  it("estar en el lado de hombre NO cuenta como filtro: sin nada más elegido no hay «Quitar filtros» ni contador de filtros", () => {
    const { container } = render(panel(f({ genero: "hombre" })));
    assert.equal(within(container).queryAllByText("Quitar filtros").length, 0);
    assert.equal(container.querySelector(".joy-filtro-contador"), null);
  });

  it("«Quitar filtros» quita lo elegido y se QUEDA en el lado de hombre; el contador cuenta lo elegido sin sumar el lado", () => {
    const { container } = render(panel(f({ genero: "hombre", colores: ["platead", "negr"] })));
    assert.match(container.querySelector(".joy-filtro-contador")?.textContent ?? "", /^2/);
    fireEvent.click(within(aside(container)).getByText("Quitar filtros"));
    assert.deepEqual(urls(), [`${BASE}?genero=hombre&todo=1`]);
  });

  it("en el lado de mujer todo es como siempre: «Quitar filtros» vuelve al listado completo (?todo=1)", () => {
    const { container } = render(panel(f({ colores: ["platead"] })));
    fireEvent.click(within(aside(container)).getByText("Quitar filtros"));
    assert.deepEqual(urls(), [`${BASE}?todo=1`]);
  });

  it("el formulario (sin JavaScript) lleva el lado oculto en el panel de escritorio y en el de la hoja del celular; el de mujer no lleva ninguno", () => {
    const hombre = render(panel(f({ genero: "hombre" })));
    const ocultos = [...hombre.container.querySelectorAll('input[type="hidden"][name="genero"]')] as HTMLInputElement[];
    assert.equal(ocultos.length, 2, "escritorio y hoja");
    for (const o of ocultos) assert.equal(o.value, "hombre");
    hombre.unmount();
    const mujer = render(panel(f()));
    assert.equal(mujer.container.querySelectorAll('input[name="genero"]').length, 0);
  });
});
