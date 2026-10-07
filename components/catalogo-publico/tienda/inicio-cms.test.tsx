/**
 * Inicio de la tienda con contenido del CMS: qué secciones se dibujan, en qué orden, y lo que NUNCA se muestra (una portada rota, un botón sin destino,
 * una campaña vacía). El HTML con la configuración de siempre está fijado aparte (inicio-dorado.test.tsx).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { TiendaInicio } from "@/components/catalogo-publico/tienda/TiendaInicio";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import type { PublicHome } from "@/lib/catalogo/service";
import type { CatalogStorefrontConfig } from "@/lib/catalogo/vitrina";

const BASE = "/catalogo/prueba";
const LISTA = `${BASE}?todo=1`;
const ID_PORTADA = "a0000000-0000-4000-8000-000000000001";
const ID_BANNER = "a0000000-0000-4000-8000-000000000002";
const ID_CAMPANA = "a0000000-0000-4000-8000-000000000003";

const producto = (n: number, name = `Pieza ${n}`): PublicCatalogProduct => ({
  reference: `DL-${String(n).padStart(6, "0")}`,
  name,
  description: null,
  material: null,
  color: null,
  categoryName: "Aretes",
  price: 90_000 + n * 1_000,
  imageUrl: `${BASE}/productos/dl-${String(n).padStart(6, "0")}/main.webp?v=1`,
  detailUrl: `${BASE}/productos/dl-${String(n).padStart(6, "0")}/detail.webp?v=1`,
  thumbUrl: `${BASE}/productos/dl-${String(n).padStart(6, "0")}/thumb.webp?v=1`,
  available: true,
  availability: "available",
  maxQuantity: null,
});

const HOME: PublicHome = {
  featured: [producto(1, "Destacado uno"), producto(2, "Destacado dos")],
  featuredPolicy: "cms",
  categories: [{ id: "c0000000-0000-4000-8000-0000000000a1", name: "Aretes", coverUrl: null } as PublicHome["categories"][number]],
  campana: [producto(5, "Pieza de campaña"), producto(6, "Otra de campaña")],
};

const cmsImg = (id: string, alt: string) => ({ src: `${BASE}/vitrina/${id}.webp`, width: 1600, height: 900, alt });

const BASE_CONFIG: CatalogStorefrontConfig = {
  brand: { name: "Tienda de prueba" },
  heroImage: cmsImg(ID_PORTADA, "Collar de perlas"),
  heroEyebrow: "Más que joyas",
  heroTitle: "Historias que brillan",
  heroDescription: "Diseños únicos.",
  heroCta: "Ver todo",
  heroHref: LISTA,
  bannerImage: cmsImg(ID_BANNER, "Banner de regalo"),
  secciones: ["portada", "categorias", "destacados", "banner"],
};

function inicio(config: CatalogStorefrontConfig, home: PublicHome = HOME): string {
  return renderToStaticMarkup(
    <TiendaProvider slug="prueba" context="retail" basePath={BASE} whatsapp="573001112233">
      <TiendaInicio home={home} config={config} basePath={BASE} listPath={LISTA} businessName="Tienda de prueba" />
    </TiendaProvider>,
  );
}

const cuenta = (html: string, patron: RegExp) => (html.match(patron) ?? []).length;
const pos = (html: string, texto: string) => {
  const i = html.indexOf(texto);
  assert.ok(i >= 0, `falta «${texto}»`);
  return i;
};

describe("TiendaInicio con contenido del CMS — la portada", () => {
  it("dibuja la imagen del CMS por la ruta pública, el texto como HTML real y el botón hacia su destino", () => {
    const html = inicio(BASE_CONFIG);
    assert.ok(html.includes(`url=%2Fcatalogo%2Fprueba%2Fvitrina%2F${ID_PORTADA}.webp`), "la imagen sale por la ruta de la tienda (optimizada por Next)");
    assert.ok(!html.includes("supabase"), "nunca una dirección de Storage");
    for (const t of ["Más que joyas", "Historias que brillan", "Diseños únicos.", "Ver todo", "Collar de perlas"]) assert.ok(html.includes(t), t);
    assert.ok(html.includes(`href="${LISTA}"`));
  });

  it("el botón puede llevar a una categoría o buscar algo, no solo al listado", () => {
    const html = inicio({ ...BASE_CONFIG, heroHref: `${BASE}?categoria=c0000000-0000-4000-8000-0000000000a1` });
    assert.ok(html.includes(`href="${BASE}?categoria=c0000000-0000-4000-8000-0000000000a1"`));
  });

  it("un destino externo (WhatsApp) abre en pestaña nueva, sin enviar el origen ni dar control a la otra página", () => {
    const html = inicio({ ...BASE_CONFIG, heroHref: "https://wa.me/573001112233" });
    assert.ok(html.includes('href="https://wa.me/573001112233" target="_blank" rel="noopener noreferrer"'));
    assert.ok(!html.includes(`href="${LISTA}" target`), "los enlaces internos no abren pestañas nuevas");
  });

  it("sin botón (heroCta vacío) la portada no dibuja ningún enlace propio", () => {
    const html = inicio({ ...BASE_CONFIG, heroCta: "", heroHref: undefined });
    const portada = html.slice(pos(html, "tienda-hero-entrada"), pos(html, 'id="categorias"'));
    assert.equal(cuenta(portada, /<a /g), 0);
    assert.ok(html.includes("Historias que brillan"));
  });

  it("sin destino explícito el botón lleva al listado, como siempre", () => {
    const html = inicio({ ...BASE_CONFIG, heroHref: undefined });
    assert.ok(html.includes(`href="${LISTA}"`));
  });

  it("el texto se escapa: lo que escriba la administradora nunca se ejecuta como HTML", () => {
    const html = inicio({ ...BASE_CONFIG, heroTitle: "<img src=x onerror=alert(1)>", heroDescription: "<script>alert(2)</script>" });
    assert.ok(!html.includes("<img src=x"), "sin etiqueta inyectada");
    assert.ok(!html.includes("<script>alert"), "sin script inyectado");
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  });
});

describe("TiendaInicio con contenido del CMS — título principal (h1)", () => {
  it("con portada, el h1 es el título de la portada y no hay otro", () => {
    const html = inicio(BASE_CONFIG);
    assert.equal(cuenta(html, /<h1[ >]/g), 1);
    assert.equal(cuenta(html, /<h1 class="sr-only"/g), 0);
  });

  it("sin portada la página conserva su h1 (el nombre del negocio, solo para lectores de pantalla)", () => {
    const html = inicio({ ...BASE_CONFIG, heroImage: undefined, heroTitle: undefined, secciones: ["destacados"] });
    assert.equal(cuenta(html, /<h1[ >]/g), 1);
    assert.ok(html.includes('<h1 class="sr-only">Tienda de prueba</h1>'));
  });

  it("aunque haya portada configurada, si su sección no está en la lista, tampoco se dibuja y el h1 es el del negocio", () => {
    const html = inicio({ ...BASE_CONFIG, secciones: ["destacados"] });
    assert.ok(!html.includes("Historias que brillan"));
    assert.equal(cuenta(html, /<h1[ >]/g), 1);
    assert.ok(html.includes('<h1 class="sr-only">Tienda de prueba</h1>'));
  });

  it("con la lista de secciones vacía solo queda el título del negocio", () => {
    const html = inicio({ ...BASE_CONFIG, secciones: [] });
    assert.ok(html.includes('<h1 class="sr-only">Tienda de prueba</h1>'));
    assert.ok(!html.includes("Productos destacados") && !html.includes("Historias que brillan"));
  });
});

describe("TiendaInicio con contenido del CMS — orden y visibilidad de las secciones", () => {
  it("las secciones salen en el orden que eligió la administradora", () => {
    const html = inicio({ ...BASE_CONFIG, secciones: ["destacados", "categorias", "portada"] });
    assert.ok(pos(html, "Productos destacados") < pos(html, 'id="categorias"'));
    assert.ok(pos(html, 'id="categorias"') < pos(html, "tienda-hero-entrada"));
  });

  it("una sección que no está en la lista no se dibuja (aunque haya datos: categorías, banner)", () => {
    const html = inicio({ ...BASE_CONFIG, secciones: ["portada", "destacados"] });
    assert.ok(!html.includes('id="categorias"'));
    assert.ok(!html.includes("Banner de regalo"));
    assert.ok(html.includes("Productos destacados"));
  });

  it("ofertas y combos todavía no se dibujan: pedirlos no rompe ni deja un hueco", () => {
    const html = inicio({ ...BASE_CONFIG, secciones: ["ofertas", "portada", "combos", "destacados"] });
    assert.ok(html.includes("Historias que brillan") && html.includes("Productos destacados"));
    assert.ok(!html.includes("Ofertas") && !html.includes("Combos"));
  });

  it("los destacados muestran lo elegido en el CMS, con sus precios de lista (el precio efectivo llega en otro paso)", () => {
    const html = inicio(BASE_CONFIG);
    assert.ok(html.includes("Destacado uno") && html.includes("Destacado dos"));
  });

  it("sin categorías en el catálogo no se dibuja la franja de categorías", () => {
    const html = inicio(BASE_CONFIG, { ...HOME, categories: [] });
    assert.ok(!html.includes('id="categorias"'));
  });
});

describe("TiendaInicio con contenido del CMS — el banner", () => {
  it("con destino, la imagen es un enlace que lleva a donde dice el CMS", () => {
    const html = inicio({ ...BASE_CONFIG, bannerHref: `${BASE}?q=anillos` });
    assert.ok(html.includes(`<a class="block" href="${BASE}?q=anillos"><img alt="Banner de regalo"`), "la imagen del banner va dentro del enlace");
  });

  it("sin destino, el banner es solo la imagen (sin enlace)", () => {
    const html = inicio(BASE_CONFIG);
    assert.ok(!html.includes('<a class="block"'), "sin destino no hay enlace alrededor del banner");
    assert.ok(html.includes('<img alt="Banner de regalo"'));
  });

  it("un destino de WhatsApp en el banner también abre en pestaña nueva", () => {
    const html = inicio({ ...BASE_CONFIG, bannerHref: "https://wa.me/573001112233" });
    assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
  });
});

describe("TiendaInicio con contenido del CMS — la campaña vigente", () => {
  const CAMPANA_FULL = {
    nombre: "Madres 2026",
    portada: {
      etiqueta: "Temporada",
      titulo: "Día de la Madre",
      subtitulo: "Regala una joya que dure para siempre.",
      imagen: cmsImg(ID_CAMPANA, "Madre e hija"),
      boton: { texto: "Ver regalos", href: `${BASE}?q=regalo` },
    },
    productos: ["DL-000005", "DL-000006"],
  };
  const conCampana = (over: Partial<CatalogStorefrontConfig> = {}): CatalogStorefrontConfig => ({ ...BASE_CONFIG, secciones: ["portada", "campana", "destacados"], campana: CAMPANA_FULL, ...over });

  it("con portada propia: imagen del CMS, texto real, botón y sus productos", () => {
    const html = inicio(conCampana());
    assert.ok(html.includes('id="campana"') && html.includes('aria-labelledby="tienda-campana"'));
    assert.ok(html.includes(`url=%2Fcatalogo%2Fprueba%2Fvitrina%2F${ID_CAMPANA}.webp`));
    for (const t of ["Temporada", "Día de la Madre", "Regala una joya que dure para siempre.", "Ver regalos", "Madre e hija", "Pieza de campaña", "Otra de campaña"]) assert.ok(html.includes(t), t);
    assert.ok(html.includes(`href="${BASE}?q=regalo"`));
    // el título de la campaña es un h2: la portada sigue siendo el único h1
    assert.equal(cuenta(html, /<h1[ >]/g), 1);
    assert.ok(html.includes('<h2 id="tienda-campana"'));
  });

  it("sin portada propia: encabezado sencillo con el nombre de la campaña y sus productos", () => {
    const html = inicio(conCampana({ campana: { nombre: "Pieza del mes", productos: ["DL-000005"] } }));
    assert.ok(html.includes("Pieza del mes") && html.includes("Pieza de campaña"));
    assert.ok(!html.includes("Temporada"));
  });

  it("sin portada y sin productos disponibles (todos desactivados) no se dibuja nada", () => {
    const html = inicio(conCampana({ campana: { nombre: "Pieza del mes", productos: ["DL-000005"] } }), { ...HOME, campana: [] });
    assert.ok(!html.includes('id="campana"') && !html.includes("Pieza del mes"));
    const sinCargar = inicio(conCampana({ campana: { nombre: "Pieza del mes", productos: ["DL-000005"] } }), { ...HOME, campana: undefined });
    assert.ok(!sinCargar.includes('id="campana"'));
  });

  it("con portada pero sin productos disponibles, la portada de la campaña sí se muestra", () => {
    const html = inicio(conCampana(), { ...HOME, campana: [] });
    assert.ok(html.includes("Día de la Madre") && html.includes("Ver regalos"));
    assert.ok(!html.includes("Pieza de campaña"));
  });

  it("si la sección «campaña» no está en la lista, no se dibuja aunque haya una vigente", () => {
    const html = inicio(conCampana({ secciones: ["portada", "destacados"] }));
    assert.ok(!html.includes('id="campana"') && !html.includes("Día de la Madre"));
  });

  it("sin campaña en la configuración (ninguna vigente) no hay bloque aunque la sección esté en la lista", () => {
    const html = inicio({ ...BASE_CONFIG, secciones: ["portada", "campana", "destacados"] });
    assert.ok(!html.includes('id="campana"'));
  });

  it("la campaña va donde la pusieron: antes de los destacados si así se eligió", () => {
    const html = inicio(conCampana());
    assert.ok(pos(html, 'id="campana"') < pos(html, "Productos destacados"));
    const despues = inicio(conCampana({ secciones: ["portada", "destacados", "campana"] }));
    assert.ok(pos(despues, "Productos destacados") < pos(despues, 'id="campana"'));
  });

  it("la imagen que no cargó (campaña sin imagen) no deja un recuadro vacío", () => {
    const html = inicio(conCampana({ campana: { ...CAMPANA_FULL, portada: { ...CAMPANA_FULL.portada, imagen: undefined } } }));
    assert.ok(html.includes("Día de la Madre"));
    assert.ok(!html.includes("Madre e hija"));
    assert.ok(!html.includes("aspect-[16/9] bg-ink-2"), "sin imagen no hay contenedor de imagen");
  });
});
