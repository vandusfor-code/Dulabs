import "@/lib/test-helpers/jsdom-setup";
/**
 * Filtros del listado del tema "joyeria": lo que hace el cliente (jsdom). Marcar una casilla escribe el filtro en la dirección (sin saltar de lugar), varias opciones del mismo grupo se suman,
 * el rango de precio espera un momento tras el último movimiento y nunca deja el mínimo por encima del máximo, «Quitar filtros» vuelve al listado completo, la hoja del celular abre y cierra, y
 * las casillas siguen a la dirección (atrás/adelante). La lista de productos la decide el servidor: aquí un enrutador falso solo anota a dónde se navega. Negocio FICTICIO.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { FiltrosJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FiltrosJoyeria";
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
// matchMedia controlable: la prueba decide si la pantalla es de escritorio (≥ 1024 px) y avisa del cambio.
let escritorio = false;
const oyentes = new Set<() => void>();
(window as any).matchMedia = (consulta: string) => ({
  get matches() {
    return /min-width:\s*1024px/.test(consulta) ? escritorio : false;
  },
  media: consulta,
  addEventListener: (_: string, f: () => void) => oyentes.add(f),
  removeEventListener: (_: string, f: () => void) => oyentes.delete(f),
  addListener() {},
  removeListener() {},
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const BASE = "/catalogo/prueba";
const C1 = "c0000000-0000-4000-8000-0000000000a1";
const C2 = "c0000000-0000-4000-8000-0000000000a2";
const FACETAS: FacetasCatalogo = {
  total: 130,
  categorias: [
    { id: C2, nombre: "Dije", n: 82 },
    { id: C1, nombre: "Aretes", n: 48 },
  ],
  colores: [
    { clave: "dorad", etiqueta: "Dorado", n: 85 },
    { clave: "platead", etiqueta: "Plateado", n: 10 },
  ],
  materiales: [{ clave: "rodi", etiqueta: "Rodio", n: 112 }],
  precio: { min: 6_000, max: 112_000 },
};
const f = (over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({ ...SIN_FILTROS, ...over });

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
const urls = () => empujes.map((e) => e.url);

const panel = (filtros: FiltrosCatalogo = SIN_FILTROS, facetas: FacetasCatalogo = FACETAS) => (
  <AppRouterContext.Provider value={router}>
    <FiltrosJoyeria basePath={BASE} filtros={filtros} facetas={facetas} cuenta="130 productos">
      <p>lista</p>
    </FiltrosJoyeria>
  </AppRouterContext.Provider>
);
/** La columna de escritorio y la hoja del celular (el mismo panel dos veces). */
const partes = (container: HTMLElement) => ({ aside: container.querySelector("aside") as HTMLElement, hoja: container.querySelector("dialog") as HTMLElement });
const caja = (zona: HTMLElement, nombre: string) => within(zona).getByLabelText(nombre) as HTMLInputElement;
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  empujes.length = 0;
  escritorio = false;
  oyentes.clear();
  document.body.innerHTML = "";
});
afterEach(async () => {
  await act(async () => {}); // termina lo que haya quedado pendiente (transiciones, efectos) antes de desmontar
  cleanup();
});

describe("filtros joyería — casillas", () => {
  it("marcar una casilla navega a la dirección con ese filtro, sin volver arriba (scroll: false)", () => {
    const { container } = render(panel());
    fireEvent.click(caja(partes(container).aside, "Dorado (85)"));
    assert.deepEqual(empujes, [{ url: `${BASE}?color=dorad`, opciones: { scroll: false } }]);
  });

  it("cada grupo escribe su parámetro: categoría por id, color y material por clave", () => {
    const { container, rerender } = render(panel());
    const { aside } = partes(container);
    fireEvent.click(caja(aside, "Aretes (48)"));
    assert.equal(urls().at(-1), `${BASE}?categoria=${C1}`);
    rerender(panel(f({ categorias: [C1] })));
    fireEvent.click(caja(aside, "Rodio (112)"));
    assert.equal(urls().at(-1), `${BASE}?categoria=${C1}&material=rodi`);
  });

  it("varias opciones del mismo grupo se suman, y desmarcar una la quita", () => {
    const { container, rerender } = render(panel(f({ categorias: [C1] })));
    const { aside } = partes(container);
    fireEvent.click(caja(aside, "Dije (82)"));
    assert.equal(urls().at(-1), `${BASE}?categoria=${C1}&categoria=${C2}`);
    rerender(panel(f({ categorias: [C1, C2] })));
    fireEvent.click(caja(aside, "Aretes (48)"));
    assert.equal(urls().at(-1), `${BASE}?categoria=${C2}`);
  });

  it("desmarcar la última opción vuelve al listado completo (?todo=1), y no navega si no cambió nada", () => {
    const { container } = render(panel(f({ colores: ["dorad"] })));
    fireEvent.click(caja(partes(container).aside, "Dorado (85)"));
    assert.deepEqual(urls(), [`${BASE}?todo=1`]);
  });

  it("la dirección manda: al llegar otra (atrás/adelante o «Quitar filtros») las casillas y el contador la siguen", () => {
    const { container, rerender } = render(panel(f({ colores: ["dorad"] })));
    const { aside } = partes(container);
    assert.equal(caja(aside, "Dorado (85)").checked, true);
    assert.equal(caja(aside, "Plateado (10)").checked, false);
    rerender(panel(f({ colores: ["platead"], materiales: ["rodi"] })));
    assert.equal(caja(aside, "Dorado (85)").checked, false);
    assert.equal(caja(aside, "Plateado (10)").checked, true);
    assert.equal(caja(aside, "Rodio (112)").checked, true);
    assert.match(container.querySelector(".joy-filtro-contador")?.textContent ?? "", /^2/);
  });

  it("la hoja del celular tiene su propio panel que hace lo mismo (casillas con id distinto, misma navegación)", () => {
    const { container } = render(panel());
    const { aside, hoja } = partes(container);
    const idsAside = [...aside.querySelectorAll("input[id]")].map((i) => i.id);
    const idsHoja = [...hoja.querySelectorAll("input[id]")].map((i) => i.id);
    assert.equal(idsAside.length, 2 + 2 + 1 + 2, "2 categorías, 2 colores, 1 material y los dos deslizadores");
    assert.ok(idsAside.every((i) => !idsHoja.includes(i)));
    fireEvent.click(caja(hoja, "Plateado (10)"));
    assert.equal(urls().at(-1), `${BASE}?color=platead`);
  });
});

