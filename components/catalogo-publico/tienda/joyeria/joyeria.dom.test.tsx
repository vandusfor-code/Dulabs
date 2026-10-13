import "@/lib/test-helpers/jsdom-setup";
/**
 * Tema "joyeria": lo que hace el cliente (jsdom). El cromo de arriba (estado sobre la portada o vidrio, menú lateral con su acordeón, buscador, anuncios que rotan y se pausan), el botón
 * de vidrio de las tarjetas (con el motor único del carrito), la galería con su vista ampliada y el carrusel de categorías. Nada de esto toca precios, stock ni pedidos.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AgregarAlCarrito } from "@/components/catalogo-publico/tienda/AgregarAlCarrito";
import { CarruselCategorias } from "@/components/catalogo-publico/tienda/joyeria/CarruselCategorias";
import { CromoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/CromoJoyeria";
import { GaleriaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/GaleriaJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { getCartStore } from "@/lib/catalogo/carrito-store";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";

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
// jsdom tampoco trae matchMedia ni IntersectionObserver: se controlan desde la prueba.
let reducido = false;
(window as any).matchMedia = (consulta: string) => ({
  matches: /prefers-reduced-motion:\s*reduce/.test(consulta) ? reducido : false,
  media: consulta,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
(globalThis as any).IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const routerFalso = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const BASE = "/catalogo/prueba";
const LISTA = `${BASE}?todo=1`;
const CATEGORIAS = [
  { id: "c1", name: "Aretes" },
  { id: "c2", name: "Dijes" },
];
let n = 0;
const slugNuevo = () => `joy-dom-${++n}`;

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
const cromo = (anuncios = [{ texto: "Uno", href: "https://wa.me/573001112233" }, { texto: "Dos", href: null }] as Array<{ texto: string; href: string | null }>) => (
  <CromoJoyeria marca={{ name: "Tienda de prueba", descriptor: "Joyería" }} basePath={BASE} listPath={LISTA} categorias={CATEGORIAS} categoriasHref={`${BASE}#categorias`} anuncios={anuncios} mayorista />
);

const producto = (over: Partial<PublicCatalogProduct> = {}): PublicCatalogProduct => ({
  reference: "DL-000001",
  name: "Dije corazón",
  description: null,
  material: null,
  color: null,
  categoryName: "Dijes",
  price: 28_000,
  imageUrl: null,
  detailUrl: null,
  thumbUrl: null,
  available: true,
  availability: "available",
  maxQuantity: null,
  ...over,
});

beforeEach(() => {
  reducido = false;
  window.localStorage.clear();
  document.body.innerHTML = "";
});
afterEach(() => {
  cleanup();
  mock.timers.reset();
});

/** Coloca la «cortina» a `top` px del borde de la pantalla (jsdom no calcula posiciones). */
function ponerCortina(top: number) {
  document.querySelectorAll("[data-joy-cortina]").forEach((e) => e.remove());
  const cortina = document.createElement("div");
  cortina.setAttribute("data-joy-cortina", "");
  cortina.getBoundingClientRect = () => ({ top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON() {} }) as DOMRect;
  document.body.appendChild(cortina);
  return cortina;
}

