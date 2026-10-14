/**
 * Inicio «como la referencia» del tema "joyeria" (Bloque 30), lo que llega en el HTML del servidor: la portada con video (dos diapositivas con sus controles y NINGÚN video descargándose todavía),
 * el video de la colección, la franja de acabados (solo con colores reales del catálogo), la marca con su tarjeta de video, los mayoristas con su video de fondo y los botones flotantes. Y lo
 * que NO cambia: sin videos configurados o con la portada fuera de lugar, el inicio es el de siempre. El comportamiento en el navegador (rotación, pausa, carga) está en portada-video.dom.test.tsx.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, CATEGORIAS_PRUEBA, HOME_COMPLETO, LISTA, NOMBRE_NEGOCIO } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { TiendaInicioJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import type { OpcionFaceta } from "@/lib/catalogo/filtros";
import type { PublicHome } from "@/lib/catalogo/service";
import { joyeriaOf, storefrontConfigFor, type CatalogStorefrontConfig, type ConfigJoyeria } from "@/lib/catalogo/vitrina";

const WHATSAPP = "573000000000";
const REGISTRO = storefrontConfigFor("delacour");
const JOYERIA = joyeriaOf(REGISTRO)!;
const opcion = (etiqueta: string, n: number, clave: string): OpcionFaceta => ({ clave, etiqueta, n });
const COLORES = [opcion("Dorado", 85, "dorad"), opcion("Platinado", 17, "platinad"), opcion("Plateado", 10, "platead"), opcion("Oro rosa", 2, "oro ros")];

function inicio(opts: { config?: CatalogStorefrontConfig; joyeria?: ConfigJoyeria; home?: PublicHome; whatsapp?: string | null; acabados?: readonly OpcionFaceta[] | null } = {}): string {
  const whatsapp = opts.whatsapp === undefined ? WHATSAPP : opts.whatsapp;
  return renderToStaticMarkup(
    <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp={whatsapp}>
      <TiendaInicioJoyeria
        home={opts.home ?? HOME_COMPLETO}
        config={opts.config ?? REGISTRO}
        joyeria={opts.joyeria ?? JOYERIA}
        basePath={BASE}
        listPath={LISTA}
        businessName={NOMBRE_NEGOCIO}
        whatsapp={whatsapp}
        acabados={opts.acabados === undefined ? COLORES : opts.acabados}
      />
    </TiendaProvider>,
  );
}
const cuenta = (html: string, patron: RegExp) => (html.match(patron) ?? []).length;
const pos = (html: string, texto: string) => {
  const i = html.indexOf(texto);
  assert.ok(i >= 0, `falta «${texto}»`);
  return i;
};
const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("portada con video", () => {
  const html = inicio();
  const portada = html.slice(pos(html, 'data-joy-hero=""'), pos(html, 'data-joy-cortina=""'));

  it("es un carrusel de dos diapositivas: la primera con el texto de siempre de la portada (el único h1) y la segunda con la firma de la marca", () => {
    assert.ok(portada.includes('aria-roledescription="carrusel"'));
    assert.equal(cuenta(portada, /role="group" aria-roledescription="diapositiva"/g), 2);
    assert.ok(portada.includes('aria-label="1 de 2"') && portada.includes('aria-label="2 de 2"'));
    assert.equal(cuenta(html, /<h1[ >]/g), 1, "un solo h1 en la página");
    assert.match(portada, /<h1 class="sr-only">Historias que brillan contigo<\/h1>/, "el h1 (con el título del CMS) va FUERA de las diapositivas: una diapositiva oculta no se expone y la página no se queda sin título principal");
    const [primera, segunda] = portada.split('aria-label="2 de 2"');
    for (const t of ["Historias que brillan contigo", "Más que joyas", "Diseños únicos para cada momento de tu vida.", "Ver catálogo"]) assert.ok(primera.includes(t), t);
    assert.ok(!/<h1[ >]/.test(primera.slice(primera.indexOf('aria-label="1 de 2"'))), "dentro de la diapositiva no hay otro h1");
    assert.match(primera, /<p [^>]*aria-hidden="true"[^>]*><span class="joy-titulo-brillo">Historias que brillan contigo<\/span><\/p>/, "el título visible de la diapositiva no se repite para lectores de pantalla (ya lo dice el h1)");
    assert.ok(segunda.includes("Delacour &amp; Orus") && segunda.includes("Joyería"), "la segunda diapositiva firma con el nombre y el descriptor de la marca");
    assert.ok(/<p [^>]*uppercase[^>]*>/.test(segunda), "su título es un párrafo con aspecto de firma (no otro h1)");
    assert.ok(segunda.includes("Mujer luciendo un dije de corazón"), "la fotografía de siempre de la portada (la del CMS) es la segunda diapositiva");
  });

  it("la primera diapositiva está activa y la segunda no (y no se puede enfocar ni leer mientras está oculta)", () => {
    const [primera] = portada.split('aria-label="2 de 2"');
    assert.ok(primera.includes('data-activa="true"') && !primera.includes("inert"), "la primera está activa y se puede usar");
    assert.ok(/data-activa="false"[^>]*aria-label="2 de 2"[^>]*inert=""/.test(portada), "la segunda está oculta y es inerte");
  });

  it("trae sus controles con nombre: anterior, siguiente, un punto por diapositiva y pausa; el movimiento automático siempre se puede detener", () => {
    for (const nombre of ["Diapositiva anterior", "Diapositiva siguiente", "Ir a la diapositiva 1", "Ir a la diapositiva 2", "Pausar la presentación"]) assert.ok(portada.includes(`aria-label="${nombre}"`), nombre);
    assert.ok(portada.includes('aria-current="true"'), "el punto de la diapositiva activa");
    assert.ok(portada.includes('aria-live="off"'), "mientras rota sola no anuncia cada cambio a quien usa lector de pantalla");
  });

  it("el video NO se descarga con la página: en el HTML solo hay la imagen fija (con su versión para el celular) y ningún <video>", () => {
    assert.ok(!html.includes("<video"), "ningún <video> hasta que haga falta");
    assert.ok(portada.includes('<source media="(max-aspect-ratio: 1/1)" srcSet="/catalogo/delacour/video/portada-v.webp"/>'), "imagen fija vertical para pantallas altas");
    const imagenFija = portada.match(/<img [^>]*portada-h\.webp[^>]*>/)?.[0] ?? "";
    assert.match(imagenFija, /fetchpriority="high"/i, "la imagen fija de la portada es la prioritaria (es lo primero que se ve)");
    assert.match(imagenFija, /width="1280" height="720"/, "reserva su espacio (sin saltos)");
    assert.match(imagenFija, /alt=""/, "es decorativa");
  });

  it("el texto sigue siendo HTML real y el velo, los destellos y el filete de la portada de siempre están en cada diapositiva", () => {
    assert.equal(cuenta(portada, /joy-hero-velo(?![-\w])/g), 2, "el velo de siempre en cada diapositiva");
    assert.equal(cuenta(portada, /joy-hero-velo-foto/g), 1, "la fotografía lleva además su velo más largo");
    assert.equal(cuenta(portada, /joy-linea/g), 2);
    assert.equal(cuenta(portada, /joy-titulo-brillo/g), 2);
    assert.ok(html.includes('data-joy-hero=""') && cuenta(html, /data-joy-hero/g) === 1, "el cromo transparente sigue teniendo UNA portada de referencia");
  });
});

describe("el contenido que sube sobre la portada, en el orden de la referencia", () => {
  const html = inicio();

  it("portada → colección (video a pantalla completa) → franja de acabados → categorías → marca → novedades → banner → mayoristas", () => {
    const orden = ['data-joy-hero=""', 'data-joy-cortina=""', 'id="coleccion"', "data-joy-claro", 'id="acabados"', 'id="categorias"', 'id="marca"', 'id="joy-destacados"', "El regalo perfecto siempre es una joya", 'id="mayoristas"'].map((m) => pos(html, m));
    assert.deepEqual([...orden].sort((a, b) => a - b), orden);
  });

  it("colección: etiqueta, título y un botón al catálogo completo sobre el video, con su botón de pausa y su imagen fija", () => {
    const c = html.slice(pos(html, 'id="coleccion"'), pos(html, "data-joy-claro"));
    for (const t of ["Colección", "Pequeños detalles, grandes historias", "Ver la colección"]) assert.ok(c.includes(t), t);
    assert.ok(c.includes(`href="${LISTA}"`) && c.includes("joy-contorno-claro"));
    assert.ok(c.includes('aria-label="Pausar video de la colección"'));
    assert.ok(c.includes("/catalogo/delacour/video/coleccion-h.webp") && c.includes('srcSet="/catalogo/delacour/video/coleccion-v.webp"'));
    assert.ok(c.includes("h-[100svh]"), "ocupa toda la pantalla");
    assert.equal(cuenta(c, /<h2[ >]/g), 1);
    assert.ok(!c.includes("<video"));
  });

  it("la marca va tras las categorías, con su video en una tarjeta vertical y su botón de pausa", () => {
    const m = html.slice(pos(html, 'id="marca"'), pos(html, 'id="joy-destacados"'));
    for (const t of ["Más que joyas, historias que te acompañan", "Diseños únicos para cada momento de tu vida. Joyería que te acompaña siempre.", "Ver el catálogo"]) assert.ok(m.includes(t), t);
    assert.ok(m.includes("aspect-[4/5]") && m.includes('aria-label="Pausar video de la marca"') && m.includes("/catalogo/delacour/video/marca.webp"));
    assert.ok(m.includes(`href="${LISTA}"`));
  });

  it("los mayoristas llevan su video de fondo detrás del texto, con un velo para que se lea y su botón de pausa; el botón de WhatsApp es el de siempre", () => {
    const m = html.slice(pos(html, 'id="mayoristas"'));
    assert.ok(m.includes("/catalogo/delacour/video/mayoristas.webp") && m.includes("joy-mayoristas-velo") && m.includes('aria-label="Pausar video de compras por mayor"'));
    assert.ok(m.includes(`href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Hola, quiero información para comprar al por mayor.")}" target="_blank" rel="noopener noreferrer"`));
    assert.ok(pos(m, "joy-mayoristas-velo") < pos(m, "Compra al por mayor"), "el video queda detrás del texto");
  });

  it("las categorías son la tira de borde a borde de siempre-enlaces (?categoria=), con «Categoría» y el nombre, y un «Ver todo» al catálogo", () => {
    const c = html.slice(pos(html, 'id="categorias"'), pos(html, 'id="marca"'));
    for (const cat of CATEGORIAS_PRUEBA) assert.ok(c.includes(`href="${BASE}?categoria=${encodeURIComponent(cat.id)}"`), cat.name);
    assert.ok(c.includes("Categoría"), "cada tarjeta dice «Categoría» y su nombre");
    assert.ok(c.includes(`href="${LISTA}"`) && c.includes("Ver todo"), "«Ver todo» lleva al catálogo completo");
  });

  it("los destacados cierran con «Ver todos» (enlace de texto como en la referencia), nunca con un botón inventado", () => {
    const d = html.slice(pos(html, 'id="joy-destacados"'), pos(html, "El regalo perfecto siempre es una joya"));
    assert.ok(d.includes("Ver todos") && d.includes(`href="${LISTA}"`));
  });
});

describe("franja de acabados: solo con colores reales del catálogo", () => {
  it("muestra los de más piezas (con un mínimo) como enlaces al listado filtrado por ese color, y deja fuera los casi sin piezas", () => {
    const html = inicio();
    const f = html.slice(pos(html, 'id="acabados"'), pos(html, 'id="categorias"'));
    assert.ok(f.includes("Conoce nuestros acabados"));
    for (const [etiqueta, clave] of [["Dorado", "dorad"], ["Platinado", "platinad"], ["Plateado", "platead"]]) assert.ok(f.includes(`href="${BASE}?color=${clave}"`) && f.includes(`>${etiqueta}<`), etiqueta);
    assert.ok(!f.includes("Oro rosa"), "dos piezas no son una línea de la tienda");
    assert.equal(cuenta(f, /<li>/g), 3);
  });

  it("sin datos (null), con una sola opción o con menos piezas de las necesarias, la franja no existe", () => {
    for (const acabados of [null, [], [opcion("Dorado", 85, "dorad")], [opcion("Dorado", 85, "dorad"), opcion("Plateado", 1, "platead")]]) {
      const html = inicio({ acabados });
      assert.ok(!html.includes('id="acabados"') && !html.includes("Conoce nuestros acabados"), JSON.stringify(acabados));
    }
  });

  it("sin la configuración «acabados» tampoco hay franja, aunque lleguen colores", () => {
    const html = inicio({ joyeria: { ...JOYERIA, acabados: undefined } });
    assert.ok(!html.includes('id="acabados"'));
  });
});

describe("botones flotantes", () => {
  it("WhatsApp lleva al número del negocio en pestaña nueva y sin enviar el origen; «Volver arriba» arranca oculto y fuera del orden de tabulación", () => {
    const html = inicio();
    assert.ok(html.includes(`<a href="https://wa.me/${WHATSAPP}" target="_blank" rel="noopener noreferrer" class="joy-whatsapp" aria-label="Escríbenos por WhatsApp">`));
    assert.ok(/<button type="button" class="joy-arriba" data-visible="false" aria-label="Volver arriba" tabindex="-1">/.test(html));
  });

  it("sin un WhatsApp válido no hay botón de WhatsApp (nunca un botón que no lleva a ningún lado)", () => {
    const html = inicio({ whatsapp: null });
    assert.ok(!html.includes("joy-whatsapp") && !html.includes("wa.me"));
    assert.ok(html.includes("joy-arriba"));
  });
});

describe("lo que NO cambia", () => {
  it("sin videos configurados la portada es la de siempre (sin carrusel) y no hay bloques de video; los textos de la vitrina siguen siendo los mismos", () => {
    const { portada, coleccion, marca, acabados, ...sinVideos } = JOYERIA;
    void portada;
    void coleccion;
    void marca;
    void acabados;
    const html = inicio({ joyeria: { ...sinVideos, mayoristas: { ...JOYERIA.mayoristas!, video: undefined } } });
    assert.ok(html.includes('data-joy-hero=""') && html.includes("Historias que brillan contigo"));
    const enPortada = html.slice(pos(html, 'data-joy-hero=""'), pos(html, 'data-joy-cortina=""'));
    assert.ok(!enPortada.includes("joy-slide") && !enPortada.includes("carrusel") && !enPortada.includes("joy-portada-flecha"), "la portada de siempre no es un carrusel");
    assert.equal(cuenta(enPortada, /<a /g), 1, "un solo botón, como siempre");
    assert.ok(!html.includes('id="coleccion"') && !html.includes('id="marca"') && !html.includes('id="acabados"') && !html.includes("joy-mayoristas-velo") && !html.includes("<video"));
  });

  it("si el CMS pone la portada más abajo es un bloque normal (sin carrusel) y los bloques que sobreviven al video de arriba no se dibujan; la marca y los mayoristas siguen", () => {
    const html = inicio({ config: { ...REGISTRO, secciones: ["categorias", "portada", "destacados"] } });
    assert.ok(!html.includes("data-joy-hero") && !html.includes("joy-portada-flecha") && !html.includes('id="coleccion"') && !html.includes('id="acabados"'));
    assert.ok(html.includes('id="marca"') && html.includes('id="mayoristas"'));
    assert.equal(cuenta(html, /<h1[ >]/g), 1);
  });

  it("sin portada no hay carrusel ni colección, pero la página conserva su h1 y la marca va antes del resto cuando no hay categorías", () => {
    const html = inicio({ config: { ...REGISTRO, secciones: ["destacados"] } });
    assert.ok(!html.includes("joy-portada-flecha") && !html.includes('id="coleccion"'));
    assert.equal(cuenta(html, /<h1 class="sr-only">/g), 1);
    assert.ok(pos(html, 'id="marca"') < pos(html, 'id="joy-destacados"'), "sin categorías, la marca abre el contenido");
  });

  it("ningún video lleva el atributo autoplay en el HTML y los contenedores de video son decorativos (aria-hidden)", () => {
    const html = inicio();
    assert.ok(!/autoplay/i.test(html));
    const contenedores = html.match(/<div class="joy-video [^>]*>/g) ?? [];
    assert.equal(contenedores.length, 4, "portada, colección, marca y mayoristas");
    for (const c of contenedores) assert.ok(c.includes('aria-hidden="true"'), c);
    assert.ok(!/video\/\w+(-[hv])?\.mp4/.test(html), "el archivo de ningún video se nombra en el HTML (se pide solo cuando hace falta)");
    assert.ok(sinEtiquetas(html).length > 0);
  });

  it("el texto del CMS se escapa también en la diapositiva de marca y la portada con video", () => {
    const html = inicio({ config: { ...REGISTRO, heroTitle: "<img src=x onerror=alert(1)>", brand: { name: "<b>Marca</b>", descriptor: "<i>x</i>" } } });
    assert.ok(!html.includes("<img src=x") && !html.includes("<b>Marca") && !html.includes("<i>x</i>"));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;") && html.includes("&lt;b&gt;Marca&lt;/b&gt;"));
  });
});
