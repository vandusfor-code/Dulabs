/**
 * Inicio del tema "joyeria" (Delacour, Bloque 30): qué se dibuja, en qué orden, y lo que NUNCA se muestra (un bloque vacío, una portada a medias, un enlace a la nada, un dato inventado).
 * Es la contraparte de inicio-cms.test.tsx para el diseño nuevo: las MISMAS secciones y datos que publica el CMS, con otro dibujo. El inicio clásico no cambia (inicio-dorado.test.tsx).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, CATEGORIAS_PRUEBA, HOME_COMPLETO, HOME_VACIO, LISTA, NOMBRE_NEGOCIO, producto } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { PieJoyeria } from "@/components/catalogo-publico/tienda/joyeria/PieJoyeria";
import { TarjetaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TarjetaJoyeria";
import { TiendaInicioJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { formatCop } from "@/lib/business-agent-quote";
import type { PublicHome } from "@/lib/catalogo/service";
import { joyeriaOf, storefrontConfigFor, type CatalogStorefrontConfig, type ComboVitrina, type OfertaVitrina } from "@/lib/catalogo/vitrina";

const WHATSAPP = "573000000000";
const REGISTRO = storefrontConfigFor("delacour");
const JOYERIA = joyeriaOf(REGISTRO)!;

function inicio(config: CatalogStorefrontConfig, home: PublicHome = HOME_COMPLETO, whatsapp: string | null = WHATSAPP): string {
  return renderToStaticMarkup(
    <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp={whatsapp}>
      <TiendaInicioJoyeria home={home} config={config} joyeria={JOYERIA} basePath={BASE} listPath={LISTA} businessName={NOMBRE_NEGOCIO} whatsapp={whatsapp} />
    </TiendaProvider>,
  );
}
const cuenta = (html: string, patron: RegExp) => (html.match(patron) ?? []).length;
const pos = (html: string, texto: string) => {
  const i = html.indexOf(texto);
  assert.ok(i >= 0, `falta «${texto}»`);
  return i;
};
const imagen = (alt: string) => ({ src: `${BASE}/vitrina/a0000000-0000-4000-8000-000000000001.webp`, width: 1600, height: 900, alt });

describe("inicio joyería — la vitrina de Delacour de hoy", () => {
  const html = inicio(REGISTRO);

  it("portada a pantalla completa con el texto como HTML real y un solo h1; el botón lleva al listado", () => {
    assert.ok(html.includes('data-joy-hero=""'));
    assert.equal(cuenta(html, /<h1[ >]/g), 1);
    for (const t of ["Historias que brillan contigo", "Más que joyas", "Diseños únicos para cada momento de tu vida.", "Ver catálogo"]) assert.ok(html.includes(t), t);
    const portada = html.slice(pos(html, 'data-joy-hero=""'), pos(html, 'data-joy-cortina=""'));
    const enlaces = portada.match(/<a [^>]*>/g) ?? [];
    assert.equal(enlaces.length, 2, "la portada con video tiene dos diapositivas y un solo enlace en cada una: su botón");
    for (const enlace of enlaces) assert.ok(enlace.includes(`href="${LISTA}"`) && enlace.includes("joy-cristal"), "el botón de cada diapositiva lleva al listado completo");
    assert.ok(html.includes("joy-linea"), "el filete dorado de la portada");
    assert.ok(html.includes("joy-titulo-brillo"), "el título lleva el brillo de una sola vez");
  });

  it("la cortina (el contenido que sube sobre la portada) existe y trae las secciones en el orden de siempre, con los mayoristas al final", () => {
    assert.ok(html.includes('data-joy-cortina=""'));
    const orden = ["id=\"categorias\"", "id=\"joy-destacados\"", "El regalo perfecto siempre es una joya", "id=\"mayoristas\""].map((m) => pos(html, m));
    assert.deepEqual([...orden].sort((a, b) => a - b), orden, "categorías → destacados → banner → mayoristas");
    assert.ok(pos(html, 'data-joy-hero=""') < pos(html, 'data-joy-cortina=""'), "la portada va antes que la cortina");
  });

  it("los destacados recientes son «Novedades» (nunca «más vendidos») y cada tarjeta trae lo de siempre", () => {
    assert.ok(html.includes("Novedades"));
    assert.ok(!/más vendid/i.test(html));
    assert.equal(cuenta(html, /<article class="joy-tarjeta/g), HOME_COMPLETO.featured.length);
    assert.ok(html.includes(formatCop(91_000)), "el precio");
    assert.ok(html.includes("Precio a consultar"), "producto sin precio");
    assert.ok(html.includes("Últimas unidades"), "pocas unidades");
    assert.ok(html.includes("Agotado"), "agotado");
    assert.ok(html.includes("Agregar al carrito"), "la píldora de vidrio con el motor de carrito de siempre");
    assert.ok(html.includes(`href="${BASE}/productos/dl-000001"`), "la foto y el nombre abren la ficha");
  });

  it("las categorías son los enlaces de siempre (?categoria=) con su foto o, si no la tienen, su inicial", () => {
    for (const c of CATEGORIAS_PRUEBA) assert.ok(html.includes(`href="${BASE}?categoria=${encodeURIComponent(c.id)}"`), c.name);
    assert.ok(html.includes(CATEGORIAS_PRUEBA[0].coverUrl!), "la foto de la categoría");
    assert.ok(html.includes(">D</span>"), "la inicial cuando no hay foto (Dijes)");
  });

  it("el bloque de mayoristas abre WhatsApp en pestaña nueva, sin enviar el origen, con el mensaje escrito", () => {
    const m = html.slice(pos(html, 'id="mayoristas"'));
    assert.ok(m.includes(`href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Hola, quiero información para comprar al por mayor.")}" target="_blank" rel="noopener noreferrer"`));
    for (const t of ["Compras por mayor", "Compra al por mayor", "Hablar con una asesora"]) assert.ok(m.includes(t), t);
  });

  it("nada de lo que no hay datos aparece: sin ofertas, combos ni campaña no hay bloques de eso", () => {
    for (const marca of ['id="ofertas"', 'id="combos"', 'id="campana"', "Ofertas vigentes"]) assert.ok(!html.includes(marca), marca);
  });
});

describe("inicio joyería — sin los datos, el bloque no existe", () => {
  it("sin WhatsApp no hay bloque de mayoristas (nunca un botón que no lleva a ningún lado)", () => {
    const h = inicio(REGISTRO, HOME_COMPLETO, null);
    assert.ok(!h.includes('id="mayoristas"'));
    assert.ok(!h.includes("wa.me"));
  });

  it("sin categorías no hay carrusel; sin productos, el estado vacío de siempre; sin banner, no hay banner", () => {
    const h = inicio({ ...REGISTRO, bannerImage: undefined }, HOME_VACIO);
    assert.ok(!h.includes('id="categorias"'));
    assert.ok(h.includes("Muy pronto, nuevas piezas"));
    assert.ok(!h.includes("El regalo perfecto"));
    assert.ok(!h.includes("Ver todo el catálogo"), "sin productos no se invita a «ver todo»");
  });

  it("con las categorías que elige el CMS solo salen esas", () => {
    const h = inicio(REGISTRO, { ...HOME_COMPLETO, categories: [CATEGORIAS_PRUEBA[1]] });
    assert.equal(cuenta(h, /\?categoria=/g), 1);
  });
});

describe("inicio joyería — las secciones y el orden los decide el CMS", () => {
  it("un orden distinto se respeta y lo oculto no se dibuja", () => {
    const h = inicio({ ...REGISTRO, secciones: ["destacados", "categorias"] });
    assert.ok(pos(h, 'id="joy-destacados"') < pos(h, 'id="categorias"'));
    assert.ok(!h.includes("El regalo perfecto"), "el banner estaba oculto");
    assert.ok(!h.includes('data-joy-hero'), "sin portada no hay portada fija");
  });

  it("sin portada la página tiene su h1 (para lectores de pantalla) y deja libre el espacio del cromo fijo", () => {
    const h = inicio({ ...REGISTRO, secciones: ["categorias", "destacados"] });
    assert.equal(cuenta(h, /<h1 class="sr-only">Delacour &amp; Orus<\/h1>/g), 1);
    assert.equal(cuenta(h, /<h1[ >]/g), 1);
    assert.ok(h.includes("joy-compensa"));
    assert.ok(h.includes("joy-cortina-plana"));
    assert.ok(!h.includes("joy-hero-fijo"));
  });

  it("si el CMS pone la portada después de otra sección, es un bloque normal (sin cortina) y sigue habiendo un solo h1", () => {
    const h = inicio({ ...REGISTRO, secciones: ["categorias", "portada", "destacados"] });
    assert.ok(!h.includes("data-joy-hero"));
    assert.ok(!h.includes("joy-hero-fijo"));
    assert.equal(cuenta(h, /<h1[ >]/g), 1);
    assert.ok(pos(h, 'id="categorias"') < pos(h, "Historias que brillan contigo"));
  });

  it("una portada sin foto o sin título no se dibuja nunca a medias", () => {
    for (const parcial of [{ heroImage: undefined }, { heroTitle: undefined }]) {
      const h = inicio({ ...REGISTRO, ...parcial });
      assert.ok(!h.includes("data-joy-hero"));
      assert.ok(h.includes("joy-compensa"));
    }
  });

  it("un botón vacío (el CMS lo permite) deja la portada sin enlaces propios", () => {
    const h = inicio({ ...REGISTRO, heroCta: "" });
    const portada = h.slice(pos(h, 'data-joy-hero=""'), pos(h, 'data-joy-cortina=""'));
    assert.equal(cuenta(portada, /<a /g), 0);
  });

  it("el texto del CMS se escapa: lo que escriba la administradora nunca se ejecuta como HTML", () => {
    const h = inicio({ ...REGISTRO, heroTitle: "<img src=x onerror=alert(1)>", heroDescription: "<script>alert(2)</script>" });
    assert.ok(!h.includes("<img src=x"));
    assert.ok(!h.includes("<script>alert"));
    assert.ok(h.includes("&lt;img src=x onerror=alert(1)&gt;"));
  });

  it("los destacados elegidos a mano se rotulan como selección", () => {
    const h = inicio(REGISTRO, { ...HOME_COMPLETO, featuredPolicy: "cms" });
    assert.ok(h.includes("Productos destacados"));
    assert.ok(!h.includes(">Novedades<"));
  });
});

describe("inicio joyería — campaña, ofertas y combos del CMS", () => {
  const OFERTAS: OfertaVitrina[] = [
    { clave: "AMOR-20", nombre: "Amor y Amistad", beneficio: "20% de descuento", alcance: "Toda la tienda", vigencia: "hasta el 31 de octubre de 2026", condiciones: "Hasta agotar existencias.", descripcion: "Todo con descuento.", href: LISTA, imagen: imagen("Oferta") },
    { clave: "SOLO-TEXTO", nombre: "Solo texto", beneficio: "$5.000 de descuento", alcance: "2 categorías", href: `${BASE}?categoria=c2` },
  ];
  const COMBOS: ComboVitrina[] = [
    {
      clave: "COMBO-1",
      nombre: "Combo cadena y dije",
      componentes: [
        { referencia: "DL-000001", nombre: "Cadena", cantidad: 1, disponible: true },
        { referencia: "DL-000002", nombre: "Dije", cantidad: 2, disponible: false },
      ],
      precioNormal: 60_000,
      precioCombo: 50_000,
      ahorro: 10_000,
      disponible: true,
      vigencia: "hasta el 31 de octubre de 2026",
      consultaHref: "https://wa.me/573000000000?text=Hola",
    },
    { clave: "COMBO-2", nombre: "Combo agotado", componentes: [{ referencia: "DL-000003", nombre: "Ojo turco", cantidad: 1, disponible: false }], precioNormal: null, precioCombo: 40_000, disponible: false, consultaHref: null },
  ];
  const TODO: CatalogStorefrontConfig = {
    ...REGISTRO,
    secciones: ["portada", "categorias", "destacados", "campana", "ofertas", "combos", "banner"],
    campana: { nombre: "Amor y Amistad", productos: ["DL-000004"], portada: { etiqueta: "Temporada", titulo: "Amor y Amistad", subtitulo: "Para regalar.", imagen: imagen("Campaña"), boton: { texto: "Ver la colección", href: LISTA } } },
    ofertas: OFERTAS,
    combos: COMBOS,
  };
  const home: PublicHome = { ...HOME_COMPLETO, campana: [producto(4, { name: "Pieza de campaña" })] };

  it("las secciones salen en el orden que pide el CMS", () => {
    const h = inicio(TODO, home);
    const orden = ['id="categorias"', 'id="joy-destacados"', 'id="campana"', 'id="ofertas"', 'id="combos"', "El regalo perfecto siempre es una joya", 'id="mayoristas"'].map((m) => pos(h, m));
    assert.deepEqual([...orden].sort((a, b) => a - b), orden);
  });

  it("la campaña con portada muestra etiqueta, título, subtítulo, botón y sus productos; sin portada ni productos no se dibuja", () => {
    const h = inicio(TODO, home);
    const c = h.slice(pos(h, 'id="campana"'), pos(h, 'id="ofertas"'));
    for (const t of ["Temporada", "Amor y Amistad", "Para regalar.", "Ver la colección", "Pieza de campaña"]) assert.ok(c.includes(t), t);
    const sinNada = inicio({ ...TODO, campana: { nombre: "Vacía", productos: [] } }, { ...HOME_COMPLETO, campana: [] });
    assert.ok(!sinNada.includes('id="campana"'));
    const soloProductos = inicio({ ...TODO, campana: { nombre: "Solo productos", productos: ["DL-000004"] } }, home);
    assert.ok(soloProductos.includes("Solo productos") && soloProductos.includes("Pieza de campaña"));
  });

  it("las ofertas anuncian beneficio, alcance, vigencia y condiciones, y llevan a donde dice el CMS", () => {
    const h = inicio(TODO, home);
    const o = h.slice(pos(h, 'id="ofertas"'), pos(h, 'id="combos"'));
    for (const t of ["20% de descuento", "Toda la tienda", "hasta el 31 de octubre de 2026", "Hasta agotar existencias.", "Todo con descuento.", "$5.000 de descuento", "2 categorías"]) assert.ok(o.includes(t), t);
    assert.equal(cuenta(o, />Ver productos</g), 2);
    assert.ok(o.includes(`href="${LISTA}"`) && o.includes(`href="${BASE}?categoria=c2"`));
  });

  it("los combos muestran lo que incluyen, su precio, el ahorro y la disponibilidad; solo el disponible lleva el botón de la asesora", () => {
    const h = inicio(TODO, home);
    const c = h.slice(pos(h, 'id="combos"'), pos(h, "El regalo perfecto siempre es una joya"));
    for (const t of ["1 × Cadena", "2 × Dije (agotado)", formatCop(50_000), formatCop(60_000), `Ahorras ${formatCop(10_000)}`, "Disponible", "No disponible por ahora", formatCop(40_000)]) assert.ok(c.includes(t), t);
    assert.equal(cuenta(c, /Pedir con una asesora/g), 1, "el combo sin enlace no lleva botón");
    assert.ok(c.includes('href="https://wa.me/573000000000?text=Hola" target="_blank" rel="noopener noreferrer"'));
  });

  it("sin ofertas ni combos en la configuración, esas secciones no existen aunque el CMS las nombre", () => {
    const h = inicio({ ...TODO, ofertas: [], combos: undefined }, home);
    assert.ok(!h.includes('id="ofertas"') && !h.includes('id="combos"'));
  });
});

describe("tarjeta de producto joyería", () => {
  const html = (p = producto(1)) =>
    renderToStaticMarkup(
      <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp={WHATSAPP}>
        <TarjetaJoyeria product={p} basePath={BASE} posicion={0} />
      </TiendaProvider>,
    );

  it("con oferta: etiqueta, beneficio y precio de lista tachado con su texto para lectores de pantalla", () => {
    const h = html(producto(1, { price: 28_000, listPrice: 35_000, offer: { name: "Amor y Amistad", benefit: "20% de descuento", label: "-20%", until: null, conditions: null } }));
    for (const t of ["-20%", "20% de descuento", formatCop(28_000), "Precio normal: ", `<s>${formatCop(35_000)}</s>`]) assert.ok(h.includes(t), t);
  });

  it("la foto es vertical (4:5) y la primera se carga de inmediato; la píldora del carrito va sobre la foto", () => {
    const h = html();
    assert.ok(h.includes("aspect-[4/5]"));
    assert.ok(h.includes('loading="eager"'));
    assert.ok(h.includes("joy-pildora"));
    assert.ok(h.includes('aria-label="Agregar Pieza de prueba 1 a tu selección"'));
  });

  it("sin foto, un recuadro con el icono; agotado, la foto se atenúa y no hay botón de agregar", () => {
    const sinFoto = html(producto(1, { thumbUrl: null }));
    assert.ok(!sinFoto.includes("<img"));
    const agotado = html(producto(1, { available: false, availability: "sold_out" }));
    assert.ok(agotado.includes("opacity-60") && agotado.includes("Agotado"));
    assert.ok(!agotado.includes("Agregar Pieza"));
  });
});

describe("pie joyería", () => {
  const CATS = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `Categoría ${i}` }));
  const pie = (over: Partial<Parameters<typeof PieJoyeria>[0]> = {}) =>
    renderToStaticMarkup(<PieJoyeria marca={{ name: "Delacour & Orus", descriptor: "Joyería" }} basePath={BASE} listPath={LISTA} categorias={CATS} whatsapp={WHATSAPP} descripcion="Frase del pie." mayorista {...over} />);

  it("solo información que la tienda ya tiene: marca, frase, navegación, categorías (las primeras y «Ver todas»), mayoristas, WhatsApp y el crédito; ni teléfono escrito, ni redes, ni dirección", () => {
    const h = pie();
    for (const t of ["Delacour &amp; Orus", "Joyería", "Frase del pie.", "Todo el catálogo", `href="${BASE}#mayoristas"`, `href="https://wa.me/${WHATSAPP}"`, "Ver todas", "Catálogo creado con"]) assert.ok(h.includes(t), t);
    assert.equal(cuenta(h, /\?categoria=/g), 6, "solo las primeras seis categorías");
    const visible = h.replace(/<[^>]+>/g, " ");
    assert.ok(!visible.includes(WHATSAPP) && !visible.includes("+57"), "el número solo vive dentro del enlace, nunca escrito en pantalla");
    assert.ok(!/instagram|tiktok|facebook|direcci[oó]n|calle|carrera|tel[eé]fono/i.test(visible), "nada inventado: ni redes, ni dirección");
  });

  it("sin WhatsApp válido no hay contacto; sin bloque de mayoristas no hay enlace a él", () => {
    const h = pie({ whatsapp: null, mayorista: false });
    assert.ok(!h.includes("wa.me") && !h.includes("Contacto") && !h.includes("#mayoristas"));
  });

  it("el enlace «Mayoristas» lleva a la página propia cuando la tienda la tiene, y al bloque del inicio (como siempre) si no", () => {
    const conPagina = pie({ mayoristaHref: `${BASE}/mayoristas` });
    assert.ok(conPagina.includes(`href="${BASE}/mayoristas"`) && !conPagina.includes("#mayoristas"));
    assert.ok(pie().includes(`href="${BASE}#mayoristas"`));
    assert.ok(!pie({ mayorista: false, mayoristaHref: `${BASE}/mayoristas` }).includes("/mayoristas"), "sin mayoristas no hay enlace, aunque llegue un destino");
  });

  it("accesibilidad: los títulos de columna son h2 (no se salta de nivel) y el enlace de crédito se distingue por algo más que el color (subrayado)", () => {
    const h = pie();
    assert.equal(cuenta(h, /<h3/g), 0);
    assert.equal(cuenta(h, /<h2 /g), 3);
    const credito = (h.match(/<a [^>]*href="https:\/\/www\.dulabs\.co"[^>]*>/) ?? [""])[0];
    assert.match(credito, /\bunderline\b/);
  });
});
