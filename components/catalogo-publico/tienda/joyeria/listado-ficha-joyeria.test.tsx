/**
 * Listado y ficha del tema "joyeria": SOLO cambian de dibujo. Se prueba contra los componentes de siempre: el listado ofrece EXACTAMENTE las mismas direcciones (búsqueda, categorías,
 * página, «quitar filtros») que PublicCatalog, y la ficha muestra los mismos datos y las mismas acciones que FichaProducto. Así queda demostrado que filtros, búsqueda y acciones no cambiaron.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicCatalog } from "@/components/catalogo-publico/PublicCatalog";
import { FichaProducto } from "@/components/catalogo-publico/tienda/FichaProducto";
import { BASE, LISTA, producto } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { FichaProductoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FichaProductoJoyeria";
import { ListadoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/ListadoJoyeria";
import { TarjetaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TarjetaJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { formatCop } from "@/lib/business-agent-quote";
import type { PublicCatalogPage, PublicOffer, PublicProductDetail } from "@/lib/catalogo/publicacion";

const routerFalso = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const CATEGORIAS = [
  { id: "c0000000-0000-4000-8000-0000000000a1", name: "Aretes" },
  { id: "c0000000-0000-4000-8000-0000000000a2", name: "Dijes" },
  { id: "c0000000-0000-4000-8000-0000000000a3", name: "Pulseras" },
];
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
const hrefs = (html: string) => new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]));

function listadoClasico(data: PublicCatalogPage, q?: string, categoria?: string) {
  return renderToStaticMarkup(
    envolver(<PublicCatalog data={data} basePath={BASE} q={q} categoria={categoria} compact listPath={LISTA} tile={(p, i) => <TarjetaJoyeria product={p} basePath={BASE} posicion={i} />} />),
  );
}
function listadoJoyeria(data: PublicCatalogPage, q?: string, categoria?: string, titulo = "Todo el catálogo") {
  return renderToStaticMarkup(
    envolver(<ListadoJoyeria data={data} basePath={BASE} q={q} categoria={categoria} listPath={LISTA} titulo={titulo} tile={(p, i) => <TarjetaJoyeria product={p} basePath={BASE} posicion={i} />} />),
  );
}

describe("listado joyería — las mismas direcciones que el listado de siempre", () => {
  const casos: Array<[string, string | undefined, string | undefined, Partial<PublicCatalogPage>]> = [
    ["sin filtros, página 2 de 3", undefined, undefined, {}],
    ["con categoría", undefined, CATEGORIAS[1].id, {}],
    ["con búsqueda", "cadena", undefined, { search: { relaxed: false, capped: false } }],
    ["búsqueda dentro de una categoría", "cadena", CATEGORIAS[0].id, {}],
    ["primera página", undefined, undefined, { page: 1 }],
    ["última página", undefined, undefined, { page: 3 }],
  ];
  for (const [nombre, q, categoria, extra] of casos) {
    it(`${nombre}: todo enlace del listado de siempre existe en el de joyería`, () => {
      const data = pagina(extra);
      const clasico = hrefs(listadoClasico(data, q, categoria));
      const joyeria = hrefs(listadoJoyeria(data, q, categoria));
      const faltan = [...clasico].filter((h) => !joyeria.has(h));
      assert.deepEqual(faltan, [], `faltan enlaces: ${faltan.join(", ")}`);
    });
  }

  it("las categorías conservan la búsqueda al cambiar de categoría y «Todo» la conserva sin categoría", () => {
    const h = listadoJoyeria(pagina(), "cadena", CATEGORIAS[0].id);
    assert.ok(h.includes(`href="${BASE}?q=cadena&amp;categoria=${encodeURIComponent(CATEGORIAS[1].id)}"`));
    assert.ok(h.includes(`href="${BASE}?q=cadena"`), "«Todo» solo quita la categoría");
  });

  it("la categoría activa queda marcada (columna de escritorio y fila del celular) y las demás no", () => {
    const h = listadoJoyeria(pagina(), undefined, CATEGORIAS[1].id);
    assert.equal((h.match(/aria-current="page"/g) ?? []).length >= 2, true);
    assert.equal((h.match(/joy-cat-lateral-activa/g) ?? []).length, 1);
    assert.equal((h.match(/joy-chip-activo/g) ?? []).length, 1);
  });

  it("la paginación lleva a la página anterior y a la siguiente con los mismos filtros, y se desactiva en los extremos", () => {
    const medio = listadoJoyeria(pagina(), "cadena", undefined);
    assert.ok(medio.includes(`href="${BASE}?q=cadena"`) || medio.includes('href="/catalogo/delacour?q=cadena"'));
    assert.ok(medio.includes(`?q=cadena&amp;pagina=3`));
    assert.ok(medio.includes("Página 2 de 3"));
    const primera = listadoJoyeria(pagina({ page: 1 }));
    assert.ok(!primera.includes("pagina=0") && primera.includes("pagina=2"));
    assert.equal((primera.match(/>Anterior</g) ?? []).length, 1, "«Anterior» está pero sin enlace");
    assert.ok(!/<a [^>]*>Anterior<\/a>/.test(primera));
    const ultima = listadoJoyeria(pagina({ page: 3 }));
    assert.ok(!/<a [^>]*>Siguiente<\/a>/.test(ultima));
  });

  it("muestra el total, el título y las migas; sin resultados lo dice y ofrece volver; la búsqueda relajada y recortada avisan", () => {
    const h = listadoJoyeria(pagina({ total: 1, products: [producto(1)] }), "cadena", undefined, "Resultados para «cadena»");
    assert.ok(h.includes("1 producto"));
    assert.ok(h.includes("Resultados para «cadena»"));
    assert.ok(h.includes("Búsqueda: cadena"));
    const vacio = listadoJoyeria(pagina({ products: [], total: 0, pageCount: 1, page: 1 }), "zzz");
    assert.ok(vacio.includes("No encontramos productos con esa búsqueda"));
    assert.ok(vacio.includes(`href="${LISTA}"`) && vacio.includes("Ver todo el catálogo"));
    const sinNada = listadoJoyeria(pagina({ products: [], total: 0, pageCount: 1, page: 1 }));
    assert.ok(sinNada.includes("Pronto verás productos aquí"));
    const relajada = listadoJoyeria(pagina({ search: { relaxed: true, capped: false } }), "cadena");
    assert.ok(relajada.includes("Ningún producto tiene todas las palabras que buscaste"));
    const recortada = listadoJoyeria(pagina({ page: 3, search: { relaxed: false, capped: true } }), "cadena");
    assert.ok(recortada.includes("Agrega otra palabra"));
  });

  it("no duplica el buscador (la cabecera tiene el suyo) y cada tarjeta es la de joyería", () => {
    const h = listadoJoyeria(pagina());
    assert.ok(!h.includes("<form"));
    assert.equal((h.match(/<article class="joy-tarjeta/g) ?? []).length, 2);
  });

  it("accesibilidad: los pasos de paginación que no existen se marcan como desactivados (con contraste suficiente) y los títulos de las tarjetas cuelgan de un h2", () => {
    const primera = listadoJoyeria(pagina({ page: 1 }));
    assert.ok(primera.includes('aria-disabled="true"'));
    assert.ok(!/opacity-40/.test(primera), "sin opacidad baja: el texto inactivo conserva contraste");
    const h = listadoJoyeria(pagina());
    assert.ok(h.indexOf('<h2 class="sr-only">Productos</h2>') > h.indexOf("<h1"), "h1 → h2 → h3 (sin saltarse niveles)");
    assert.ok(h.indexOf('<h2 class="sr-only">Productos</h2>') < h.indexOf("<h3"));
  });
});

describe("ficha joyería — los mismos datos y las mismas acciones que la de siempre", () => {
  const OFERTA: PublicOffer = { name: "Amor y Amistad", benefit: "20% de descuento", label: "-20%", until: "hasta el 31 de octubre de 2026", conditions: "Hasta agotar existencias." };
  const detalle = (over: Partial<PublicProductDetail> = {}): PublicProductDetail => ({
    ...producto(1),
    name: "Dije corazón",
    description: "Un dije delicado.\nSegunda línea.",
    material: "Oro laminado",
    color: "Dorado",
    price: 28_000,
    listPrice: 35_000,
    offer: OFERTA,
    categoryId: CATEGORIAS[1].id,
    categoryName: "Dijes",
    gallery: [{ imageUrl: "/a-main.webp", detailUrl: "/a-detail.webp", thumbUrl: "/a-thumb.webp" }],
    ...over,
  });
  const clasica = (p: PublicProductDetail) => renderToStaticMarkup(envolver(<FichaProducto producto={p} categorias={CATEGORIAS} basePath={BASE} listPath={LISTA} />));
  const joyeria = (p: PublicProductDetail) => renderToStaticMarkup(envolver(<FichaProductoJoyeria producto={p} categorias={CATEGORIAS} basePath={BASE} listPath={LISTA} />));
  const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

  it("todo lo que dice la ficha de siempre lo dice la de joyería (precio efectivo, tachado, oferta, disponibilidad, descripción, material y color)", () => {
    for (const p of [detalle(), detalle({ offer: undefined, listPrice: undefined, price: 35_000 }), detalle({ price: null, listPrice: undefined, offer: undefined }), detalle({ availability: "low", maxQuantity: 3 }), detalle({ available: false, availability: "sold_out" })]) {
      const frases = [p.name, `Ref. ${p.reference}`, "Un dije delicado.", "Oro laminado", "Dorado", p.price === null ? "Precio a consultar" : formatCop(p.price)];
      if (p.listPrice !== undefined) frases.push(formatCop(p.listPrice), "Precio normal:");
      if (p.offer) frases.push("-20%", "Amor y Amistad · 20% de descuento", "Vigente hasta el 31 de octubre de 2026", "Hasta agotar existencias.");
      frases.push(p.availability === "available" ? "Disponible" : p.availability === "low" ? "Últimas unidades" : "Agotado");
      const antes = texto(clasica(p));
      const despues = texto(joyeria(p));
      for (const s of frases) {
        assert.ok(antes.includes(s), `la ficha de siempre dice «${s}» (la prueba compara contra lo que ya existe)`);
        assert.ok(despues.includes(s), `la ficha de joyería también debe decir «${s}»`);
      }
    }
  });

  it("la compra es la misma pieza de siempre: cantidad y «Agregar» con el precio efectivo (agotado: «Agotado por ahora»)", () => {
    const h = joyeria(detalle());
    assert.ok(h.includes('aria-label="Cantidad"'));
    assert.ok(h.includes(`Agregar · ${formatCop(28_000)}`));
    assert.ok(!h.includes(`Agregar · ${formatCop(35_000)}`));
    assert.ok(joyeria(detalle({ available: false, availability: "sold_out" })).includes("Agotado por ahora"));
  });

  it("las migas y la categoría llevan a las mismas direcciones; el nombre actual no es un enlace", () => {
    const h = joyeria(detalle());
    for (const href of [BASE, LISTA, `${BASE}?categoria=${encodeURIComponent(CATEGORIAS[1].id)}`]) assert.ok(h.includes(`href="${href}"`), href);
    assert.ok(h.includes('aria-current="page"'));
    assert.equal((h.match(/<h1[ >]/g) ?? []).length, 1);
  });

  it("sin oferta no hay tachado, etiqueta ni recuadro; sin descripción, material ni color tampoco hay esas piezas", () => {
    const h = joyeria(detalle({ offer: undefined, listPrice: undefined, price: 35_000, description: null, material: null, color: null }));
    for (const s of ["<s>", "Precio normal: ", "Amor y Amistad", "Vigente ", "<dl"]) assert.ok(!h.includes(s), s);
  });

  it("la galería es la de la ficha: sin fotos, el recuadro con su texto; el texto del producto se escapa", () => {
    assert.ok(joyeria(detalle({ gallery: [] })).includes("Producto sin fotografía"));
    const h = joyeria(detalle({ name: "<img src=x onerror=alert(1)>", description: "<script>alert(2)</script>" }));
    assert.ok(!h.includes("<img src=x") && !h.includes("<script>alert"));
    assert.ok(h.includes("&lt;img src=x onerror=alert(1)&gt;"));
  });
});
