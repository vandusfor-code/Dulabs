/**
 * Tema "joyeria" (Bloque 30) — lo puro: qué tema usa cada negocio, qué anuncios y bloque de mayoristas se pueden mostrar, y que el contenido editorial de Delacour no inventa nada
 * (ni precios, ni descuentos, ni plazos, ni envíos). Solo presentación: ninguna de estas funciones toca precios, stock ni carrito.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
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

describe("reglas de CSS que protegen la experiencia (guardas de la fuente)", () => {
  const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
  const regla = (selector: string) => {
    const i = css.indexOf(selector + " {");
    assert.ok(i >= 0, `falta la regla ${selector}`);
    return css.slice(i, css.indexOf("}", i));
  };

  it("el esqueleto de carga ocupa toda la pantalla: el pie, que ya está en el marco, no salta (CLS) cuando llega el contenido", () => {
    assert.match(regla(".tienda-joyeria .joy-esqueleto"), /min-height:\s*100svh/);
  });

  it("el vidrio de los botones sobre la foto lleva un tinte oscuro (el texto blanco se lee también sobre fotos claras)", () => {
    const r = regla(".tienda-joyeria .joy-cristal");
    assert.match(r, /background-color:\s*rgb\(42 37 33 \/ 0\.6\)/);
    assert.doesNotMatch(r, /background-color:\s*rgb\(255 255 255/);
  });

  it("el texto de la portada se lee (AA) sobre la foto: blanco sólido (no 90 %) y un velo que no baja de 0,58 (celular, al 36 %) / 0,5 (pantallas medianas, al 40 %)", () => {
    const movil = regla(".tienda-joyeria .joy-hero-velo");
    assert.match(movil, /rgb\(42 28 18 \/ 0\.58\) 36%/);
    const escritorio = css.match(/@media \(min-width: 768px\) \{\n  \.tienda-joyeria \.joy-hero-velo \{[^}]*\}/);
    assert.ok(escritorio, "existe el velo para pantallas medianas");
    assert.match(escritorio[0], /rgb\(42 28 18 \/ 0\.5\) 40%/);
    const hero = readFileSync(path.join(process.cwd(), "components/catalogo-publico/tienda/joyeria/HeroJoyeria.tsx"), "utf8");
    assert.doesNotMatch(hero, /text-white\/\d+/, "ni la etiqueta ni la descripción de la portada llevan transparencia");
  });

  it("la referencia sobre la foto (componente compartido) lleva el fondo firme de esta tienda en la tarjeta y en la galería: se lee también sobre las fotos claras", () => {
    assert.match(regla(".tienda-joyeria .joy-ref"), /background-color:\s*rgb\(0 0 0 \/ 0\.62\)/);
    for (const archivo of ["TarjetaJoyeria.tsx", "GaleriaJoyeria.tsx"]) {
      const fuente = readFileSync(path.join(process.cwd(), "components/catalogo-publico/tienda/joyeria", archivo), "utf8");
      assert.match(fuente, /<MarcaReferencia [^>]*className="joy-ref /, `${archivo} pasa joy-ref a la referencia`);
    }
  });

  it("tres tiempos medidos en la referencia se conservan: el filete empieza a 0,8 s (a la vez que el botón), la foto de categoría crece en 0,6 s y el velo del menú es 0,35 con 8 px de desenfoque", () => {
    assert.match(css, /\.tienda-joyeria \.joy-linea \{\n    width: 0;\n    animation: joy-linea 0\.8s ease-out 0\.8s forwards;/);
    assert.match(css, /\.tienda-joyeria \.joy-cat-foto \{\n  transition: transform 0\.6s cubic-bezier\(0, 0, 0\.2, 1\);\n\}/);
    const velo = regla(".tienda-joyeria dialog.joy-menu::backdrop");
    assert.match(velo, /background:\s*rgb\(30 25 20 \/ 0\.35\)/);
    assert.match(velo, /backdrop-filter:\s*blur\(8px\)/);
  });

  it("la aparición al hacer scroll conserva lo ajustado sobre la referencia: contenedor de 0,6 s y tarjetas de 0,4 s con 70 ms por posición; el botón de la portada entra a 0,7 s", () => {
    assert.match(css, /\.tienda-joyeria \.tienda-aparece \{\n    animation: tienda-revelar 600ms ease-out both;\n  \}/);
    assert.match(css, /\.tienda-joyeria \.tienda-aparece \.joy-item \{\n    animation: tienda-revelar 400ms ease-out both;\n    animation-delay: calc\(var\(--i, 0\) \* 70ms\);/);
    const hero = readFileSync(path.join(process.cwd(), "components/catalogo-publico/tienda/joyeria/HeroJoyeria.tsx"), "utf8");
    assert.match(hero, /className="joy-ent mt-8" style=\{retardo\(0\.7\)\}/);
  });

  it("todo el movimiento de la portada está bajo prefers-reduced-motion: no-preference, y con movimiento reducido la portada no queda fija", () => {
    const inicio = css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  .tienda-joyeria .joy-destellos");
    assert.ok(inicio >= 0, "existe el bloque de movimiento permitido");
    const sinMovimiento = css.slice(inicio);
    for (const clase of [".joy-ent {", ".joy-linea {", ".joy-titulo-brillo {", ".joy-destello {"]) assert.ok(sinMovimiento.includes(clase), `${clase} dentro del bloque de movimiento permitido`);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \/\* Sin movimiento: la portada no queda fija[\s\S]*?position: relative;/);
  });
});