describe("cromo joyería — estado sobre la portada o vidrio", () => {
  it("en el inicio, con la cortina todavía lejos, es «hero» (transparente); al llegar a la cabecera pasa a «vidrio» y vuelve al subir", async () => {
    ponerCortina(900);
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const raiz = () => container.querySelector(".joy-cromo") as HTMLElement;
    await waitFor(() => assert.equal(raiz().dataset.estado, "hero"));
    ponerCortina(0);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(raiz().dataset.estado, "vidrio"));
    ponerCortina(900);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(raiz().dataset.estado, "hero"));
  });

  it("sin cortina (una página sin portada) siempre es vidrio, y en el listado también aunque haya cortina", async () => {
    const a = render(conTienda(slugNuevo(), cromo()));
    await waitFor(() => assert.equal((a.container.querySelector(".joy-cromo") as HTMLElement).dataset.estado, "vidrio"));
    a.unmount();
    ponerCortina(900);
    const b = render(conTienda(slugNuevo(), cromo(), BASE, "todo=1"));
    await waitFor(() => assert.equal((b.container.querySelector(".joy-cromo") as HTMLElement).dataset.estado, "vidrio"));
  });

  it("la navegación lleva a los destinos de siempre y marca dónde está el cliente", () => {
    const { container, getByRole } = render(conTienda(slugNuevo(), cromo(), BASE, "todo=1"));
    const nav = container.querySelector('nav[aria-label="Menú principal"]') as HTMLElement;
    const enlaces = [...nav.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")]);
    assert.deepEqual(enlaces, [
      ["Inicio", BASE, null],
      ["Catálogo", LISTA, "page"],
      ["Categorías", `${BASE}#categorias`, null],
      ["Mayorista", `${BASE}#mayoristas`, null],
    ]);
    assert.ok(getByRole("link", { name: "Tienda de prueba, inicio" }));
  });
});

describe("cromo joyería — menú lateral", () => {
  it("el menú abre, trae los destinos y las categorías (enlaces de siempre) y WhatsApp, y se cierra al elegir uno", async () => {
    const { container, getByLabelText, getByText } = render(conTienda(slugNuevo(), cromo()));
    const menu = container.querySelector("dialog.joy-menu") as HTMLDialogElement;
    assert.equal(menu.hasAttribute("open"), false);
    fireEvent.click(getByLabelText("Abrir menú"));
    await waitFor(() => assert.equal(menu.hasAttribute("open"), true));
    const hrefs = [...menu.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const esperado of [BASE, LISTA, `${BASE}#mayoristas`, `${BASE}?categoria=c1`, `${BASE}?categoria=c2`, "https://wa.me/573001112233"]) assert.ok(hrefs.includes(esperado), esperado);
    document.addEventListener("click", (e) => e.preventDefault(), { capture: true, once: true }); // jsdom no navega: solo se comprueba que el menú se cierra
    fireEvent.click(getByText("Todo el catálogo"));
    await waitFor(() => assert.equal(menu.hasAttribute("open"), false));
  });

  it("las categorías están en un acordeón: cerrado no se puede enfocar; abierto, sí", async () => {
    const { container, getByLabelText, getByRole } = render(conTienda(slugNuevo(), cromo()));
    fireEvent.click(getByLabelText("Abrir menú"));
    const boton = getByRole("button", { name: "Categorías" });
    const panel = container.querySelector("#joy-menu-categorias") as HTMLElement;
    assert.equal(boton.getAttribute("aria-expanded"), "false");
    assert.equal(panel.dataset.abierto, "false");
    assert.equal(panel.hasAttribute("inert"), true);
    fireEvent.click(boton);
    assert.equal(boton.getAttribute("aria-expanded"), "true");
    assert.equal(panel.dataset.abierto, "true");
    assert.equal(panel.hasAttribute("inert"), false);
    fireEvent.click(boton);
    assert.equal(panel.dataset.abierto, "false");
  });

  it("el menú no ofrece WhatsApp si el negocio no tiene un número válido", () => {
    const { container } = render(
      <PathnameContext.Provider value={BASE}>
        <SearchParamsContext.Provider value={new URLSearchParams("") as never}>
          <TiendaProvider slug={slugNuevo()} context="retail" basePath={BASE} whatsapp={null}>
            {cromo([{ texto: "Solo texto", href: null }])}
          </TiendaProvider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>,
    );
    assert.equal([...container.querySelectorAll("dialog.joy-menu a")].some((a) => (a.getAttribute("href") ?? "").includes("wa.me")), false);
  });
});

