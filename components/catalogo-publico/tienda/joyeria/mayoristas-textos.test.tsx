/**
 * La tienda de joyería con los TEXTOS de «Compras por mayor» que la administradora publicó (lo que llega en el HTML del servidor): el inicio y la página de mayoristas dicen lo que ella escribió, el botón
 * abre WhatsApp con SU mensaje, lo que no cambió sigue igual, y sin nada publicado el HTML es exactamente el de hoy. Los textos se pintan escapados: nada de lo escrito puede volverse HTML.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, HOME_COMPLETO, LISTA, NOMBRE_NEGOCIO } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { PaginaMayoristasJoyeria } from "@/components/catalogo-publico/tienda/joyeria/PaginaMayoristasJoyeria";
import { TiendaInicioJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { mayoristasVisible } from "@/lib/catalogo/joyeria";
import { joyeriaOf, storefrontConfigFor } from "@/lib/catalogo/vitrina";
import { aplicarTextosMayoristas } from "@/lib/cms-comercial/mayoristas-textos";
import { aplicarMultimedia, multimediaDesdeCms, type MultimediaTienda } from "@/lib/cms-comercial/multimedia-tienda";
import { instantanea, multimedia, publicada } from "@/lib/cms-comercial/testing/fixtures";

const WHATSAPP = "573000000000";
const REGISTRO = storefrontConfigFor("delacour");
const JOYERIA = joyeriaOf(REGISTRO)!;
const NUEVOS = { etiqueta: "Venta mayorista", titulo: "Surte tu negocio con nosotros", texto: "Cuéntanos qué necesitas y te asesoramos.", boton: "Escríbenos ahora", mensaje: "Hola, quiero surtir mi negocio." } as const;
const MENSAJE_DE_SIEMPRE = "comprar%20al%20por%20mayor";
const MENSAJE_NUEVO = "https://wa.me/573000000000?text=Hola%2C%20quiero%20surtir%20mi%20negocio.";

const publicadas = (textos: Record<string, string>): MultimediaTienda | null => multimediaDesdeCms(instantanea({ multimedia: publicada("multimedia", multimedia({ mayoristas: textos })) }), "delacour");

function inicio(m: MultimediaTienda | null): string {
  return renderToStaticMarkup(
    <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp={WHATSAPP}>
      <TiendaInicioJoyeria home={HOME_COMPLETO} config={REGISTRO} joyeria={aplicarMultimedia(JOYERIA, m)} basePath={BASE} listPath={LISTA} businessName={NOMBRE_NEGOCIO} whatsapp={WHATSAPP} acabados={null} />
    </TiendaProvider>,
  );
}
const pagina = (m: MultimediaTienda | null) => renderToStaticMarkup(<PaginaMayoristasJoyeria m={mayoristasVisible(aplicarMultimedia(JOYERIA, m), WHATSAPP)!} pagina={null} />);
const cuenta = (h: string, texto: string) => h.split(texto).length - 1;

describe("el inicio con los textos de «Compras por mayor» publicados", () => {
  const DE_SIEMPRE = inicio(null);
  const h = inicio(publicadas({ ...NUEVOS }));

  it("sin nada publicado, o con textos iguales a los de siempre, el HTML es EXACTAMENTE el de hoy", () => {
    assert.equal(inicio({ videos: {}, categorias: new Map() }), DE_SIEMPRE);
    assert.equal(inicio(publicadas({ titulo: "Compra al por mayor", boton: "Hablar con una asesora" })), DE_SIEMPRE);
    assert.ok(DE_SIEMPRE.includes("Compra al por mayor") && DE_SIEMPRE.includes("Hablar con una asesora") && DE_SIEMPRE.includes(MENSAJE_DE_SIEMPRE));
  });

  it("el bloque dice lo que ella escribió y ya no lo de siempre", () => {
    for (const texto of [NUEVOS.etiqueta, NUEVOS.titulo, NUEVOS.texto, NUEVOS.boton]) assert.ok(h.includes(texto), `falta «${texto}»`);
    for (const viejo of ["Compras por mayor", "Compra al por mayor", "Escríbenos por WhatsApp y una asesora te atiende.", "Hablar con una asesora"]) {
      // «Compras por mayor» también está en la barra de anuncios de la tienda (otro texto, que no se cambia aquí): el bloque ya no lo usa.
      if (viejo === "Compras por mayor") continue;
      assert.ok(!h.includes(viejo), `no debe quedar «${viejo}»`);
    }
  });

  it("el botón abre WhatsApp con SU mensaje, en pestaña nueva y sin el mensaje de siempre", () => {
    assert.ok(h.includes(`href="${MENSAJE_NUEVO}"`));
    assert.ok(!h.includes(`href="https://wa.me/573000000000?text=Hola%2C%20quiero%20informaci%C3%B3n%20para%20comprar%20al%20por%20mayor.`), "el mensaje de siempre ya no es el del bloque");
    const enlace = h.match(/<a [^>]*href="https:\/\/wa\.me\/573000000000\?text=Hola%2C%20quiero%20surtir[^"]*"[^>]*>/)?.[0] ?? "";
    assert.ok(enlace.includes('target="_blank"') && enlace.includes('rel="noopener noreferrer"'));
  });

  it("cambiar solo el título deja el resto del bloque como siempre", () => {
    const solo = inicio(publicadas({ titulo: NUEVOS.titulo }));
    assert.ok(solo.includes(NUEVOS.titulo));
    for (const igual of ["Escríbenos por WhatsApp y una asesora te atiende.", "Hablar con una asesora", MENSAJE_DE_SIEMPRE]) assert.ok(solo.includes(igual), igual);
  });

  it("lo demás del inicio no cambia: el HTML solo difiere en el bloque de mayoristas", () => {
    const sinBloque = (html: string) => html.replace(/<section[^>]*id="mayoristas"[\s\S]*?<\/section>/, "");
    assert.ok(sinBloque(DE_SIEMPRE) !== DE_SIEMPRE, "el bloque se encontró");
    assert.equal(sinBloque(h), sinBloque(DE_SIEMPRE));
  });
});

describe("la página de mayoristas con los textos publicados", () => {
  const h = pagina(publicadas({ ...NUEVOS }));

  it("el título es el h1 (uno solo), con su etiqueta, y el texto corto hace de introducción cuando no hay una publicada", () => {
    assert.equal(cuenta(h, "<h1"), 1);
    assert.match(h, new RegExp(`<h1[^>]*>${NUEVOS.titulo}</h1>`));
    assert.ok(h.includes(NUEVOS.etiqueta));
    assert.ok(h.includes(NUEVOS.texto));
  });

  it("los dos botones (arriba y al cierre) dicen lo nuevo y llevan el mensaje nuevo", () => {
    assert.equal(cuenta(h, NUEVOS.boton), 2);
    assert.equal(cuenta(h, `href="${MENSAJE_NUEVO}"`), 2);
    assert.ok(!h.includes("Hablar con una asesora") && !h.includes(MENSAJE_DE_SIEMPRE));
  });

  it("sin nada publicado la página es la de siempre", () => {
    const antes = pagina(null);
    assert.equal(pagina({ videos: {}, categorias: new Map() }), antes);
    assert.ok(antes.includes("Compra al por mayor") && antes.includes("Hablar con una asesora"));
  });
});

describe("lo escrito se pinta como texto, nunca como HTML", () => {
  it("aunque llegara con etiquetas (el CMS ya las rechaza al publicar), el navegador solo las vería como letras", () => {
    const hostil = aplicarTextosMayoristas(JOYERIA.mayoristas!, { titulo: '<img src=x onerror="alert(1)">Oferta', boton: "<script>alert(1)</script>", etiqueta: '"><b>x</b>' });
    const h = renderToStaticMarkup(<PaginaMayoristasJoyeria m={mayoristasVisible({ ...JOYERIA, mayoristas: hostil }, WHATSAPP)!} pagina={null} />);
    assert.ok(!h.includes("<img src=x") && !h.includes("<script>alert") && !h.includes("<b>x</b>"));
    assert.ok(h.includes("&lt;img src=x") && h.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  });

  it("un mensaje con caracteres especiales viaja codificado en la dirección de WhatsApp y no la rompe", () => {
    const m = publicadas({ mensaje: 'Hola & "adiós" <b>?</b>#1' });
    const visible = mayoristasVisible(aplicarMultimedia(JOYERIA, m), WHATSAPP)!;
    const url = new URL(visible.href);
    assert.equal(url.searchParams.get("text"), 'Hola & "adiós" <b>?</b>#1');
    assert.equal(url.hash, "", "el # del texto no se vuelve ancla");
    assert.ok(!visible.href.includes('"') && !visible.href.includes("<"));
  });
});
