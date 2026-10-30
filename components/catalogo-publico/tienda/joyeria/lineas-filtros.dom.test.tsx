import "@/lib/test-helpers/jsdom-setup";
/**
 * El grupo «Línea» del panel de filtros: lo que hace el cliente (jsdom). Marcar una línea la escribe en la dirección (`?linea=plata`) sin saltar de lugar, se suma a las demás elecciones (categoría,
 * color, precio) y a otra línea, desmarcarla la quita, y «Quitar filtros» la limpia. La lista de productos la decide el servidor: aquí un enrutador falso solo anota a dónde se navega. Negocio FICTICIO.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { FiltrosJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FiltrosJoyeria";
import { SIN_FILTROS, type FacetasCatalogo, type FiltrosCatalogo } from "@/lib/catalogo/filtros";
import { calcularLineas } from "@/lib/catalogo/lineas";
import { lineasDeLaTienda } from "@/lib/catalogo/joyeria";

/* eslint-disable @typescript-eslint/no-explicit-any */
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
/* eslint-enable @typescript-eslint/no-explicit-any */

const BASE = "/catalogo/prueba";
const C1 = "c0000000-0000-4000-8000-0000000000a1";
const C2 = "c0000000-0000-4000-8000-0000000000a2";
const LINEAS = lineasDeLaTienda("delacour");
const FACETAS: FacetasCatalogo = {
  total: 6,
  categorias: [
    { id: C1, nombre: "Anillos", n: 4 },
    { id: C2, nombre: "Aretes", n: 2 },
  ],
  colores: [{ clave: "dorad", etiqueta: "Dorado", n: 5 }],
  materiales: [{ clave: "rodi", etiqueta: "Rodio", n: 4 }],
  precio: { min: 6_000, max: 112_000 },
  lineas: calcularLineas(
    [
      { categoryId: C1, material: "Rodio" },
      { categoryId: C1, material: "Rodio · 3cm" },
      { categoryId: C1, material: "Plata 925" },
      { categoryId: C2, material: "Rodio" },
      { categoryId: C2, material: "Rodio" },
      { categoryId: C1, material: "Plata" },
    ],
    LINEAS,
  ),
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
const panel = (filtros: FiltrosCatalogo = SIN_FILTROS) => (
  <AppRouterContext.Provider value={router}>
    <FiltrosJoyeria basePath={BASE} filtros={filtros} facetas={FACETAS} cuenta="6 productos">
      <p>lista</p>
    </FiltrosJoyeria>
  </AppRouterContext.Provider>
);
const columna = (container: HTMLElement) => container.querySelector("aside") as HTMLElement;
const caja = (zona: HTMLElement, nombre: string) => within(zona).getByLabelText(nombre) as HTMLInputElement;
/** Una casilla DEL GRUPO «Línea»: «Rodio (4)» también existe como material, y la búsqueda no debe confundirlas. */
const casillaLinea = (zona: HTMLElement, nombre: string) => {
  const grupo = [...zona.querySelectorAll("fieldset")].find((g) => g.querySelector("legend")?.textContent === "Línea") as HTMLElement;
  assert.ok(grupo, "falta el grupo «Línea»");
  return within(grupo).getByLabelText(nombre) as HTMLInputElement;
};

beforeEach(() => {
  empujes.length = 0;
  document.body.innerHTML = "";
});
afterEach(async () => {
  await act(async () => {});
  cleanup();
});

describe("filtro por línea — casillas", () => {
  it("las cuatro líneas están; las que tienen piezas dicen cuántas, y las que no, solo su nombre", () => {
    const { container } = render(panel());
    const aside = columna(container);
    assert.equal(casillaLinea(aside, "Plata (2)").value, "plata");
    assert.equal(casillaLinea(aside, "Rodio (4)").value, "rodio");
    assert.equal(casillaLinea(aside, "Acero").value, "acero");
    assert.equal(casillaLinea(aside, "Cover Gold").value, "cover-gold");
  });

  it("marcar una línea navega a la dirección con ella, sin volver arriba (scroll: false)", () => {
    const { container } = render(panel());
    fireEvent.click(casillaLinea(columna(container), "Plata (2)"));
    assert.deepEqual(empujes, [{ url: `${BASE}?linea=plata`, opciones: { scroll: false } }]);
  });

  it("marcar una línea SIN piezas también navega (la página de esa línea existe)", () => {
    const { container } = render(panel());
    fireEvent.click(casillaLinea(columna(container), "Cover Gold"));
    assert.deepEqual(urls(), [`${BASE}?linea=cover-gold`]);
  });

  it("la línea elegida viene marcada y las demás no", () => {
    const { container } = render(panel(f({ lineas: ["rodio"] })));
    const aside = columna(container);
    assert.equal(casillaLinea(aside, "Rodio (4)").checked, true);
    for (const otra of ["Plata (2)", "Acero", "Cover Gold"]) assert.equal(casillaLinea(aside, otra).checked, false, otra);
  });

  it("con una línea elegida, marcar una categoría suma las dos (la línea va primero en la dirección)", () => {
    const { container } = render(panel(f({ lineas: ["plata"] })));
    fireEvent.click(caja(columna(container), "Anillos (4)"));
    assert.deepEqual(urls(), [`${BASE}?linea=plata&categoria=${C1}`]);
  });

  it("dos líneas se suman (basta con una de ellas)", () => {
    const { container } = render(panel(f({ lineas: ["plata"] })));
    fireEvent.click(casillaLinea(columna(container), "Rodio (4)"));
    assert.deepEqual(urls(), [`${BASE}?linea=plata&linea=rodio`]);
  });

  it("desmarcar la única línea quita el filtro: vuelve al listado completo", () => {
    const { container } = render(panel(f({ lineas: ["plata"] })));
    fireEvent.click(casillaLinea(columna(container), "Plata (2)"));
    assert.deepEqual(urls(), [`${BASE}?todo=1`]);
  });

  it("desmarcar una de dos líneas deja la otra, y no toca los demás filtros", () => {
    const { container } = render(panel(f({ lineas: ["plata", "rodio"], colores: ["dorad"], precioMax: 30_000 })));
    fireEvent.click(casillaLinea(columna(container), "Plata (2)"));
    assert.deepEqual(urls(), [`${BASE}?linea=rodio&color=dorad&precio_max=30000`]);
  });

  it("«Quitar filtros» limpia también la línea", () => {
    const { container } = render(panel(f({ lineas: ["plata"], categorias: [C1] })));
    fireEvent.click(within(columna(container)).getByText("Quitar filtros"));
    assert.deepEqual(urls(), [`${BASE}?todo=1`]);
  });

  it("la línea cuenta como un filtro activo en el botón «Filtrar» del celular", () => {
    const { container } = render(panel(f({ lineas: ["plata"], colores: ["dorad"] })));
    const boton = within(container).getAllByRole("button", { name: /Filtrar/, hidden: true })[0];
    assert.ok(/2/.test(boton.textContent ?? ""), boton.textContent ?? "");
  });
});