describe("cromo joyería — buscador", () => {
  it("abre un diálogo con un formulario GET a «?q=» (la búsqueda real de siempre) y le da el foco al campo", async () => {
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const dlg = container.querySelector("dialog.joy-busqueda") as HTMLDialogElement;
    fireEvent.click(container.querySelector('button[aria-label="Buscar"]') as HTMLElement);
    await waitFor(() => assert.equal(dlg.hasAttribute("open"), true));
    const form = dlg.querySelector("form") as HTMLFormElement;
    assert.equal(form.getAttribute("action"), BASE);
    assert.equal(form.getAttribute("method"), "get");
    const campo = dlg.querySelector('input[name="q"]') as HTMLInputElement;
    assert.ok(campo);
    // Nunca assert.equal sobre nodos del DOM: si falla, el mensaje de diferencia recorre todo el árbol y agota la memoria.
    await waitFor(() => assert.ok(document.activeElement === campo, "el campo tiene el foco"));
  });

  it("con una búsqueda activa el campo trae el texto; cerrar con el botón cierra el diálogo", async () => {
    const { container, getByLabelText } = render(conTienda(slugNuevo(), cromo(), BASE, "q=cadena"));
    fireEvent.click(container.querySelector('button[aria-label="Buscar"]') as HTMLElement);
    const dlg = container.querySelector("dialog.joy-busqueda") as HTMLDialogElement;
    assert.equal((dlg.querySelector('input[name="q"]') as HTMLInputElement).value, "cadena");
    fireEvent.click(getByLabelText("Cerrar búsqueda"));
    await waitFor(() => assert.equal(dlg.hasAttribute("open"), false));
  });
});

describe("cromo joyería — carrito", () => {
  it("el contador sale del motor único del carrito y abre «Tu selección»", async () => {
    const slug = slugNuevo();
    const { getByLabelText, queryByText } = render(conTienda(slug, cromo()));
    assert.ok(getByLabelText("Ver tu selección"));
    assert.equal(queryByText("1"), null);
    act(() => getCartStore(slug, "retail").dispatch({ type: "add", product: { reference: "DL-000001", name: "Dije", price: 1000, imageUrl: null }, quantity: 2 }));
    await waitFor(() => assert.ok(getByLabelText("Ver tu selección (2 productos)")));
    assert.equal(getByLabelText("Ver tu selección (2 productos)").textContent, "2");
  });
});

describe("cromo joyería — anuncios", () => {
  const texto = (c: HTMLElement) => (c.querySelector(".joy-anuncio-texto") as HTMLElement).textContent;

  it("rotan solos cada 5 s con un fundido, y el primero lleva a WhatsApp en pestaña nueva", () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container } = render(conTienda(slugNuevo(), cromo()));
    assert.equal(texto(container), "Uno");
    const enlace = container.querySelector(".joy-anuncio-texto a") as HTMLAnchorElement;
    assert.equal(enlace.getAttribute("href"), "https://wa.me/573001112233");
    assert.equal(enlace.getAttribute("target"), "_blank");
    assert.equal(enlace.getAttribute("rel"), "noopener noreferrer");
    act(() => mock.timers.tick(4720)); // empieza el fundido de salida (0,28 s) a los 4,72 s…
    assert.ok(container.querySelector(".joy-anuncio-oculto"), "se funde antes de cambiar");
    act(() => mock.timers.tick(280)); // …y a los 5 s entra el siguiente
    assert.equal(texto(container), "Dos");
    assert.equal(container.querySelector(".joy-anuncio-oculto"), null);
    act(() => mock.timers.tick(4720));
    act(() => mock.timers.tick(280));
    assert.equal(texto(container), "Uno", "vuelve al primero");
  });

  it("se pausan al pasar el mouse y siguen al salir", () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container } = render(conTienda(slugNuevo(), cromo()));
    const region = container.querySelector(".joy-anuncios") as HTMLElement;
    fireEvent.mouseEnter(region);
    act(() => mock.timers.tick(20_000));
    assert.equal(texto(container), "Uno");
    fireEvent.mouseLeave(region);
    act(() => mock.timers.tick(4720));
    act(() => mock.timers.tick(280));
    assert.equal(texto(container), "Dos");
  });

  it("las flechas cambian el mensaje siempre; con «movimiento reducido» no hay rotación sola", () => {
    reducido = true;
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container, getByLabelText } = render(conTienda(slugNuevo(), cromo()));
    act(() => mock.timers.tick(30_000));
    assert.equal(texto(container), "Uno", "sin rotación automática");
    fireEvent.click(getByLabelText("Siguiente anuncio"));
    act(() => mock.timers.tick(0));
    assert.equal(texto(container), "Dos");
    fireEvent.click(getByLabelText("Anuncio anterior"));
    act(() => mock.timers.tick(0));
    assert.equal(texto(container), "Uno");
  });

  it("con un solo anuncio no hay flechas; sin anuncios no hay barra", () => {
    const uno = render(conTienda(slugNuevo(), cromo([{ texto: "Único", href: null }])));
    assert.equal(uno.queryByLabelText("Siguiente anuncio"), null);
    assert.equal(uno.container.querySelector(".joy-anuncios") !== null, true);
    uno.unmount();
    const ninguno = render(conTienda(slugNuevo(), cromo([])));
    assert.equal(ninguno.container.querySelector(".joy-anuncios"), null);
  });
});