describe("filtros joyería — rango de precio", () => {
  const minimo = (zona: HTMLElement) => within(zona).getByLabelText("Precio mínimo") as HTMLInputElement;
  const maximo = (zona: HTMLElement) => within(zona).getByLabelText("Precio máximo") as HTMLInputElement;
  const rango = (zona: HTMLElement) => zona.querySelector(".joy-rango-texto")?.textContent;

  it("el texto sigue a la perilla al instante y la lista se pide un momento después del último movimiento (no a cada fotograma)", async () => {
    const { container } = render(panel());
    const { aside } = partes(container);
    assert.equal(rango(aside), "$ 6.000 — $ 112.000");
    fireEvent.change(minimo(aside), { target: { value: "20000" } });
    assert.equal(rango(aside), "$ 20.000 — $ 112.000");
    fireEvent.change(minimo(aside), { target: { value: "21000" } });
    assert.equal(rango(aside), "$ 21.000 — $ 112.000");
    assert.deepEqual(urls(), [], "todavía no navega");
    await waitFor(() => assert.deepEqual(urls(), [`${BASE}?precio_min=21000`]), { timeout: 2000 });
    await act(async () => {}); // termina la transición y sus efectos antes de seguir
    assert.deepEqual(empujes[0].opciones, { scroll: false });
  });

  it("el máximo se suma al mínimo ya elegido, y solo se escribe el extremo que no está en su límite", async () => {
    const { container } = render(panel(f({ precioMin: 20_000 })));
    const { aside } = partes(container);
    assert.equal(rango(aside), "$ 20.000 — $ 112.000");
    fireEvent.change(maximo(aside), { target: { value: "50000" } });
    await waitFor(() => assert.deepEqual(urls(), [`${BASE}?precio_min=20000&precio_max=50000`]), { timeout: 2000 });
    await act(async () => {}); // termina la transición y sus efectos antes de seguir
  });

  it("llevar la perilla de vuelta a su límite quita ese extremo de la dirección; y si no cambió nada, no navega", async () => {
    const { container } = render(panel(f({ precioMin: 20_000 })));
    const { aside } = partes(container);
    fireEvent.change(minimo(aside), { target: { value: "6000" } });
    await act(async () => {
      await pausa(600);
    });
    assert.deepEqual(urls(), [`${BASE}?todo=1`]);
    empujes.length = 0;
    cleanup();
    const otro = render(panel());
    fireEvent.change(minimo(partes(otro.container).aside), { target: { value: "6000" } });
    await act(async () => {
      await pausa(600);
    });
    assert.deepEqual(urls(), [], "mismo rango que la dirección: nada que cargar");
  });

  it("el mínimo nunca pasa del máximo ni el máximo baja del mínimo", () => {
    const { container } = render(panel(f({ precioMax: 50_000 })));
    const { aside } = partes(container);
    fireEvent.change(minimo(aside), { target: { value: "60000" } });
    assert.equal(rango(aside), "$ 50.000 — $ 50.000");
    fireEvent.change(maximo(aside), { target: { value: "7000" } });
    assert.equal(rango(aside), "$ 50.000 — $ 50.000");
    assert.equal(minimo(aside).value, "50000");
    assert.equal(maximo(aside).value, "50000");
  });

  it("cada deslizador se lee en pesos para quien usa lector de pantalla, y con las perillas arriba la del mínimo queda encima (si no, no habría cómo bajar el rango)", () => {
    const { container } = render(panel(f({ precioMin: 100_000 })));
    const { aside } = partes(container);
    assert.equal(minimo(aside).getAttribute("aria-valuetext"), "$ 100.000");
    assert.equal(maximo(aside).getAttribute("aria-valuetext"), "$ 112.000");
    assert.ok(minimo(aside).hasAttribute("data-encima"));
    cleanup();
    const abajo = render(panel(f({ precioMax: 20_000 })));
    assert.ok(!minimo(partes(abajo.container).aside).hasAttribute("data-encima"));
  });

  it("al llegar un rango nuevo desde la dirección (atrás/adelante), el deslizador lo sigue", () => {
    const { container, rerender } = render(panel(f({ precioMin: 20_000, precioMax: 50_000 })));
    const { aside } = partes(container);
    assert.equal(rango(aside), "$ 20.000 — $ 50.000");
    rerender(panel(SIN_FILTROS));
    assert.equal(rango(aside), "$ 6.000 — $ 112.000");
  });
});

