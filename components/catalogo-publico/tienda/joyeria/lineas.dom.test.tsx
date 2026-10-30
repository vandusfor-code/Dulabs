import "@/lib/test-helpers/jsdom-setup";
/**
 * Tema "joyeria": las LÍNEAS (Plata, Rodio, Acero, Cover Gold) en la cabecera y en el menú lateral (jsdom). El marco de la tienda le entrega a la cabecera las líneas ya armadas (de la configuración y
 * de las categorías de la tienda: ninguna lectura de productos); ella dibuja el acceso «Líneas» junto a «Catálogo» y, en el menú lateral, un acordeón «Líneas» con un sub-acordeón por línea: dentro de
 * cada una, «Toda la línea» y LAS MISMAS categorías de la tienda, con la dirección de esa línea y esa categoría. Sin líneas, la cabecera y el menú son EXACTAMENTE los de siempre.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { CromoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/CromoJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { hrefLineas, lineasVisibles } from "@/lib/catalogo/joyeria";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

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
  { id: "c1", name: "Anillos" },
  { id: "c2", name: "Aretes" },
  { id: "c3", name: "Cadenas" },
];
const CONFIG = storefrontConfigFor("delacour").joyeria!.lineas!;
const LINEAS = lineasVisibles(CONFIG, CATEGORIAS, BASE);
let n = 0;
const slugNuevo = () => `joy-lineas-${++n}`;

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
const cromo = (over: { lineas?: typeof LINEAS; paginas?: ReadonlyArray<{ texto: string; href: string }> } = {}) => (
  <CromoJoyeria
    marca={{ name: "Tienda de prueba", descriptor: "Joyería" }}
    basePath={BASE}
    listPath={LISTA}
    categorias={CATEGORIAS}
    categoriasHref={`${BASE}#categorias`}
    anuncios={[]}
    mayorista
    paginas={over.paginas}
    lineas={over.lineas ?? LINEAS}
    lineasHref={hrefLineas(BASE)}
  />
);
const enlacesDeLaCabecera = (c: HTMLElement) => [...c.querySelectorAll('nav[aria-label="Menú principal"] a')] as HTMLElement[];
const menuLateral = (c: HTMLElement) => c.querySelector("dialog.joy-menu") as HTMLElement;
const boton = (donde: HTMLElement, nombre: string) => within(donde).getByRole("button", { name: nombre, hidden: true });

describe("cabecera de la joyería — el acceso «Líneas»", () => {
  it("va entre «Catálogo» y «Categorías» y lleva a la franja de líneas del inicio", () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const enlaces = enlacesDeLaCabecera(container);
    assert.deepEqual(enlaces.map((a) => a.textContent), ["Inicio", "Catálogo", "Líneas", "Categorías", "Mayorista"]);
    assert.equal(enlaces.find((a) => a.textContent === "Líneas")!.getAttribute("href"), `${BASE}#lineas`);
  });

  it("con páginas propias en el menú, el orden es Inicio, Catálogo, Líneas, Categorías, páginas y Mayorista", () => {
    const { container } = render(conTienda(slugNuevo(), cromo({ paginas: [{ texto: "Nuestra Esencia", href: `${BASE}/p/nuestra-esencia` }] })));
    assert.deepEqual(enlacesDeLaCabecera(container).map((a) => a.textContent), ["Inicio", "Catálogo", "Líneas", "Categorías", "Nuestra Esencia", "Mayorista"]);
  });

  it("tiene la misma clase que los demás enlaces del menú (no la píldora de «Mayorista»)", () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const enlaces = enlacesDeLaCabecera(container);
    const lineas = enlaces.find((a) => a.textContent === "Líneas")!.className.split(" ");
    for (const clase of enlaces.find((a) => a.textContent === "Categorías")!.className.split(" ")) assert.ok(lineas.includes(clase), clase);
    assert.ok(!lineas.includes("joy-pildora-nav"));
  });

  it("un acceso de más pide el ancho amplio de la cabecera (desde xl; por debajo se usa el menú lateral), con o sin páginas", () => {
    const con = render(conTienda(slugNuevo(), cromo()));
    const nav = con.container.querySelector('nav[aria-label="Menú principal"]') as HTMLElement;
    assert.ok(nav.className.includes("xl:flex"), nav.className);
    assert.ok(!nav.className.includes("lg:flex"), nav.className);
    con.unmount();
    const sin = render(conTienda(slugNuevo(), cromo({ lineas: [] })));
    const navSin = sin.container.querySelector('nav[aria-label="Menú principal"]') as HTMLElement;
    assert.ok(navSin.className.includes("lg:flex"), "sin líneas ni páginas, la cabecera de siempre");
    assert.ok(!navSin.className.includes("xl:flex"), navSin.className);
  });

  it("sin líneas no hay acceso «Líneas» (la cabecera es la de siempre)", () => {
    const { container } = render(conTienda(slugNuevo(), cromo({ lineas: [] })));
    assert.deepEqual(enlacesDeLaCabecera(container).map((a) => a.textContent), ["Inicio", "Catálogo", "Categorías", "Mayorista"]);
  });
});

describe("menú lateral — el acordeón «Líneas»", () => {
  it("empieza cerrado, antes de «Categorías», y se abre con su botón (aria-expanded) mostrando las cuatro líneas en su orden", () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const menu = menuLateral(container);
    const lineas = boton(menu, "Líneas");
    assert.equal(lineas.getAttribute("aria-expanded"), "false");
    const panel = container.querySelector("#joy-menu-lineas") as HTMLElement;
    assert.equal(panel.getAttribute("data-abierto"), "false");
    assert.ok(panel.hasAttribute("inert"), "cerrado, no recibe el foco ni lo leen los lectores de pantalla");
    const filas = [...menu.querySelectorAll("button.joy-fila-menu")].map((b) => b.textContent?.trim());
    assert.ok(filas.indexOf("Líneas") < filas.indexOf("Categorías"), filas.join(","));

    fireEvent.click(lineas);
    assert.equal(lineas.getAttribute("aria-expanded"), "true");
    assert.equal(panel.getAttribute("data-abierto"), "true");
    assert.ok(!panel.hasAttribute("inert"));
    const nombres = [...panel.querySelectorAll(':scope > div > div > div > button')].map((b) => b.textContent?.trim());
    assert.deepEqual(nombres, ["Plata", "Rodio", "Acero", "Cover Gold"]);
  });

  it("cada línea trae «Toda la línea» y LAS MISMAS categorías de la tienda, con la dirección de esa línea y esa categoría", () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const menu = menuLateral(container);
    fireEvent.click(boton(menu, "Líneas"));
    const rodio = boton(menu, "Rodio");
    assert.equal(rodio.getAttribute("aria-expanded"), "false");
    fireEvent.click(rodio);
    assert.equal(rodio.getAttribute("aria-expanded"), "true");
    const sub = container.querySelector("#joy-menu-linea-rodio") as HTMLElement;
    const enlaces = [...sub.querySelectorAll("a")];
    assert.deepEqual(enlaces.map((a) => a.textContent), ["Toda la línea", "Anillos", "Aretes", "Cadenas"]);
    assert.deepEqual(
      enlaces.map((a) => a.getAttribute("href")),
      [`${BASE}?linea=rodio`, `${BASE}?linea=rodio&categoria=c1`, `${BASE}?linea=rodio&categoria=c2`, `${BASE}?linea=rodio&categoria=c3`],
    );
  });

  it("las cuatro líneas tienen las mismas categorías (Cover Gold incluida, tenga piezas o no)", () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    for (const l of LINEAS) {
      const sub = container.querySelector(`#joy-menu-linea-${l.clave}`) as HTMLElement;
      assert.deepEqual([...sub.querySelectorAll("a")].map((a) => a.textContent), ["Toda la línea", "Anillos", "Aretes", "Cadenas"], l.clave);
    }
  });

  it("solo una línea abierta a la vez: abrir otra cierra la anterior, y tocar la abierta la cierra", () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const menu = menuLateral(container);
    fireEvent.click(boton(menu, "Líneas"));
    fireEvent.click(boton(menu, "Plata"));
    assert.equal(boton(menu, "Plata").getAttribute("aria-expanded"), "true");
    fireEvent.click(boton(menu, "Acero"));
    assert.equal(boton(menu, "Plata").getAttribute("aria-expanded"), "false");
    assert.equal(boton(menu, "Acero").getAttribute("aria-expanded"), "true");
    assert.ok((container.querySelector("#joy-menu-linea-plata") as HTMLElement).hasAttribute("inert"));
    assert.ok(!(container.querySelector("#joy-menu-linea-acero") as HTMLElement).hasAttribute("inert"));
    fireEvent.click(boton(menu, "Acero"));
    assert.equal(boton(menu, "Acero").getAttribute("aria-expanded"), "false");
  });

  it("el acordeón de «Líneas» y el de «Categorías» son independientes", () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const menu = menuLateral(container);
    fireEvent.click(boton(menu, "Líneas"));
    assert.equal(boton(menu, "Categorías").getAttribute("aria-expanded"), "false");
    fireEvent.click(boton(menu, "Categorías"));
    assert.equal(boton(menu, "Líneas").getAttribute("aria-expanded"), "true");
    assert.equal(boton(menu, "Categorías").getAttribute("aria-expanded"), "true");
  });

  it("los ids del acordeón existen y cada botón apunta al suyo (accesibilidad)", () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    for (const b of container.querySelectorAll('dialog.joy-menu button[aria-controls]')) {
      assert.ok(container.querySelector(`#${b.getAttribute("aria-controls")}`), String(b.getAttribute("aria-controls")));
    }
  });

  it("sin líneas el menú lateral es el de siempre", () => {
    const { container } = render(conTienda(slugNuevo(), cromo({ lineas: [] })));
    const menu = menuLateral(container);
    assert.equal(within(menu).queryByRole("button", { name: "Líneas", hidden: true }), null);
    assert.equal(container.querySelector("#joy-menu-lineas"), null);
    assert.equal(boton(menu, "Categorías").getAttribute("aria-expanded"), "false");
  });
});
