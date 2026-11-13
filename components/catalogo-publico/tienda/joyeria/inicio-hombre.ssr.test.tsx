/**
 * El INICIO del lado de HOMBRE de Delacour (Vértice) en el HTML que llega del servidor, sin JavaScript: es la MISMA composición del inicio de mujer, con su diseño y su contenido, en el MISMO orden
 * (portada con video, video de la colección, categorías, marca con su video, destacados con la REFERENCIA `DL-…` sobre cada foto, y los mayoristas), un solo lienzo sin franjas de otro color, y categorías
 * que se adaptan a cuántas haya (una sola no es una tarjeta gigante y vacía). Es una tienda dentro de la tienda: nada del inicio de mujer aparece aquí. Negocio y piezas FICTICIOS.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, producto } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { CategoriasHombre, MOSAICOS_MAX, enlaceDeCategoria, fotoGrande } from "@/components/catalogo-publico/tienda/joyeria/CategoriasHombre";
import { HeroVertice } from "@/components/catalogo-publico/tienda/joyeria/HeroVertice";
import { TiendaInicioHombre } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioHombre";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { hrefDeGenero, hrefListadoDeGenero } from "@/lib/catalogo/genero";
import type { MayoristasVisible } from "@/lib/catalogo/joyeria";
import type { PublicHome } from "@/lib/catalogo/service";
import { joyeriaOf, storefrontConfigFor, type ColeccionJoyeria, type MarcaJoyeria, type VideoAmbiente } from "@/lib/catalogo/vitrina";

const WHATSAPP = "573000000000";
const GENERO = joyeriaOf(storefrontConfigFor("delacour"))!.genero!;
const LISTA_HOMBRE = hrefListadoDeGenero(BASE, "hombre");
const DIJES = "c0000000-0000-4000-8000-0000000000a2";
const CADENAS = "c0000000-0000-4000-8000-0000000000a3";
const PIEZAS = [841, 842, 843, 844, 840, 839, 838, 837].map((n) => producto(n, { name: `Dije de acero ${n}`, categoryName: "Dijes", material: "Acero" }));
const CON_FOTO = { id: DIJES, name: "Dijes", coverUrl: `${BASE}/productos/dl-000844/thumb.webp?v=1` };
const SIN_FOTO = { id: CADENAS, name: "Cadenas", coverUrl: null };
const HOME: PublicHome = {
  lado: "hombre",
  featured: PIEZAS,
  featuredPolicy: "recent-with-photo",
  categories: [CON_FOTO, SIN_FOTO],
};
const VIDEO = (etiqueta: string): VideoAmbiente => ({ horizontal: { src: `${BASE}/vitrina/v1.mp4`, poster: `${BASE}/vitrina/v1.webp`, width: 1280, height: 720 }, etiqueta });
const COLECCION: ColeccionJoyeria = { video: VIDEO("Video de la colección de hombre"), etiqueta: "Colección", titulo: "Forjados en acero", boton: "Ver la colección" };
const MARCA: MarcaJoyeria = { video: VIDEO("Video de la marca de hombre"), titulo: "Vértice, hecho para durar", texto: "Piezas de acero con carácter.", boton: "Conocer más" };
const MAYORISTAS: MayoristasVisible = { etiqueta: "Compras por mayor", titulo: "Vende nuestras piezas", texto: "Escríbenos y te asesoramos.", boton: "Escribir por WhatsApp", href: `https://wa.me/${WHATSAPP}?text=Hola`, video: VIDEO("Video de los mayoristas") };

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
const apertura = (html: string, id: string) => /<section id="[^"]+"[^>]*>/.exec(seccion(html, id))![0];
const marcasSobreFotos = (html: string) => [...html.matchAll(/<span class="[^"]*\bjoy-ref\b[^"]*"[^>]*>(DL-\d+)<\/span>/g)].map((m) => m[1]);
const categorias = (n: number): PublicHome["categories"] => Array.from({ length: n }, (_, i) => ({ id: `c0000000-0000-4000-8000-00000000b${String(i).padStart(3, "0")}`, name: `Categoría ${i + 1}`, coverUrl: `${BASE}/productos/dl-00084${i}/thumb.webp?v=1` }));

describe("el inicio de hombre: la portada de la colección", () => {
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

  it("con el video de portada que sube la administradora, va detrás del texto, con su velo y su botón de pausa (sin video es una portada gráfica, sin <video>)", () => {
    assert.ok(!h.includes("joy-video"), "sin video no hay nada de video");
    const con = inicio({ video: VIDEO("Video de la portada de hombre") });
    assert.ok(cuenta(con, /joy-video-poster/g) >= 1, "falta el video (en el servidor se dibuja su imagen de portada; el video corre en el navegador)");
    assert.ok(con.includes("joy-hv-velo"));
    assert.ok(con.includes(`${BASE}/vitrina/v1.webp`), "la imagen de portada del video (lo que se ve mientras corre, con ahorro de datos o con movimiento reducido)");
    assert.equal(cuenta(con, /<h1[ >]/g), 1, "con video sigue siendo un solo h1");
  });
});

describe("el inicio de hombre: el orden es el del inicio de mujer", () => {
  it("portada → video de la colección → categorías → marca → destacados → mayoristas", () => {
    const h = inicio({ video: VIDEO("Video de la portada de hombre"), coleccion: COLECCION, marca: MARCA, mayoristas: MAYORISTAS });
    const orden = ["data-joy-hero-hombre", 'id="coleccion"', 'id="categorias"', 'id="marca"', 'id="destacados"', 'id="mayoristas"'].map((x) => pos(h, x));
    assert.deepEqual([...orden].sort((a, b) => a - b), orden, "las secciones no están en el orden del inicio de mujer");
  });

  it("lo que falta no deja huecos ni cambia el orden de lo demás: sin colección ni marca queda portada → categorías → destacados", () => {
    const h = inicio();
    assert.ok(!h.includes('id="coleccion"') && !h.includes('id="marca"') && !h.includes('id="mayoristas"'));
    assert.ok(pos(h, "data-joy-hero-hombre") < pos(h, 'id="categorias"') && pos(h, 'id="categorias"') < pos(h, 'id="destacados"'));
  });
});

describe("el inicio de hombre es un solo lienzo: sin franjas ni cortes planos", () => {
  const h = inicio({ video: VIDEO("Video de la portada de hombre"), coleccion: COLECCION, marca: MARCA, mayoristas: MAYORISTAS });

  it("las categorías, la marca y los destacados NO pintan fondo propio (todos comparten el de la página): ni bg-ink ni bg-ink-2", () => {
    for (const id of ["categorias", "marca", "destacados"]) assert.ok(!/\bbg-/.test(apertura(h, id)), `la sección ${id} pinta su propio fondo: ${apertura(h, id)}`);
    // Ninguna sección del inicio (ni las de video, que solo traen su color base) usa el fondo de la página ni el segundo fondo: no hay bandas.
    const aperturas = [...h.matchAll(/<section[^>]*>/g)].map((m) => m[0]);
    assert.ok(aperturas.length >= 6, `${aperturas.length} secciones`);
    for (const a of aperturas) assert.ok(!/\bbg-ink/.test(a), `una sección pinta una franja: ${a}`);
  });

  it("los videos de la colección y de los mayoristas entran y salen de la página con un degradado (joy-suave); la portada se funde por CSS", () => {
    assert.ok(apertura(h, "coleccion").includes("joy-suave"));
    assert.ok(apertura(h, "mayoristas").includes("joy-suave"));
    assert.ok(!apertura(h, "marca").includes("joy-suave") && !apertura(h, "categorias").includes("joy-suave"));
  });

  it("el inicio lleva su clase de lienzo (joy-inicio-hombre) y la portada la suya (joy-hv): el CSS les da el fondo continuo y los degradados", () => {
    assert.match(h, /^<div class="joy-inicio-hombre">/);
    assert.ok(h.includes('class="joy-hv"'));
  });
});

describe("el inicio de hombre: las categorías se adaptan a cuántas haya", () => {
  it("con DOS (las con foto primero), cada una lleva al listado de HOMBRE de esa categoría (no a ?categoria=) y «Ver todo» al de toda la colección", () => {
    const h = inicio();
    const sec = seccion(h, "categorias");
    assert.ok(sec.includes(">Categorías</h2>"));
    assert.ok(sec.includes('class="joy-hm-mosaico" data-n="2"'));
    const enlaces = [...sec.matchAll(/<a [^>]*>/g)].map((m) => atributos(m[0]).href).filter(Boolean);
    assert.ok(enlaces.includes(`${BASE}?genero=hombre&categoria=${DIJES}`), enlaces.join(" | "));
    assert.ok(enlaces.includes(`${BASE}?genero=hombre&categoria=${CADENAS}`), "también la de sin foto (las con foto van primero)");
    assert.ok(enlaces.includes(LISTA_HOMBRE), "«Ver todo»");
    assert.ok(!enlaces.some((x) => /^\/catalogo\/delacour\?categoria=/.test(x)), "ninguna al listado de mujer");
    assert.ok(pos(h, "data-joy-hero-hombre") < pos(h, 'id="categorias"'));
    assert.ok(pos(sec, DIJES) < pos(sec, CADENAS), "la que tiene foto va primero");
  });

  it("con UNA sola es una tarjeta destacada y no una tira gigante: su nombre es el h2, la foto es la GRANDE de la misma pieza, el botón lleva a su listado y no hay «Ver todo»", () => {
    const h = inicio({ home: { ...HOME, categories: [CON_FOTO] } });
    const sec = seccion(h, "categorias");
    assert.ok(sec.includes("joy-hm-destacada"));
    assert.match(sec, /<h2 id="joy-categorias" class="joy-hm-destacada-titulo font-serif-tienda">Dijes<\/h2>/);
    assert.ok(sec.includes(`${BASE}/productos/dl-000844/detail.webp?v=1`), "la foto grande (900×1200), no la miniatura de 400");
    assert.ok(!sec.includes("thumb.webp"), "ninguna miniatura de 400 px estirada");
    assert.ok(!sec.includes("Ver todo") && !sec.includes("joy-hm-mosaico") && !sec.includes("carrusel"));
    const enlaces = [...sec.matchAll(/<a [^>]*>/g)].map((m) => atributos(m[0]).href);
    assert.deepEqual(enlaces, [`${BASE}?genero=hombre&categoria=${DIJES}`]);
    assert.ok(texto(sec).includes("Ver la categoría"));
    assert.equal(cuenta(h, /<h2 id="joy-categorias"/g), 1, "un solo h2 de categorías");
  });

  it("una sola categoría SIN foto dibuja su inicial en vez de una imagen rota", () => {
    const sec = seccion(inicio({ home: { ...HOME, categories: [SIN_FOTO] } }), "categorias");
    assert.ok(sec.includes("joy-hm-inicial") && !sec.includes("<img"));
    assert.match(sec, />C<\/span>/);
  });

  it("de DOS a CUATRO son mosaicos (data-n = cuántas) y con MÁS de cuatro vuelve el carrusel de siempre", () => {
    for (const n of [2, 3, 4]) {
      const sec = seccion(inicio({ home: { ...HOME, categories: categorias(n) } }), "categorias");
      assert.ok(sec.includes(`class="joy-hm-mosaico" data-n="${n}"`), `con ${n}`);
      assert.equal(cuenta(sec, /<li class="joy-item"/g), n);
      assert.ok(!sec.includes("carrusel"));
    }
    assert.equal(MOSAICOS_MAX, 4);
    const sec = seccion(inicio({ home: { ...HOME, categories: categorias(5) } }), "categorias");
    assert.ok(sec.includes('aria-roledescription="carrusel"') && !sec.includes("joy-hm-mosaico"));
    assert.ok(sec.includes(">Categorías</h2>"));
  });

  it("con DOS, las fotos son las grandes (cada mosaico es muy ancho); con tres o cuatro basta la miniatura", () => {
    assert.ok(seccion(inicio(), "categorias").includes("detail.webp"));
    const sec = seccion(inicio({ home: { ...HOME, categories: categorias(4) } }), "categorias");
    assert.ok(sec.includes("thumb.webp") && !sec.includes("detail.webp"));
  });

  it("fotoGrande cambia solo la variante (conserva la versión del archivo) y sin foto no inventa nada; el enlace es siempre el de hombre", () => {
    assert.equal(fotoGrande(`${BASE}/productos/dl-000001/thumb.webp?v=abc`), `${BASE}/productos/dl-000001/detail.webp?v=abc`);
    assert.equal(fotoGrande(null), null);
    assert.equal(enlaceDeCategoria(BASE, { id: DIJES }), `${BASE}?genero=hombre&categoria=${DIJES}`);
  });

  it("sin categorías el bloque no existe (ni vacío)", () => {
    assert.equal(renderToStaticMarkup(<CategoriasHombre categorias={[]} basePath={BASE} listPath={LISTA_HOMBRE} />), "");
  });
});

describe("el inicio de hombre: destacados", () => {
  const h = inicio();

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

describe("el inicio de hombre: videos de colección y de marca, y los mayoristas", () => {
  it("sin ellos no hay bloque; con ellos, cada uno con su video y su botón al listado de hombre", () => {
    const sin = inicio();
    assert.ok(!sin.includes('id="coleccion"') && !sin.includes('id="marca"') && !sin.includes("joy-video"));
    const con = inicio({ coleccion: COLECCION, marca: MARCA });
    const colec = seccion(con, "coleccion");
    assert.ok(colec.includes("Forjados en acero") && colec.includes("joy-video-poster"));
    assert.equal(atributos(/<a [^>]*>/.exec(colec.slice(colec.indexOf("joy-contorno-claro") - 200))![0]).href, LISTA_HOMBRE);
    const marca = seccion(con, "marca");
    assert.ok(marca.includes("Vértice, hecho para durar") && marca.includes("Piezas de acero con carácter.") && marca.includes("joy-video-poster"));
  });

  it("los mayoristas son de TODA la tienda: cierran el inicio con su video y su botón de WhatsApp; sin ellos no hay bloque", () => {
    assert.ok(!inicio().includes('id="mayoristas"'));
    const con = inicio({ mayoristas: MAYORISTAS });
    const sec = seccion(con, "mayoristas");
    assert.ok(texto(sec).includes("Compras por mayor") && texto(sec).includes("Vende nuestras piezas") && texto(sec).includes("Escribir por WhatsApp"));
    assert.ok(sec.includes("joy-video-poster") && sec.includes("joy-mayoristas-velo"));
    assert.ok([...sec.matchAll(/<a [^>]*>/g)].some((m) => atributos(m[0]).href === MAYORISTAS.href));
    assert.ok(pos(con, 'id="destacados"') < pos(con, 'id="mayoristas"'));
  });
});

describe("el inicio de hombre es una tienda propia: nada del inicio de mujer", () => {
  it("sin portada de mujer, sin líneas, sin la entrada «Para él» y sin la cortina que sube sobre la portada fija", () => {
    const h = inicio({ coleccion: COLECCION, marca: MARCA });
    for (const rastro of ['id="lineas"', 'id="vertice"', "Nuestras líneas", "joy-hero-fijo", "joy-escena", "data-joy-hero=", "data-joy-cortina", "Historias que brillan"]) assert.ok(!h.includes(rastro), `quedó «${rastro}»`);
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
