/**
 * Inicio de la tienda de joyería con las FOTOS Y VIDEOS que la administradora publicó (lo que llega en el HTML del servidor): cada video reemplaza al de siempre SOLO en su espacio, la imagen
 * de una categoría reemplaza la foto automática, y sin nada publicado el HTML es exactamente el de hoy.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, CATEGORIAS_PRUEBA, HOME_COMPLETO, LISTA, NOMBRE_NEGOCIO } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { TiendaInicioJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import type { OpcionFaceta } from "@/lib/catalogo/filtros";
import { joyeriaOf, storefrontConfigFor } from "@/lib/catalogo/vitrina";
import { aplicarCategorias, aplicarMultimedia, type MultimediaTienda } from "@/lib/cms-comercial/multimedia-tienda";

const WHATSAPP = "573000000000";
const REGISTRO = storefrontConfigFor("delacour");
const JOYERIA = joyeriaOf(REGISTRO)!;
const COLORES: OpcionFaceta[] = [
  { clave: "dorad", etiqueta: "Dorado", n: 85 },
  { clave: "platinad", etiqueta: "Platinado", n: 17 },
];

const archivo = (nombre: string, w: number, h: number) => ({ src: `/catalogo/delacour/vitrina/${nombre}.mp4`, poster: `/catalogo/delacour/vitrina/${nombre}-poster.webp`, width: w, height: h });

function inicio(m: MultimediaTienda | null): string {
  return renderToStaticMarkup(
    <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp={WHATSAPP}>
      <TiendaInicioJoyeria
        home={m ? { ...HOME_COMPLETO, categories: aplicarCategorias(HOME_COMPLETO.categories, m) } : HOME_COMPLETO}
        config={REGISTRO}
        joyeria={aplicarMultimedia(JOYERIA, m)}
        basePath={BASE}
        listPath={LISTA}
        businessName={NOMBRE_NEGOCIO}
        whatsapp={WHATSAPP}
        acabados={COLORES}
      />
    </TiendaProvider>,
  );
}

const DE_SIEMPRE = inicio(null);
const TODOS: MultimediaTienda = {
  videos: {
    portada: { horizontal: archivo("p-h", 1280, 720), vertical: archivo("p-v", 720, 1280) },
    coleccion: { horizontal: archivo("c-h", 1920, 1080) },
    marca: { horizontal: archivo("m", 720, 900) },
    mayoristas: { horizontal: archivo("y", 1280, 576) },
  },
  categorias: new Map(),
};

describe("el inicio con fotos y videos publicados", () => {
  it("sin nada publicado, o con nada que reemplazar, el HTML es EXACTAMENTE el de siempre", () => {
    assert.equal(inicio({ videos: {}, categorias: new Map() }), DE_SIEMPRE);
    assert.ok(DE_SIEMPRE.includes("/catalogo/delacour/video/portada-h.webp"), "los de siempre son los de DuLabs");
  });

  it("la portada usa las imágenes fijas de los videos nuevos (horizontal y vertical) y ninguno de los de siempre", () => {
    const html = inicio(TODOS);
    assert.ok(html.includes("/catalogo/delacour/vitrina/p-h-poster.webp"));
    assert.ok(html.includes('<source media="(max-aspect-ratio: 1/1)" srcSet="/catalogo/delacour/vitrina/p-v-poster.webp"/>'));
    assert.ok(!html.includes("/catalogo/delacour/video/portada-h.webp") && !html.includes("/catalogo/delacour/video/portada-v.webp"));
    assert.ok(!html.includes("<video"), "ningún <video> hasta que haga falta, también con los videos nuevos");
  });

  it("sin video vertical nuevo, el celular NO recibe la imagen vertical de siempre (sería de otra escena)", () => {
    const html = inicio({ videos: { portada: { horizontal: archivo("p-h", 1280, 720) } }, categorias: new Map() });
    assert.ok(html.includes("/catalogo/delacour/vitrina/p-h-poster.webp"));
    assert.ok(!html.includes("/catalogo/delacour/video/portada-v.webp"));
    assert.ok(!html.includes('<source media="(max-aspect-ratio: 1/1)" srcSet="/catalogo/delacour/video/portada-v.webp"/>'));
  });

  it("cada espacio se reemplaza por separado: los demás siguen con el video de siempre", () => {
    const soloMarca = inicio({ videos: { marca: { horizontal: archivo("m", 720, 900) } }, categorias: new Map() });
    assert.ok(soloMarca.includes("/catalogo/delacour/vitrina/m-poster.webp"));
    assert.ok(!soloMarca.includes("/catalogo/delacour/video/marca.webp"));
    for (const nombre of ["portada-h", "portada-v", "coleccion-h", "coleccion-v", "mayoristas"]) assert.ok(soloMarca.includes(`/catalogo/delacour/video/${nombre}.webp`), nombre);
    const todos = inicio(TODOS);
    for (const nombre of ["coleccion-h", "coleccion-v", "marca", "mayoristas"]) assert.ok(!todos.includes(`/catalogo/delacour/video/${nombre}.webp`), nombre);
    for (const nuevo of ["c-h", "m", "y"]) assert.ok(todos.includes(`/catalogo/delacour/vitrina/${nuevo}-poster.webp`), nuevo);
  });

  it("los textos de la tienda no cambian: solo los videos", () => {
    const sin = (html: string) => html.replace(/\/catalogo\/delacour\/(?:video|vitrina)\/[a-z0-9-]+\.(?:webp|mp4)/g, "").replace(/ width="\d+" height="\d+"/g, "");
    const conVideos = inicio(TODOS);
    for (const texto of ["Pequeños detalles, grandes historias", "Más que joyas, historias que te acompañan", "Compra al por mayor", "Hablar con una asesora", "Conoce nuestros acabados"]) assert.ok(conVideos.includes(texto), texto);
    assert.equal(sin(conVideos).replace(/\s+/g, " ").length > 1000, true);
    assert.equal(cuentaEtiquetas(conVideos, "h2"), cuentaEtiquetas(DE_SIEMPRE, "h2"));
    assert.equal(cuentaEtiquetas(conVideos, "button"), cuentaEtiquetas(DE_SIEMPRE, "button"));
    assert.equal(cuentaEtiquetas(conVideos, "a"), cuentaEtiquetas(DE_SIEMPRE, "a"));
  });

  it("la imagen de presentación de una categoría reemplaza la foto de su producto; las demás conservan la suya", () => {
    const carrusel = (html: string) => {
      const desde = html.indexOf('aria-label="Categorías, desplázate horizontalmente"');
      assert.ok(desde >= 0, "el carrusel de categorías");
      return html.slice(desde, html.indexOf("</ul>", desde));
    };
    const antes = carrusel(DE_SIEMPRE);
    assert.ok(antes.includes(CATEGORIAS_PRUEBA[0].coverUrl!), "de siempre: la foto de un producto");
    const con = carrusel(inicio({ videos: {}, categorias: new Map([[CATEGORIAS_PRUEBA[0].id, { src: "/catalogo/delacour/vitrina/cat-aretes.webp", ancho: 800, alto: 1000 }]]) }));
    assert.ok(con.includes("/catalogo/delacour/vitrina/cat-aretes.webp"));
    assert.ok(!con.includes(CATEGORIAS_PRUEBA[0].coverUrl!), "la foto del producto ya no sale en esa categoría");
    assert.ok(con.includes("Aretes") && con.includes("Dijes"), "las dos categorías siguen");
  });

  it("una categoría sin foto de producto (que mostraba solo su inicial) pasa a mostrar la imagen elegida", () => {
    const sinFoto = carruselDe(inicio(null));
    assert.ok(sinFoto.includes("joy-cat-foto") && sinFoto.split("joy-cat-foto").length === 2, "solo Aretes tiene foto");
    const con = carruselDe(inicio({ videos: {}, categorias: new Map([[CATEGORIAS_PRUEBA[1].id, { src: "/catalogo/delacour/vitrina/cat-dijes.webp", ancho: 800, alto: 1000 }]]) }));
    assert.equal(con.split("joy-cat-foto").length, 3, "ahora las dos tienen foto");
    assert.ok(con.includes("/catalogo/delacour/vitrina/cat-dijes.webp"));
  });
});

function carruselDe(html: string): string {
  const desde = html.indexOf('aria-label="Categorías, desplázate horizontalmente"');
  assert.ok(desde >= 0, "el carrusel de categorías");
  return html.slice(desde, html.indexOf("</ul>", desde));
}

function cuentaEtiquetas(html: string, etiqueta: string): number {
  return (html.match(new RegExp(`<${etiqueta}[ >]`, "g")) ?? []).length;
}
