import "@/lib/test-helpers/jsdom-setup";
/**
 * La tienda con ofertas, como la ve el cliente: la ficha del producto y la hoja «Tu selección» (el carrito). El precio que se muestra es el efectivo (el que se cobra); el de lista
 * solo aparece tachado cuando hay una oferta vigente, y cuando la oferta se pausa o vence el cliente VE el cambio. Sin ofertas, nada de esto existe en la pantalla.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { FichaProducto } from "@/components/catalogo-publico/tienda/FichaProducto";
import { HojaCarrito } from "@/components/catalogo-publico/tienda/HojaCarrito";
import { TiendaProvider, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";
import { formatCop } from "@/lib/business-agent-quote";
import type { CartProduct } from "@/lib/catalogo/carrito";
import { getCartStore } from "@/lib/catalogo/carrito-store";
import type { PublicOffer, PublicProductDetail } from "@/lib/catalogo/publicacion";

/* eslint-disable @typescript-eslint/no-explicit-any */
// jsdom no trae <dialog>.showModal(): se imita lo mínimo (abre/cierra y avisa), que es lo que la tienda necesita.
const dialogo = (window as any).HTMLDialogElement.prototype;
if (typeof dialogo.showModal !== "function") {
  dialogo.showModal = function showModal(this: HTMLElement) {
    this.setAttribute("open", "");
  };
  dialogo.close = function close(this: HTMLElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new (window as any).Event("close"));
  };
}
const routerFalso = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
/* eslint-enable @typescript-eslint/no-explicit-any */

const cop = (n: number) => formatCop(n);
const OFERTA: PublicOffer = { name: "Amor y Amistad", benefit: "20% de descuento", label: "-20%", until: "hasta el 31 de octubre de 2026", conditions: "Hasta agotar existencias." };

const detalle = (over: Partial<PublicProductDetail> = {}): PublicProductDetail => ({
  reference: "DL-000184",
  name: "Dije corazón",
  description: "Un dije delicado.",
  material: "Oro laminado",
  color: "Dorado",
  categoryName: "Dijes",
  price: 28_000,
  listPrice: 35_000,
  offer: OFERTA,
  imageUrl: null,
  detailUrl: null,
  thumbUrl: null,
  available: true,
  availability: "available",
  maxQuantity: null,
  categoryId: null,
  gallery: [],
  ...over,
});
/** El mismo producto sin oferta (la proyección no trae ni las propiedades). */
const sinOferta = (): PublicProductDetail => {
  const { listPrice: _lista, offer: _oferta, ...resto } = detalle({ price: 35_000 });
  void _lista;
  void _oferta;
  return resto;
};

const DIJE_OFERTA: CartProduct = { reference: "DL-000184", name: "Dije corazón", price: 28_000, listPrice: 35_000, offerLabel: "-20%", imageUrl: null };
const DIJE_LISTA: CartProduct = { reference: "DL-000184", name: "Dije corazón", price: 35_000, imageUrl: null };
const ARETES: CartProduct = { reference: "DL-000185", name: "Aretes brillo", price: 42_000, imageUrl: null };

let contador = 0;
const nuevoSlug = () => `oferta-ui-${++contador}`;
const REAL_FETCH = globalThis.fetch;
let consultas: string[];

/** El servidor responde a la consulta de «Tu selección» con lo que se le diga (la verdad vigente de esas referencias). */
function responder(items: CartProduct[], quote: string | null = "cotizacion-1") {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    consultas.push(String(input));
    return { ok: true, json: async () => ({ items, unknown: [], quote }) } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  consultas = [];
});
afterEach(() => {
  cleanup();
  globalThis.fetch = REAL_FETCH;
});

function Abrir() {
  const { abrirCarrito } = useTienda();
  return (
    <button type="button" onClick={abrirCarrito}>
      abrir-carrito
    </button>
  );
}
function Montaje({ slug, children }: { slug: string; children?: ReactNode }) {
  return (
    <AppRouterContext.Provider value={routerFalso}>
      <TiendaProvider slug={slug} context="retail" basePath={`/catalogo/${slug}`} whatsapp="573001112233">
        <Abrir />
        {children}
        <HojaCarrito />
      </TiendaProvider>
    </AppRouterContext.Provider>
  );
}
const hoja = () => document.querySelector("dialog") as HTMLDialogElement;
const textoHoja = () => hoja().textContent ?? "";

