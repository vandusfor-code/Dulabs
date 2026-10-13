/**
 * Tema "joyeria" (Bloque 30) — lo puro: qué tema usa cada negocio, qué anuncios y bloque de mayoristas se pueden mostrar, y que el contenido editorial de Delacour no inventa nada
 * (ni precios, ni descuentos, ni plazos, ni envíos). Solo presentación: ninguna de estas funciones toca precios, stock ni carrito.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anunciosVisibles, digitosWhatsapp, enlaceWhatsapp, mayoristasVisible, rotuloDeDestacados } from "@/lib/catalogo/joyeria";
import { joyeriaOf, storefrontConfigFor, temaDe, tecnologiaOf, type CatalogStorefrontConfig, type ConfigJoyeria } from "@/lib/catalogo/vitrina";

const CONTENIDO: ConfigJoyeria = {
  anuncios: [
    { texto: "Te asesoramos por WhatsApp", enlace: "whatsapp" },
    { texto: "Solo texto" },
    { texto: "   ", enlace: "whatsapp" },
  ],
  mayoristas: { etiqueta: "Compras por mayor", titulo: "Compra al por mayor", texto: "Escríbenos.", boton: "Hablar con una asesora", mensaje: "Hola, quiero comprar al por mayor." },
  descripcion: "Frase del pie.",
};

describe("tema de la vitrina: joyería", () => {
  it('"joyeria" solo con el tema pedido Y su contenido (nunca una vitrina a medias)', () => {
    assert.equal(temaDe({ tema: "joyeria", joyeria: CONTENIDO }), "joyeria");
    assert.equal(temaDe({ tema: "joyeria" }), "clasico", "sin contenido no hay vitrina de joyería");
    assert.equal(temaDe({ joyeria: CONTENIDO }), "clasico", "con el tema clásico el contenido de joyería no se usa");
    assert.equal(temaDe({ tema: "tecnologia", joyeria: CONTENIDO }), "clasico", "un tema no se confunde con el otro");
    assert.equal(joyeriaOf({ tema: "joyeria", joyeria: CONTENIDO }), CONTENIDO);
    assert.equal(joyeriaOf({ joyeria: CONTENIDO }), null);
    assert.equal(joyeriaOf({}), null);
  });

  it("por publicación: solo Delacour usa joyería; ASLC sigue en tecnología y los demás, en el clásico", () => {
    assert.equal(temaDe(storefrontConfigFor("delacour")), "joyeria");
    assert.ok(joyeriaOf(storefrontConfigFor("delacour")));
    assert.equal(tecnologiaOf(storefrontConfigFor("delacour")), null);
    assert.equal(temaDe(storefrontConfigFor("aqui-si-lo-compras")), "tecnologia");
    assert.equal(joyeriaOf(storefrontConfigFor("aqui-si-lo-compras")), null);
    assert.equal(temaDe(storefrontConfigFor("otro-negocio")), "clasico");
  });

  it("el contenido de Delacour no inventa datos comerciales: ni precios, ni descuentos, ni plazos, ni envíos, ni garantías", () => {
    const j = joyeriaOf(storefrontConfigFor("delacour"));
    assert.ok(j);
    const todo = JSON.stringify(j);
    assert.doesNotMatch(todo, /\$\s?\d|\d+\s?%|\b\d+\s?(d[ií]as|horas)\b/i, "ni precios, ni descuentos, ni plazos");
    assert.doesNotMatch(todo, /env[ií]o|garant[ií]a|devoluci|gratis|m[aá]s vendid|descuento|oferta/i, "ni envíos, ni garantías, ni «más vendidos», ni promociones inventadas");
    assert.ok(j.anuncios.length >= 1 && j.anuncios.every((a) => a.texto.trim().length > 0));
    assert.ok(j.mayoristas, "Delacour tiene compradores mayoristas");
  });

  it("el CMS comercial conserva el tema del negocio (el contenido editorial sigue saliendo del registro, no del CMS)", () => {
    const cfg: CatalogStorefrontConfig = storefrontConfigFor("delacour");
    assert.equal(cfg.tema, "joyeria");
    assert.ok(cfg.joyeria);
    assert.ok(cfg.heroImage, "la portada de siempre sigue en el registro (el CMS puede reemplazarla)");
  });
});

describe("WhatsApp del tema joyería", () => {
  it("un número es utilizable con 8 dígitos o más; el resto no", () => {
    assert.equal(digitosWhatsapp("+57 300 111 2233"), "573001112233");
    assert.equal(digitosWhatsapp("1234567"), null);
    assert.equal(digitosWhatsapp(""), null);
    assert.equal(digitosWhatsapp(null), null);
    assert.equal(digitosWhatsapp(undefined), null);
  });

  it("el enlace lleva al número (con el mensaje bien codificado, si hay) y es null sin número válido", () => {
    assert.equal(enlaceWhatsapp("573001112233"), "https://wa.me/573001112233");
    assert.equal(enlaceWhatsapp("573001112233", "Hola, ¿qué tal?"), `https://wa.me/573001112233?text=${encodeURIComponent("Hola, ¿qué tal?")}`);
    assert.equal(enlaceWhatsapp(null, "Hola"), null);
    assert.equal(enlaceWhatsapp("123"), null);
  });
});

describe("anuncios y mayoristas visibles", () => {
  it("con WhatsApp válido salen los anuncios con texto; los de WhatsApp llevan el enlace y el vacío no sale", () => {
    const v = anunciosVisibles(CONTENIDO, "573001112233");
    assert.deepEqual(v, [
      { texto: "Te asesoramos por WhatsApp", href: "https://wa.me/573001112233" },
      { texto: "Solo texto", href: null },
    ]);
  });

  it("sin WhatsApp válido, un anuncio que lo necesita NO se muestra (nunca un enlace a la nada) y los de solo texto sí", () => {
    assert.deepEqual(anunciosVisibles(CONTENIDO, null), [{ texto: "Solo texto", href: null }]);
    assert.deepEqual(anunciosVisibles({ anuncios: [{ texto: "Escríbenos", enlace: "whatsapp" }] }, "123"), [], "sin anuncios no hay barra");
  });

  it("el bloque de mayoristas existe solo con contenido Y un WhatsApp al que escribir; el mensaje llega escrito", () => {
    const m = mayoristasVisible(CONTENIDO, "573001112233");
    assert.ok(m);
    assert.equal(m.titulo, "Compra al por mayor");
    assert.equal(m.href, `https://wa.me/573001112233?text=${encodeURIComponent("Hola, quiero comprar al por mayor.")}`);
    assert.equal("mensaje" in m, false, "el mensaje no es parte de lo que se dibuja");
    assert.equal(mayoristasVisible(CONTENIDO, null), null);
    assert.equal(mayoristasVisible({ anuncios: [] }, "573001112233"), null);
  });
});

describe("rótulo de los productos del inicio", () => {
  it("lo más reciente son «Novedades»; lo elegido a mano en el CMS es una selección; nunca «más vendidos»", () => {
    assert.deepEqual(rotuloDeDestacados("recent-with-photo"), { etiqueta: "Nuevas piezas", titulo: "Novedades" });
    assert.deepEqual(rotuloDeDestacados("recent"), { etiqueta: "Nuevas piezas", titulo: "Novedades" });
    assert.deepEqual(rotuloDeDestacados("cms"), { etiqueta: "Selección", titulo: "Productos destacados" });
    for (const p of ["recent-with-photo", "recent", "cms"] as const) assert.doesNotMatch(JSON.stringify(rotuloDeDestacados(p)), /vendid|favorit|popular/i);
  });
});
