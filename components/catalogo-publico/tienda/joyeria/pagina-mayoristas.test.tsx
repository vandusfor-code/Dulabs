/**
 * Página «Mayoristas» del tema "joyeria" (/catalogo/{tienda}/mayoristas): qué se dibuja y lo que NUNCA se muestra (una sección vacía, un monto inventado, un enlace o un precio mayorista, texto del CMS sin
 * escapar). Es HTML del servidor: lo que llega al navegador sin esperar a ningún script. El contenido sale del CMS (pagina-mayoristas.test.ts); aquí solo cuenta cómo se dibuja.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PaginaMayoristasJoyeria } from "@/components/catalogo-publico/tienda/joyeria/PaginaMayoristasJoyeria";
import { mayoristasVisible, type MayoristasVisible } from "@/lib/catalogo/joyeria";
import { joyeriaOf, storefrontConfigFor } from "@/lib/catalogo/vitrina";
import type { PaginaMayoristas } from "@/lib/cms-comercial/pagina-mayoristas";

const WHATSAPP = "573000000000";
const JOYERIA = joyeriaOf(storefrontConfigFor("delacour"))!;
const M = mayoristasVisible(JOYERIA, WHATSAPP)!;
const MENSAJE = "https://wa.me/573000000000?text=Hola%2C%20quiero%20informaci%C3%B3n%20para%20comprar%20al%20por%20mayor.";

const PAGINA: PaginaMayoristas = {
  intro: { titulo: "Venta al por mayor", texto: "Manejamos venta al por mayor para emprendimientos y negocios.\nEscoges las referencias del inventario disponible." },
  preguntas: [
    { clave: "como-compro", titulo: "¿Cómo compro al por mayor?", texto: "Escríbenos por WhatsApp y elige «Compra por mayor»." },
    { clave: "compra-minima", titulo: "¿Cuál es la compra mínima?", texto: "La compra inicial parte de $750.000.\nEl valor se mide sobre lo que realmente pagas." },
    { clave: "envios", titulo: "Envíos", texto: "Sí hacemos envíos." },
  ],
};

const html = (pagina: PaginaMayoristas | null = PAGINA, m: MayoristasVisible = M) => renderToStaticMarkup(<PaginaMayoristasJoyeria m={m} pagina={pagina} />);
const cuenta = (h: string, patron: RegExp) => (h.match(patron) ?? []).length;
const pos = (h: string, texto: string) => {
  const i = h.indexOf(texto);
  assert.ok(i >= 0, `falta «${texto}»`);
  return i;
};
const visible = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** Lo mismo que la configuración de Delacour, pero sin su video de fondo. */
const sinVideo: MayoristasVisible = { etiqueta: M.etiqueta, titulo: M.titulo, texto: M.texto, boton: M.boton, href: M.href, pagina: M.pagina };

describe("página de mayoristas — con todo publicado", () => {
  const h = html();

  it("una portada con el título como h1 (uno solo) y la introducción en párrafos", () => {
    assert.equal(cuenta(h, /<h1[ >]/g), 1);
    assert.ok(h.includes('aria-labelledby="joy-may-titulo"') && h.includes('<h1 id="joy-may-titulo"'));
    assert.match(h, /<h1[^>]*>Compra al por mayor<\/h1>/);
    assert.ok(h.includes("Compras por mayor"), "la etiqueta sobre el título");
    assert.ok(h.includes("<p>Manejamos venta al por mayor para emprendimientos y negocios.</p>") && h.includes("<p>Escoges las referencias del inventario disponible.</p>"), "un párrafo por línea del texto del CMS");
  });

  it("el botón de WhatsApp está arriba y al cierre: pestaña nueva, sin enviar el origen y con el mensaje escrito", () => {
    const enlaces = h.match(/<a [^>]*href="https:\/\/wa\.me\/[^"]*"[^>]*>/g) ?? [];
    assert.equal(enlaces.length, 2, "uno en la portada y otro al cierre");
    for (const e of enlaces) {
      assert.ok(e.includes(`href="${MENSAJE}"`), "mensaje escrito");
      assert.ok(e.includes('target="_blank"') && e.includes('rel="noopener noreferrer"'));
      assert.ok(e.includes("joy-cristal"));
    }
    assert.equal(cuenta(h, /Hablar con una asesora/g), 2);
    assert.ok(pos(h, MENSAJE) < pos(h, 'id="preguntas"'), "el primero, arriba");
    assert.ok(h.lastIndexOf(MENSAJE) > pos(h, 'id="preguntas"'), "el último, al cierre");
  });

  it("las preguntas frecuentes son `<details>` nativos (se abren con teclado y sin JavaScript), una por entrada, en el orden del CMS y cerradas al llegar", () => {
    const seccion = h.slice(pos(h, 'id="preguntas"'), pos(h, 'aria-labelledby="joy-may-cierre"'));
    assert.equal(cuenta(seccion, /<details /g), 3);
    assert.equal(cuenta(seccion, /name="joy-preguntas-mayoristas"/g), 3, "se abre una a la vez");
    assert.ok(!/<details[^>]* open/.test(seccion), "todas cerradas");
    assert.equal(cuenta(seccion, /<summary /g), 3);
    const orden = ["¿Cómo compro al por mayor?", "¿Cuál es la compra mínima?", "Envíos"].map((t) => pos(seccion, t));
    assert.deepEqual([...orden].sort((a, b) => a - b), orden);
    assert.ok(seccion.includes("<p>La compra inicial parte de $750.000.</p>") && seccion.includes("<p>El valor se mide sobre lo que realmente pagas.</p>"), "cada línea de la respuesta es un párrafo");
    assert.ok(/<summary[^>]*>[\s\S]*?<svg[^>]*aria-hidden="true"/.test(seccion), "la flecha es decorativa");
    assert.ok(seccion.includes('<ul class="joy-preguntas" role="list">'));
  });

  it("desde la portada hay un enlace a las preguntas (ancla de la misma página)", () => {
    assert.ok(h.includes('href="#preguntas"'));
    assert.ok(visible(h).includes("Ver preguntas frecuentes"));
    assert.ok(pos(h, 'href="#preguntas"') < pos(h, 'id="preguntas"'));
    assert.ok(/<section id="preguntas"[^>]*class="[^"]*joy-ancla/.test(h), "el ancla descuenta la cabecera fija");
  });

  it("jerarquía de títulos sin saltos: un h1, dos h2 (preguntas y cierre) y ningún h3", () => {
    assert.deepEqual([cuenta(h, /<h1[ >]/g), cuenta(h, /<h2[ >]/g), cuenta(h, /<h3[ >]/g)], [1, 2, 0]);
    for (const id of ["joy-may-titulo", "joy-may-preguntas", "joy-may-cierre"]) {
      assert.ok(h.includes(`aria-labelledby="${id}"`) && h.includes(`id="${id}"`), id);
    }
  });

  it("el cierre invita a escribir por WhatsApp y la página entera deja sitio bajo la cabecera fija", () => {
    assert.ok(visible(h).includes("¿Tienes otra pregunta?") && visible(h).includes("Escríbenos por WhatsApp y una asesora te atiende."));
    assert.ok(h.startsWith('<div class="joy-compensa">'));
  });

  it("el video de la tienda corre DETRÁS del texto, con su velo para que se lea y su botón de pausa", () => {
    assert.ok(h.includes("/catalogo/delacour/video/mayoristas.webp") && h.includes("joy-mayoristas-velo") && h.includes('aria-label="Pausar video de compras por mayor"'));
    assert.ok(pos(h, "joy-mayoristas-velo") < pos(h, "Compra al por mayor"), "el video queda detrás del texto");
  });

  it("nunca muestra un precio, un token ni el enlace del catálogo mayorista (eso solo lo da una asesora)", () => {
    assert.ok(!h.includes("/mayor/") && !/token/i.test(h));
    assert.ok(!/\$\s?\d{1,3}(\.\d{3})+/.test(h.split("$750.000").join("")), "el único monto de la página es el que publicó el CMS");
  });
});