describe("la ficha del producto con oferta", () => {
  const ficha = (p: PublicProductDetail) =>
    renderToStaticMarkup(
      <AppRouterContext.Provider value={routerFalso}>
        <TiendaProvider slug="ficha" context="retail" basePath="/catalogo/ficha" whatsapp="573001112233">
          <FichaProducto producto={p} categorias={[]} basePath="/catalogo/ficha" listPath="/catalogo/ficha?todo=1" />
        </TiendaProvider>
      </AppRouterContext.Provider>,
    );

  it("muestra el precio efectivo, el de lista tachado (con su texto para lectores de pantalla), la etiqueta y el recuadro con el nombre, el beneficio, la vigencia y las condiciones", () => {
    const html = ficha(detalle());
    for (const t of [cop(28_000), "<s>" + cop(35_000) + "</s>", "Precio normal: ", "-20%", "Amor y Amistad · 20% de descuento", "Vigente hasta el 31 de octubre de 2026", "Hasta agotar existencias."]) assert.ok(html.includes(t), t);
    assert.ok(html.indexOf(cop(28_000)) < html.indexOf("<s>" + cop(35_000)), "primero el precio que se paga y después el tachado");
  });

  it("el botón de agregar ofrece el precio efectivo (nunca el de lista)", () => {
    const html = ficha(detalle());
    assert.ok(html.includes(`Agregar · ${cop(28_000)}`));
    assert.ok(!html.includes(`Agregar · ${cop(35_000)}`));
  });

  it("sin oferta la ficha no tiene tachado, etiqueta ni recuadro: queda exactamente como siempre", () => {
    const html = ficha(sinOferta());
    assert.ok(html.includes(cop(35_000)));
    for (const t of ["<s>", "Precio normal: ", "Amor y Amistad", "Vigente "]) assert.ok(!html.includes(t), t);
  });

  it("una oferta sin vigencia ni condiciones no deja líneas vacías, y el texto de la administradora se escapa", () => {
    const html = ficha(detalle({ offer: { ...OFERTA, name: "<img src=x onerror=alert(1)>", until: null, conditions: null } }));
    assert.ok(!html.includes("<img src=x") && html.includes("&lt;img src=x onerror=alert(1)&gt; · 20% de descuento"));
    assert.ok(!html.includes("Vigente "));
  });

  it("agregar desde la ficha guarda en el carrito el precio efectivo, el de lista y la etiqueta (la hoja los mostrará)", () => {
    const slug = nuevoSlug();
    const { getByText } = render(
      <AppRouterContext.Provider value={routerFalso}>
        <TiendaProvider slug={slug} context="retail" basePath={`/catalogo/${slug}`} whatsapp="573001112233">
          <FichaProducto producto={detalle()} categorias={[]} basePath={`/catalogo/${slug}`} listPath={`/catalogo/${slug}?todo=1`} />
        </TiendaProvider>
      </AppRouterContext.Provider>,
    );
    fireEvent.click(getByText(`Agregar · ${cop(28_000)}`));
    const [linea] = getCartStore(slug, "retail").getSnapshot().lines;
    assert.deepEqual([linea.reference, linea.unitPrice, linea.listPrice, linea.offerLabel, linea.quantity], ["DL-000184", 28_000, 35_000, "-20%", 1]);
  });
});