describe("filtros joyería — quitar filtros y hoja del celular", () => {
  it("«Quitar filtros» vuelve al listado completo; con Ctrl (abrir en otra pestaña) no se intercepta", () => {
    const { container } = render(panel(f({ colores: ["dorad"], precioMax: 50_000 })));
    const { aside } = partes(container);
    const enlace = within(aside).getByRole("link", { name: "Quitar filtros" });
    assert.equal(enlace.getAttribute("href"), `${BASE}?todo=1`);
    enlace.addEventListener("click", (e) => e.preventDefault()); // jsdom no navega; solo interesa si la tienda lo interceptó
    fireEvent.click(enlace, { ctrlKey: true });
    assert.deepEqual(urls(), [], "con Ctrl lo maneja el navegador");
    fireEvent.click(enlace);
    assert.deepEqual(urls(), [`${BASE}?todo=1`]);
  });

  it("sin filtros no hay «Quitar filtros» ni contador", () => {
    const { container, queryByRole } = render(panel());
    assert.equal(queryByRole("link", { name: "Quitar filtros" }), null);
    assert.equal(container.querySelector(".joy-filtro-contador"), null);
  });

  it("«Filtrar» abre la hoja (diálogo modal) y «Cerrar filtros» la cierra; el botón dice cuántos filtros hay activos", () => {
    const { container, getByRole } = render(panel(f({ colores: ["dorad"], materiales: ["rodi"] })));
    const { hoja } = partes(container);
    assert.equal(hoja.hasAttribute("open"), false);
    const abrir = getByRole("button", { name: /Filtrar/ });
    assert.match(abrir.textContent ?? "", /2\s*filtros activos/);
    fireEvent.click(abrir);
    assert.equal(hoja.hasAttribute("open"), true);
    fireEvent.click(within(hoja).getByRole("button", { name: "Cerrar filtros" }));
    assert.equal(hoja.hasAttribute("open"), false);
  });

  it("el pie de la hoja: la leyenda dice cuántos productos hay con lo elegido y el botón «Filtrar» cierra la hoja (los filtros ya estaban aplicados)", () => {
    const { container, getByRole } = render(panel());
    const { hoja } = partes(container);
    fireEvent.click(getByRole("button", { name: /^Filtrar/ }));
    assert.equal(hoja.hasAttribute("open"), true);
    const pie = hoja.querySelector(".joy-hoja-pie") as HTMLElement;
    assert.equal(pie.querySelector("p")?.textContent, "130 productos con los filtros actuales");
    fireEvent.click(within(pie).getByRole("button", { name: "Filtrar" }));
    assert.equal(hoja.hasAttribute("open"), false);
    assert.deepEqual(urls(), [], "cerrar la hoja no navega: los filtros se aplican al elegirlos");
  });

  it("la hoja sigue abierta mientras se eligen filtros (se aplican al instante) y se cierra sola si la pantalla pasa a escritorio", async () => {
    const { container, getByRole } = render(panel());
    const { hoja } = partes(container);
    fireEvent.click(getByRole("button", { name: /Filtrar/ }));
    fireEvent.click(caja(hoja, "Dorado (85)"));
    assert.deepEqual(urls(), [`${BASE}?color=dorad`]);
    assert.equal(hoja.hasAttribute("open"), true);
    escritorio = true;
    oyentes.forEach((cb) => cb());
    await waitFor(() => assert.equal(hoja.hasAttribute("open"), false));
  });

  it("la lista y el conteo están dentro del contenedor que se atenúa; el conteo se anuncia como estado", () => {
    const { container, getByRole } = render(panel());
    assert.equal(getByRole("status").textContent, "130 productos");
    const lista = container.querySelector(".joy-resultados") as HTMLElement;
    assert.equal(lista.textContent, "lista");
    assert.equal(lista.hasAttribute("data-pendiente"), false);
  });
});