describe("botón de vidrio «Agregar al carrito»", () => {
  it("agrega una unidad con el motor único del carrito y confirma «Agregado»", async () => {
    const slug = slugNuevo();
    const { getByRole } = render(conTienda(slug, <AgregarAlCarrito product={producto()} variante="cristal" />));
    const boton = getByRole("button", { name: "Agregar Dije corazón a tu selección" });
    assert.equal(boton.textContent?.includes("Agregar al carrito"), true);
    fireEvent.click(boton);
    const estado = getCartStore(slug, "retail").getSnapshot();
    assert.deepEqual(estado.lines.map((l) => [l.reference, l.quantity]), [["DL-000001", 1]]);
    await waitFor(() => assert.equal(boton.textContent?.includes("Agregado"), true));
  });

  it("con todas las unidades disponibles ya en la selección, el botón se desactiva y lo dice", async () => {
    const slug = slugNuevo();
    const { getByRole } = render(conTienda(slug, <AgregarAlCarrito product={producto({ maxQuantity: 1 })} variante="cristal" />));
    fireEvent.click(getByRole("button", { name: "Agregar Dije corazón a tu selección" }));
    const b = getByRole("button", { name: "Ya tienes todas las unidades disponibles de Dije corazón" }) as HTMLButtonElement;
    await waitFor(() => assert.equal(b.disabled, true), { timeout: 3000 });
    assert.equal(b.textContent?.includes("En tu selección"), true);
  });

  it("agotado: no hay botón, solo «Agotado»; y las otras variantes siguen igual que siempre", () => {
    const slug = slugNuevo();
    const agotado = render(conTienda(slug, <AgregarAlCarrito product={producto({ available: false, availability: "sold_out" })} variante="cristal" />));
    assert.equal(agotado.queryByRole("button"), null);
    assert.ok(agotado.getByText("Agotado"));
    agotado.unmount();
    const clasico = render(conTienda(slug, <AgregarAlCarrito product={producto()} />));
    assert.ok(clasico.container.querySelector("button.rounded-xl"), "el «+» cuadrado de siempre");
    assert.equal(clasico.container.querySelector(".joy-cristal"), null);
  });
});

