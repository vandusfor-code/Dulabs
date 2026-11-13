/**
 * El INICIO del lado de HOMBRE de Delacour (Vértice) en el HTML que llega del servidor, sin JavaScript: su portada gráfica (con el rótulo de la colección y el botón al listado de hombre), su carrusel de
 * categorías (cada una lleva al listado de hombre de esa categoría), sus destacados (con la REFERENCIA `DL-…` sobre cada foto, la que usa el bot) y, cuando la administradora los sube, su video de portada,
 * el de la colección y el bloque de marca. Es una tienda dentro de la tienda: nada del inicio de mujer aparece aquí. Negocio y piezas FICTICIOS.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, producto } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { HeroVertice } from "@/components/catalogo-publico/tienda/joyeria/HeroVertice";
import { TiendaInicioHombre } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioHombre";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { hrefDeGenero, hrefListadoDeGenero } from "@/lib/catalogo/genero";
import type { PublicHome } from "@/lib/catalogo/service";
import { joyeriaOf, storefrontConfigFor, type ColeccionJoyeria, type MarcaJoyeria, type VideoAmbiente } from "@/lib/catalogo/vitrina";

const WHATSAPP = "573000000000";
const GENERO = joyeriaOf(storefrontConfigFor("delacour"))!.genero!;
const LISTA_HOMBRE = hrefListadoDeGenero(BASE, "hombre");
const DIJES = "c0000000-0000-4000-8000-0000000000a2";
const CADENAS = "c0000000-0000-4000-8000-0000000000a3";
const PIEZAS = [841, 842, 843, 844, 840, 839, 838, 837].map((n) => producto(n, { name: `Dije de acero ${n}`, categoryName: "Dijes", material: "Acero" }));
const HOME: PublicHome = {
  lado: "hombre",
  featured: PIEZAS,
  featuredPolicy: "recent-with-photo",
  categories: [
    { id: DIJES, name: "Dijes", coverUrl: `${BASE}/productos/dl-000844/thumb.webp?v=1` },
    { id: CADENAS, name: "Cadenas", coverUrl: null },
  ],
};
const VIDEO = (etiqueta: string): VideoAmbiente => ({ horizontal: { src: `${BASE}/vitrina/v1.mp4`, poster: `${BASE}/vitrina/v1.webp`, width: 1280, height: 720 }, etiqueta });
const COLECCION: ColeccionJoyeria = { video: VIDEO("Video de la colección de hombre"), etiqueta: "Colección", titulo: "Forjados en acero", boton: "Ver la colección" };
const MARCA: MarcaJoyeria = { video: VIDEO("Video de la marca de hombre"), titulo: "Vértice, hecho para durar", texto: "Piezas de acero con carácter.", boton: "Conocer más" };

function inicio(over: Partial<Parameters<typeof TiendaInicioHombre>[0]> = {}, marcaReferencia = true): string {
  return renderToStaticMarkup(
    <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp={WHATSAPP} marcaReferencia={marcaReferencia}>
      <TiendaInicioHombre home={HOME} genero={GENERO} basePath={BASE} listPath={LISTA_HOMBRE} whatsapp={WHATSAPP} {...over} />
    </TiendaProvider>,
  );
}
const cuenta = (html: string, patron: RegExp) => (html.match(patron) ?? []).length;
const pos = (html: string, texto: string) => {
  const i = html.indexOf(texto);
  assert.ok(i >= 0, `falta «${texto}»`);
  return i;
};
const atributos = (etiqueta: string): Record<string, string> => Object.fromEntries([...etiqueta.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2].replaceAll("&amp;", "&")]));
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const seccion = (html: string, id: string) => {
  const i = pos(html, `<section id="${id}"`);
  return html.slice(i, html.indexOf("</section>", i));
};
const marcasSobreFotos = (html: string) => [...html.matchAll(/<span class="[^"]*\bjoy-ref\b[^"]*"[^>]*>(DL-\d+)<\/span>/g)].map((m) => m[1]);

describe("el inicio de hombre: la portada gráfica de la colección", () => {
  const h = inicio();

  it("es UN solo h1, el de la colección (Vértice), con el rótulo completo: casa, antetítulo, lema y el texto de la colección", () => {
    assert.equal(cuenta(h, /<h1[ >]/g), 1);
    assert.match(h, /<h1 id="joy-hv-titulo" class="joy-vertice-titulo joy-hv-titulo">Vértice<\/h1>/);
    const portada = h.slice(pos(h, "data-joy-hero-hombre"), pos(h, 'id="categorias"'));
    for (const frase of ["Delacour", "Colección masculina", "Identidad forjada en acero", "Una colección de dijes de acero para hombre"]) assert.ok(texto(portada).includes(frase), frase);
    assert.ok(h.includes('aria-labelledby="joy-hv-titulo"'));
  });

  it("el botón lleva al listado completo de HOMBRE (?genero=hombre&todo=1), no al de mujer", () => {
    const boton = /<a [^>]*class="[^"]*joy-vertice-boton[^"]*"[^>]*>/.exec(h);
    assert.ok(boton, "falta el botón");
    assert.equal(atributos(boton![0]).href, `${BASE}?genero=hombre&todo=1`);
    assert.ok(texto(h).includes("Ver la colección"));
  });

  it("sin video es una portada GRÁFICA (sin <video>); con el video de portada que sube la administradora, va detrás del texto, con su velo y su botón de pausa", () => {
    assert.ok(!h.includes("joy-video"), "sin video no hay nada de video");
    const con = inicio({ video: VIDEO("Video de la portada de hombre") });
    assert.ok(cuenta(con, /joy-video-poster/g) >= 1, "falta el video (en el servidor se dibuja su imagen de portada; el video corre en el navegador)");
    assert.ok(con.includes("joy-hv-velo"));
    assert.ok(con.includes(`${BASE}/vitrina/v1.webp`), "la imagen de portada del video (lo que se ve mientras corre, con ahorro de datos o con movimiento reducido)");
    assert.equal(cuenta(con, /<h1[ >]/g), 1, "con video sigue siendo un solo h1");
  });
});

describe("el inicio de hombre: categorías y destacados", () => {
  const h = inicio();

  it("el carrusel de categorías va después de la portada; cada categoría lleva al listado de HOMBRE de esa categoría (no a ?categoria=)", () => {
    const sec = seccion(h, "categorias");
    assert.ok(sec.includes(">Categorías</h2>"));
    const enlaces = [...sec.matchAll(/<a [^>]*>/g)].map((m) => atributos(m[0]).href).filter(Boolean);
    assert.ok(enlaces.includes(`${BASE}?genero=hombre&categoria=${DIJES}`), enlaces.join(" | "));
    assert.ok(enlaces.includes(`${BASE}?genero=hombre&categoria=${CADENAS}`), "también la de sin foto (las con foto van primero)");
    assert.ok(enlaces.includes(LISTA_HOMBRE), "«Ver todo»");
    assert.ok(!enlaces.some((x) => /^\/catalogo\/delacour\?categoria=/.test(x)), "ninguna al listado de mujer");
    assert.ok(pos(h, "data-joy-hero-hombre") < pos(h, 'id="categorias"'));
  });

  it("los destacados salen del inicio de hombre, con su rótulo («Vértice · Lo más nuevo») y un enlace a toda la colección", () => {
    const sec = seccion(h, "destacados");
    assert.ok(texto(sec).includes("Vértice") && texto(sec).includes("Lo más nuevo"));
    assert.equal(cuenta(sec, /<article class="joy-tarjeta/g), 8);
    assert.ok(texto(sec).includes("Ver toda la colección"));
    const verTodo = [...sec.matchAll(/<a [^>]*>/g)].map((m) => atributos(m[0]).href).filter((x) => x === LISTA_HOMBRE);
    assert.ok(verTodo.length >= 1);
    assert.ok(pos(h, 'id="categorias"') < pos(h, 'id="destacados"'));
  });

  it("lo elegido en el CMS se rotula «Piezas destacadas» (como en el lado de mujer lo elegido se llama «Productos destacados»)", () => {
    assert.ok(texto(seccion(inicio({ home: { ...HOME, featuredPolicy: "cms" } }), "destacados")).includes("Piezas destacadas"));
  });

  it("cada pieza trae su REFERENCIA (`DL-…`) sobre la foto, la que usa el bot para identificarla; sin el módulo no hay marca sobre la foto", () => {
    assert.deepEqual(marcasSobreFotos(seccion(h, "destacados")), PIEZAS.map((p) => p.reference));
    assert.deepEqual(marcasSobreFotos(inicio({}, false)), []);
  });

  it("las fotos de la página se cargan al acercarse (la portada ocupa toda la primera pantalla): ninguna precarga ni prioridad alta", () => {
    const imgs = [...h.matchAll(/<img [^>]*>/g)].map((m) => atributos(m[0]));
    assert.ok(imgs.length >= 8);
    for (const a of imgs) assert.deepEqual([a.loading, a.fetchpriority ?? a.fetchPriority ?? "auto"], ["lazy", "auto"], a.src);
    assert.ok(!h.includes('rel="preload"'));
  });

  it("sin categorías con piezas de hombre o sin destacados, ese bloque NO se dibuja (nada inventado)", () => {
    const sinCategorias = inicio({ home: { ...HOME, categories: [] } });
    assert.ok(!sinCategorias.includes('id="categorias"') && sinCategorias.includes('id="destacados"'));
    const sinDestacados = inicio({ home: { ...HOME, featured: [] } });
    assert.ok(!sinDestacados.includes('id="destacados"') && sinDestacados.includes('id="categorias"'));
    assert.ok(sinDestacados.includes("data-joy-hero-hombre"), "la portada siempre está");
  });
});

describe("el inicio de hombre: videos de colección y de marca (los sube la administradora)", () => {
  it("sin ellos no hay bloque; con ellos van tras los destacados, cada uno con su video y su botón al listado de hombre", () => {
    const sin = inicio();
    assert.ok(!sin.includes('id="coleccion"') && !sin.includes('id="marca"') && !sin.includes("joy-video"));
    const con = inicio({ coleccion: COLECCION, marca: MARCA });
    const colec = seccion(con, "coleccion");
    assert.ok(colec.includes("Forjados en acero") && colec.includes("joy-video-poster"));
    assert.equal(atributos(/<a [^>]*>/.exec(colec.slice(colec.indexOf("joy-contorno-claro") - 200))![0]).href, LISTA_HOMBRE);
    const marca = seccion(con, "marca");
    assert.ok(marca.includes("Vértice, hecho para durar") && marca.includes("Piezas de acero con carácter.") && marca.includes("joy-video-poster"));
    assert.ok(pos(con, 'id="destacados"') < pos(con, 'id="coleccion"') && pos(con, 'id="coleccion"') < pos(con, 'id="marca"'));
  });
});

describe("el inicio de hombre es una tienda propia: nada del inicio de mujer", () => {
  it("sin portada de mujer, sin líneas, sin la entrada «Para él», sin mayoristas y sin la cortina que sube sobre la portada fija", () => {
    const h = inicio({ coleccion: COLECCION, marca: MARCA });
    for (const rastro of ['id="lineas"', 'id="vertice"', 'id="mayoristas"', "Nuestras líneas", "joy-hero-fijo", "joy-escena", "data-joy-hero=", "data-joy-cortina", "Historias que brillan"]) assert.ok(!h.includes(rastro), `quedó «${rastro}»`);
  });

  it("trae los botones flotantes (WhatsApp) como el resto de la tienda", () => {
    assert.ok(inicio().includes(`wa.me/${WHATSAPP}`));
  });

  it("el inicio de hombre y el de mujer tienen direcciones distintas: ?genero=hombre y la de siempre", () => {
    assert.equal(hrefDeGenero(BASE, "hombre"), `${BASE}?genero=hombre`);
    assert.equal(hrefDeGenero(BASE, "mujer"), BASE);
  });
});

describe("HeroVertice por sí sola", () => {
  it("dibuja el rótulo de la configuración del negocio (los textos no están escritos a mano en el componente)", () => {
    const personalizada = { ...GENERO.hombre, marca: "Otra Colección", lema: "Otro lema", casa: "Otra Casa" };
    const h = renderToStaticMarkup(<HeroVertice config={personalizada} href={LISTA_HOMBRE} />);
    for (const frase of ["Otra Colección", "Otro lema", "Otra Casa"]) assert.ok(h.includes(frase), frase);
    assert.ok(!h.includes("Vértice</h1>"));
  });
});