describe("la hoja «Tu selección» con ofertas", () => {
  it("muestra el precio efectivo, el de lista tachado con la etiqueta, cuánto se ahorra y el total efectivo", async () => {
    const slug = nuevoSlug();
    getCartStore(slug, "retail").dispatch({ type: "add", product: DIJE_OFERTA, quantity: 2 });
    responder([DIJE_OFERTA]);
    const { getByText } = render(<Montaje slug={slug} />);
    fireEvent.click(getByText("abrir-carrito"));
    await waitFor(() => assert.ok(textoHoja().includes("Ahorras con ofertas")));
    const texto = textoHoja();
    assert.ok(texto.includes(`-20% · antes ${cop(35_000)} c/u`), "etiqueta y precio de lista por unidad");
    assert.ok(texto.includes(cop(14_000)), "ahorro = 2 unidades × 7.000");
    assert.ok(texto.includes(cop(56_000)), "total = 2 × 28.000 (lo que se cobra)");
    assert.equal(hoja().querySelectorAll("s").length, 1);
    assert.equal(consultas.length, 1, "una sola consulta al servidor por apertura");
    assert.ok(consultas[0].startsWith(`/catalogo/${slug}/seleccion?`));
  });

  it("sin ofertas no hay línea de «antes» ni «Ahorras con ofertas»: la hoja queda como siempre", async () => {
    const slug = nuevoSlug();
    getCartStore(slug, "retail").dispatch({ type: "add", product: ARETES, quantity: 2 });
    responder([ARETES]);
    const { getByText } = render(<Montaje slug={slug} />);
    fireEvent.click(getByText("abrir-carrito"));
    await waitFor(() => assert.ok(textoHoja().includes(cop(84_000))));
    assert.ok(!textoHoja().includes("Ahorras con ofertas") && !textoHoja().includes("antes"));
    assert.equal(hoja().querySelectorAll("s").length, 0);
  });

  it("si la administradora pausó la oferta mientras el producto estaba en el carrito, al abrir la hoja el cliente VE el aviso del cambio, el precio de lista y el ahorro desaparece", async () => {
    const slug = nuevoSlug();
    getCartStore(slug, "retail").dispatch({ type: "add", product: DIJE_OFERTA, quantity: 2 });
    responder([DIJE_LISTA]);
    const { getByText } = render(<Montaje slug={slug} />);
    fireEvent.click(getByText("abrir-carrito"));
    await waitFor(() => assert.ok(textoHoja().includes(`El precio de «Dije corazón» cambió: ahora ${cop(35_000)}.`)));
    assert.ok(!textoHoja().includes("Ahorras con ofertas"));
    assert.equal(hoja().querySelectorAll("s").length, 0);
    assert.ok(textoHoja().includes(cop(70_000)), "el total ya es el de lista: 2 × 35.000");
    const [linea] = getCartStore(slug, "retail").getSnapshot().lines;
    assert.ok(!("listPrice" in linea) && !("offerLabel" in linea), "el carrito guardado ya no recuerda la oferta");
  });

  it("si aparece una oferta mientras el producto estaba en el carrito a precio de lista, también se avisa y el ahorro aparece", async () => {
    const slug = nuevoSlug();
    getCartStore(slug, "retail").dispatch({ type: "add", product: DIJE_LISTA, quantity: 1 });
    responder([DIJE_OFERTA]);
    const { getByText } = render(<Montaje slug={slug} />);
    fireEvent.click(getByText("abrir-carrito"));
    await waitFor(() => assert.ok(textoHoja().includes(`El precio de «Dije corazón» cambió: ahora ${cop(28_000)}.`)));
    assert.ok(textoHoja().includes("Ahorras con ofertas") && textoHoja().includes(cop(7_000)));
  });

  it("un producto agotado con oferta no cuenta para el ahorro ni para el total (no entra al pedido)", async () => {
    const slug = nuevoSlug();
    const store = getCartStore(slug, "retail");
    store.dispatch({ type: "add", product: DIJE_OFERTA, quantity: 2 });
    store.dispatch({ type: "add", product: ARETES, quantity: 1 });
    responder([{ ...DIJE_OFERTA, available: false, maxQuantity: 0 }, ARETES]);
    const { getByText } = render(<Montaje slug={slug} />);
    fireEvent.click(getByText("abrir-carrito"));
    await waitFor(() => assert.ok(textoHoja().includes("se agotó")));
    assert.ok(!textoHoja().includes("Ahorras con ofertas"));
  });
});