describe("galería joyería", () => {
  const FOTOS = [1, 2, 3].map((i) => ({ imageUrl: `/f${i}-main.webp`, detailUrl: `/f${i}-detail.webp`, thumbUrl: `/f${i}-thumb.webp` }));

  it("tocar la foto abre la vista ampliada con contador, anterior/siguiente (desactivados en los extremos) y flechas del teclado", async () => {
    const { container, getByLabelText } = render(<GaleriaJoyeria images={FOTOS} name="Dije" reference="DL-000001" />);
    const dlg = container.querySelector("dialog.joy-lightbox") as HTMLDialogElement;
    assert.equal(dlg.hasAttribute("open"), false);
    fireEvent.click(getByLabelText("Ampliar foto 1 de 3: Dije"));
    await waitFor(() => assert.equal(dlg.hasAttribute("open"), true));
    assert.ok(dlg.textContent?.includes("1 / 3"));
    assert.equal((getByLabelText("Imagen anterior") as HTMLButtonElement).disabled, true);
    fireEvent.click(getByLabelText("Imagen siguiente"));
    assert.ok(dlg.textContent?.includes("2 / 3"));
    assert.equal(dlg.querySelector("img")?.getAttribute("src"), "/f2-detail.webp", "la vista ampliada usa la foto grande");
    fireEvent.keyDown(getByLabelText("Imagen siguiente"), { key: "ArrowRight" });
    assert.ok(dlg.textContent?.includes("3 / 3"));
    assert.equal((getByLabelText("Imagen siguiente") as HTMLButtonElement).disabled, true);
    fireEvent.keyDown(getByLabelText("Imagen anterior"), { key: "ArrowLeft" });
    assert.ok(dlg.textContent?.includes("2 / 3"));
    fireEvent.click(getByLabelText("Cerrar imagen ampliada"));
    await waitFor(() => assert.equal(dlg.hasAttribute("open"), false));
  });

  it("abre en la foto que se tocó, y con la vista ampliada cerrada no queda contenido montado", async () => {
    const { container, getByLabelText } = render(<GaleriaJoyeria images={FOTOS} name="Dije" />);
    const dlg = container.querySelector("dialog.joy-lightbox") as HTMLDialogElement;
    assert.equal(dlg.querySelector("img"), null);
    fireEvent.click(getByLabelText("Ampliar foto 3 de 3: Dije"));
    await waitFor(() => assert.ok(dlg.textContent?.includes("3 / 3")));
  });

  it("las miniaturas llevan a cada foto; con una sola foto no hay miniaturas ni contador; sin fotos, el recuadro con su texto", () => {
    const varias = render(<GaleriaJoyeria images={FOTOS} name="Dije" />);
    assert.equal(varias.container.querySelectorAll(".joy-miniatura").length, 3);
    assert.equal(varias.getByLabelText("Ver foto 1").getAttribute("aria-current"), "true");
    varias.unmount();
    const una = render(<GaleriaJoyeria images={FOTOS.slice(0, 1)} name="Dije" />);
    assert.equal(una.container.querySelectorAll(".joy-miniatura").length, 0);
    assert.equal(una.container.textContent?.includes("1 / 1"), false);
    una.unmount();
    const ninguna = render(<GaleriaJoyeria images={[]} name="Dije" />);
    assert.ok(ninguna.getByText("Producto sin fotografía"));
  });
});

describe("carrusel de categorías", () => {
  const CATS = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: `Categoría ${i}`, coverUrl: i === 0 ? "/c0.webp" : null }));

  it("los enlaces son los de siempre y las flechas desplazan un tramo (sin animación con «movimiento reducido»)", () => {
    const llamadas: Array<Record<string, unknown>> = [];
    (window as unknown as { HTMLElement: { prototype: { scrollBy?: unknown } } }).HTMLElement.prototype.scrollBy = function (opciones: Record<string, unknown>) {
      llamadas.push(opciones);
    };
    const { container } = render(<CarruselCategorias categorias={CATS} basePath={BASE} />);
    const riel = container.querySelector('[role="region"]') as HTMLElement;
    Object.defineProperty(riel, "clientWidth", { value: 1000, configurable: true });
    assert.deepEqual([...container.querySelectorAll("li a")].slice(0, 2).map((a) => a.getAttribute("href")), [`${BASE}?categoria=c0`, `${BASE}?categoria=c1`]);
    const [izquierda, derecha] = [...container.querySelectorAll("button")];
    fireEvent.click(derecha);
    fireEvent.click(izquierda);
    assert.deepEqual(llamadas, [{ left: 850, behavior: "smooth" }, { left: -850, behavior: "smooth" }]);
    reducido = true;
    fireEvent.click(derecha);
    assert.deepEqual(llamadas[2], { left: 850, behavior: "auto" });
  });

  it("con cuatro categorías o menos no hay flechas (todo cabe)", () => {
    const { container } = render(<CarruselCategorias categorias={CATS.slice(0, 4)} basePath={BASE} />);
    assert.equal(container.querySelectorAll("button").length, 0);
  });
});