describe("página de mayoristas — con menos de lo publicado nunca queda nada vacío ni inventado", () => {
  it("sin nada del CMS (página null): solo el título, la frase de la tienda y el botón; sin preguntas, sin monto, sin enlace a preguntas", () => {
    const h = html(null);
    assert.equal(cuenta(h, /<h1[ >]/g), 1);
    assert.ok(visible(h).includes("Escríbenos por WhatsApp y una asesora te atiende."));
    assert.ok(!h.includes('id="preguntas"') && !h.includes("<details") && !h.includes("Ver preguntas frecuentes"));
    assert.ok(!/\$\s?\d/.test(visible(h)), "ningún monto: la página no inventa cifras que el CMS no publicó");
    assert.equal(cuenta(h, /<h2[ >]/g), 1, "solo el cierre");
    assert.equal(cuenta(h, /href="https:\/\/wa\.me\//g), 2, "el botón sigue arriba y al cierre");
  });

  it("sin introducción publicada se usa la frase de la tienda; las preguntas siguen", () => {
    const h = html({ ...PAGINA, intro: null });
    assert.ok(visible(h).includes("Escríbenos por WhatsApp y una asesora te atiende."));
    assert.equal(cuenta(h, /<details /g), 3);
  });

  it("sin preguntas publicadas no hay sección de preguntas ni el enlace a ella, aunque haya introducción", () => {
    const h = html({ ...PAGINA, preguntas: [] });
    assert.ok(!h.includes('id="preguntas"') && !h.includes('href="#preguntas"') && !h.includes("Ver preguntas frecuentes"));
    assert.ok(h.includes("<p>Manejamos venta al por mayor"));
  });

  it("sin video en la configuración no hay video ni velo, y la etiqueta usa el dorado claro", () => {
    const h = html(PAGINA, sinVideo);
    assert.ok(!h.includes("<video") && !h.includes("joy-mayoristas-velo") && !h.includes("Pausar video"));
    assert.ok(h.includes("text-[var(--joy-oro-claro)]"));
  });

  it("el texto del CMS se muestra como TEXTO: ningún HTML ni script del contenido llega al navegador", () => {
    const h = html({ intro: { titulo: "x", texto: "<img src=x onerror=alert(1)> Hola" }, preguntas: [{ clave: "xss", titulo: "<script>alert(1)</script>", texto: "<b>negrita</b> & más" }] }, sinVideo);
    assert.ok(!h.includes("<script") && !h.includes("<img") && !h.includes("<b>"), "sin video, la página no trae ninguna etiqueta de imagen: todo lo que parece una es texto");
    assert.ok(h.includes("&lt;img src=x onerror=alert(1)&gt; Hola"));
    assert.ok(h.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && h.includes("&lt;b&gt;negrita&lt;/b&gt; &amp; más"));
  });
});
