/**
 * CMS comercial — de lo PUBLICADO a la VITRINA de la tienda. Cada caso fija una regla del negocio: qué se muestra, qué se calla y qué NO cambia.
 * Datos sintéticos; el reloj es el inyectado (nunca el real).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SECCIONES_HOME } from "@/lib/cms-comercial/contrato";
import type { Destino, Home } from "@/lib/cms-comercial/esquemas";
import type { AssetPublicoCms, InstantaneaCms, PublicadaCms } from "@/lib/cms-comercial/publicado";
import { AHORA, CAT_ARETES, CAT_DIJES, campana, combo, home, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";
import { assetsReferenciados, hrefDeDestino, imagenDeVitrina, rutaImagenCms, seccionesDeInicio, vitrinaDesdeCms, type ContextoVitrina } from "@/lib/cms-comercial/vitrina";
import { ORDEN_INICIO_CLASICO, SECCIONES_DIBUJADAS, SECCIONES_INICIO, type CatalogStorefrontConfig } from "@/lib/catalogo/vitrina";

const ASSET_PORTADA = "a0000000-0000-4000-8000-000000000001";
const ASSET_BANNER = "a0000000-0000-4000-8000-000000000002";
const ASSET_CAMPANA = "a0000000-0000-4000-8000-000000000003";
const ASSET_OFERTA = "a0000000-0000-4000-8000-000000000004";
const CAT_BORRADA = "c0000000-0000-4000-8000-0000000000ff";

const asset = (id: string, ancho = 1600, alto = 900): AssetPublicoCms => ({ id, storagePath: `tenant/cms/${id}/imagen.webp`, mimeType: "image/webp", ancho, alto });
const ASSETS = [asset(ASSET_PORTADA, 1600, 900), asset(ASSET_BANNER, 2000, 600), asset(ASSET_CAMPANA, 1200, 800), asset(ASSET_OFERTA, 800, 800)];

const cms = (id: string, alt = "Imagen de prueba", foco?: string) => ({ origen: "cms" as const, asset: id, alt, ...(foco ? { foco } : {}) });

const ctxV = (over: Partial<ContextoVitrina> = {}): ContextoVitrina => ({
  slug: "prueba",
  basePath: "/catalogo/prueba",
  listPath: "/catalogo/prueba?todo=1",
  whatsapp: "573001112233",
  categorias: new Set([CAT_ARETES, CAT_DIJES]),
  ahora: AHORA,
  ...over,
});

const REGISTRO: CatalogStorefrontConfig = {
  brand: { name: "Tienda de prueba", descriptor: "Joyería" },
  tema: "clasico",
  heroImage: { src: "/catalogo/prueba/hero-registro.png", width: 1669, height: 942, alt: "Hero del registro" },
  heroTitle: "Título del registro",
  heroCta: "Ver catálogo",
  bannerImage: { src: "/catalogo/prueba/banner-registro.png", width: 2172, height: 724, alt: "Banner del registro" },
};

const TODAS_VISIBLES = SECCIONES_HOME.map((tipo) => ({ tipo, visible: true }));

/** Una página principal completa (portada con imagen y botón, banner con destino, secciones en el orden clásico más campaña). */
const homeCompleta = (over: Partial<Home> = {}): Home =>
  home({
    portada: {
      visible: true,
      imagen: cms(ASSET_PORTADA, "Mujer con un collar", "70% 40%"),
      etiqueta: "Más que joyas",
      titulo: "Historias que brillan",
      subtitulo: "Diseños únicos.",
      boton: { texto: "Ver todo", destino: { tipo: "catalogo" } },
    },
    banner: { visible: true, imagen: cms(ASSET_BANNER, "El regalo perfecto"), destino: { tipo: "categoria", categoria_id: CAT_ARETES } },
    secciones: [
      { tipo: "portada", visible: true },
      { tipo: "categorias", visible: true },
      { tipo: "destacados", visible: true },
      { tipo: "campana", visible: true },
      { tipo: "banner", visible: true },
    ],
    categorias_destacadas: [CAT_DIJES, CAT_ARETES],
    productos_destacados: ["DL-000003", "DL-000001"],
    ...over,
  });

const snapDe = (h: Home | null, extra: Partial<Omit<InstantaneaCms, "assets">> = {}): InstantaneaCms =>
  instantanea({ home: h ? publicada("home", h) : null, assets: ASSETS, ...extra });

function congelar<T>(valor: T): T {
  if (valor && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const v of valor instanceof Map ? valor.values() : Object.values(valor)) congelar(v);
  }
  return valor;
}

// ---------------------------------------------------------------------------
// Las listas cerradas no se separan
// ---------------------------------------------------------------------------

describe("secciones: la tienda y el CMS hablan de lo mismo", () => {
  it("SECCIONES_INICIO (tienda) es EXACTAMENTE SECCIONES_HOME (CMS), en el mismo orden", () => {
    assert.deepEqual([...SECCIONES_INICIO], [...SECCIONES_HOME]);
  });
  it("el orden clásico y lo que la tienda sabe dibujar son subconjuntos de las secciones; el clásico es lo que hay hoy", () => {
    for (const s of ORDEN_INICIO_CLASICO) assert.ok(SECCIONES_DIBUJADAS.includes(s), s);
    for (const s of SECCIONES_DIBUJADAS) assert.ok(SECCIONES_INICIO.includes(s), s);
    assert.deepEqual([...ORDEN_INICIO_CLASICO], ["portada", "categorias", "destacados", "banner"]);
  });
  it("ofertas y combos todavía no se dibujan (no hay nada a medias en la tienda)", () => {
    assert.ok(!SECCIONES_DIBUJADAS.includes("ofertas"));
    assert.ok(!SECCIONES_DIBUJADAS.includes("combos"));
  });
});

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

describe("imagenDeVitrina", () => {
  const assets = new Map(ASSETS.map((a) => [a.id, a]));

  it("una imagen estática del equipo se entrega tal cual (ruta, medidas, texto alternativo y punto focal)", () => {
    const img = imagenDeVitrina({ origen: "estatico", src: "/catalogo/prueba/portada.png", ancho: 1669, alto: 942, alt: "Portada", foco: "72% 50%" }, assets, "prueba");
    assert.deepEqual(img, { src: "/catalogo/prueba/portada.png", width: 1669, height: 942, alt: "Portada", focus: "72% 50%" });
  });

  it("una imagen del CMS sale por la ruta pública de la tienda (nunca la dirección de Storage) y con las medidas REALES del archivo", () => {
    const img = imagenDeVitrina(cms(ASSET_PORTADA, "Collar", "10% 20%"), assets, "prueba");
    assert.deepEqual(img, { src: `/catalogo/prueba/vitrina/${ASSET_PORTADA}.webp`, width: 1600, height: 900, alt: "Collar", focus: "10% 20%" });
    assert.equal(rutaImagenCms("prueba", ASSET_PORTADA), img?.src);
    assert.ok(!JSON.stringify(img).includes("tenant/cms"), "la ruta de Storage no se filtra");
  });

  it("sin punto focal no se inventa uno", () => {
    const img = imagenDeVitrina(cms(ASSET_PORTADA), assets, "prueba");
    assert.ok(img && !("focus" in img));
  });

  it("una imagen del CMS que no está lista (no figura entre las imágenes listas) o sin medidas válidas NO se muestra", () => {
    assert.equal(imagenDeVitrina(cms("a0000000-0000-4000-8000-0000000000ee"), assets, "prueba"), null);
    assert.equal(imagenDeVitrina(cms(ASSET_PORTADA), new Map([[ASSET_PORTADA, asset(ASSET_PORTADA, 0, 900)]]), "prueba"), null);
    assert.equal(imagenDeVitrina(cms(ASSET_PORTADA), new Map([[ASSET_PORTADA, asset(ASSET_PORTADA, 1600, Number.NaN)]]), "prueba"), null);
    assert.equal(imagenDeVitrina(undefined, assets, "prueba"), null);
  });
});

describe("assetsReferenciados — las únicas imágenes que la ruta pública puede servir", () => {
  it("reúne las del CMS usadas por la portada, el banner, ofertas, combos y campañas (incluida la portada de la campaña); ignora las estáticas", () => {
    const snap = snapDe(homeCompleta(), {
      ofertas: [publicada("of", oferta({ imagen: cms(ASSET_OFERTA) }))],
      combos: [publicada("cb", combo({ imagen: cms("a0000000-0000-4000-8000-0000000000c1") }))],
      campanas: [publicada("ca", campana({ imagen: cms("a0000000-0000-4000-8000-0000000000c2"), portada: { titulo: "Campaña", imagen: cms(ASSET_CAMPANA) } }))],
    });
    const ids = assetsReferenciados(snap);
    assert.deepEqual(
      [...ids].sort(),
      [ASSET_PORTADA, ASSET_BANNER, ASSET_OFERTA, "a0000000-0000-4000-8000-0000000000c1", "a0000000-0000-4000-8000-0000000000c2", ASSET_CAMPANA].sort(),
    );
    const estatica = snapDe(home());
    assert.equal(assetsReferenciados(estatica).size, 0);
  });

  it("una imagen subida pero NO usada por nada publicado no está referenciada (un borrador no se expone)", () => {
    assert.equal(assetsReferenciados(snapDe(null)).size, 0);
    assert.ok(!assetsReferenciados(snapDe(homeCompleta())).has(ASSET_OFERTA));
  });
});

// ---------------------------------------------------------------------------
// Destinos
// ---------------------------------------------------------------------------

describe("hrefDeDestino — un botón solo lleva a donde existe y está disponible AHORA", () => {
  const snap = snapDe(homeCompleta());
  const ev = { snap, canal: "retail" as const, ahora: AHORA };

  it("sin destino, no hay enlace", () => {
    assert.equal(hrefDeDestino(undefined, ctxV(), ev), null);
  });

  it("catálogo: el listado completo", () => {
    assert.equal(hrefDeDestino({ tipo: "catalogo" }, ctxV(), ev), "/catalogo/prueba?todo=1");
  });

  it("categoría: solo si existe en el catálogo; una borrada no lleva a ningún lado", () => {
    assert.equal(hrefDeDestino({ tipo: "categoria", categoria_id: CAT_DIJES }, ctxV(), ev), `/catalogo/prueba?categoria=${CAT_DIJES}`);
    assert.equal(hrefDeDestino({ tipo: "categoria", categoria_id: CAT_BORRADA }, ctxV(), ev), null);
  });

  it("búsqueda: el texto va codificado; vacío no lleva a ningún lado", () => {
    assert.equal(hrefDeDestino({ tipo: "busqueda", consulta: "aretes & dijes" }, ctxV(), ev), "/catalogo/prueba?q=aretes%20%26%20dijes");
    assert.equal(hrefDeDestino({ tipo: "busqueda", consulta: "   " }, ctxV(), ev), null);
  });

  it("WhatsApp: solo con un número válido del negocio (8 a 15 dígitos); se usan solo los dígitos", () => {
    assert.equal(hrefDeDestino({ tipo: "whatsapp" }, ctxV({ whatsapp: "+57 (300) 111-2233" }), ev), "https://wa.me/573001112233");
    assert.equal(hrefDeDestino({ tipo: "whatsapp" }, ctxV({ whatsapp: null }), ev), null);
    assert.equal(hrefDeDestino({ tipo: "whatsapp" }, ctxV({ whatsapp: "1234567" }), ev), null);
    assert.equal(hrefDeDestino({ tipo: "whatsapp" }, ctxV({ whatsapp: "1".repeat(16) }), ev), null);
    assert.equal(hrefDeDestino({ tipo: "whatsapp" }, ctxV({ whatsapp: "abc" }), ev), null);
  });

  describe("oferta, combo y campaña: la sección debe estar dibujada Y el elemento activo hoy", () => {
    const conTodo = snapDe(homeCompleta(), {
      ofertas: [publicada("oferta-activa", oferta())],
      combos: [publicada("combo-activo", combo())],
      campanas: [publicada("campana-activa", campana())],
    });
    const evTodo = { snap: conTodo, canal: "retail" as const, ahora: AHORA };
    const todoDibujado = ctxV({ dibujadas: ["portada", "categorias", "destacados", "banner", "campana", "ofertas", "combos"] });

    it("campaña activa y sección dibujada: ancla a su sección", () => {
      assert.equal(hrefDeDestino({ tipo: "campana", clave: "campana-activa" }, ctxV(), evTodo), "/catalogo/prueba#campana");
    });
    it("oferta y combo: la tienda aún no dibuja esas secciones, así que no hay enlace (nunca un ancla a la nada)", () => {
      assert.equal(hrefDeDestino({ tipo: "oferta", clave: "oferta-activa" }, ctxV(), evTodo), null);
      assert.equal(hrefDeDestino({ tipo: "combo", clave: "combo-activo" }, ctxV(), evTodo), null);
    });
    it("cuando la tienda sí las dibuja, oferta y combo activos llevan a su sección", () => {
      assert.equal(hrefDeDestino({ tipo: "oferta", clave: "oferta-activa" }, todoDibujado, evTodo), "/catalogo/prueba#ofertas");
      assert.equal(hrefDeDestino({ tipo: "combo", clave: "combo-activo" }, todoDibujado, evTodo), "/catalogo/prueba#combos");
    });
    it("una clave inexistente no lleva a ningún lado", () => {
      assert.equal(hrefDeDestino({ tipo: "oferta", clave: "no-existe" }, todoDibujado, evTodo), null);
      assert.equal(hrefDeDestino({ tipo: "combo", clave: "no-existe" }, todoDibujado, evTodo), null);
      assert.equal(hrefDeDestino({ tipo: "campana", clave: "no-existe" }, todoDibujado, evTodo), null);
    });
    it("vencida o programada: no hay enlace", () => {
      const vencidas = snapDe(homeCompleta(), {
        ofertas: [publicada("o", oferta({ vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }))],
        combos: [publicada("c", combo({ vigencia: { desde: "2026-11-01", hasta: "2026-11-30" } }))],
        campanas: [publicada("k", campana({ vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }))],
      });
      const e = { snap: vencidas, canal: "retail" as const, ahora: AHORA };
      assert.equal(hrefDeDestino({ tipo: "oferta", clave: "o" }, todoDibujado, e), null);
      assert.equal(hrefDeDestino({ tipo: "combo", clave: "c" }, todoDibujado, e), null);
      assert.equal(hrefDeDestino({ tipo: "campana", clave: "k" }, todoDibujado, e), null);
    });
    it("de otra modalidad (mayorista) no existe para un cliente detal", () => {
      const mayoristas = snapDe(homeCompleta(), {
        ofertas: [publicada("o", oferta({ modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 20 } }))],
        combos: [publicada("c", combo({ modalidad: "mayorista", precio: { mayorista: 70000 } }))],
        campanas: [publicada("k", campana({ modalidad: "mayorista" }))],
      });
      const e = { snap: mayoristas, canal: "retail" as const, ahora: AHORA };
      assert.equal(hrefDeDestino({ tipo: "oferta", clave: "o" }, todoDibujado, e), null);
      assert.equal(hrefDeDestino({ tipo: "combo", clave: "c" }, todoDibujado, e), null);
      assert.equal(hrefDeDestino({ tipo: "campana", clave: "k" }, todoDibujado, e), null);
    });
    it("una oferta de una campaña apagada tampoco existe", () => {
      const sinCampana = snapDe(homeCompleta(), { ofertas: [publicada("o", oferta({ campana: "campana-que-no-esta" }))] });
      assert.equal(hrefDeDestino({ tipo: "oferta", clave: "o" }, todoDibujado, { snap: sinCampana, canal: "retail", ahora: AHORA }), null);
    });
  });
});

// ---------------------------------------------------------------------------
// La vitrina
// ---------------------------------------------------------------------------

describe("vitrinaDesdeCms — sin nada publicado, la tienda queda EXACTAMENTE como estaba", () => {
  it("sin página principal publicada devuelve el registro SIN TOCAR (la misma referencia)", () => {
    assert.equal(vitrinaDesdeCms(snapDe(null), REGISTRO, ctxV()), REGISTRO);
    // aunque haya otras cosas publicadas (ofertas, campañas): sin home no cambia nada en el inicio
    assert.equal(vitrinaDesdeCms(snapDe(null, { campanas: [publicada("k", campana())], ofertas: [publicada("o", oferta())] }), REGISTRO, ctxV()), REGISTRO);
  });

  it("la tienda de tecnología tiene su propio contenido: el CMS no la toca aunque haya una portada publicada", () => {
    const tecno: CatalogStorefrontConfig = { ...REGISTRO, tema: "tecnologia" };
    assert.equal(vitrinaDesdeCms(snapDe(homeCompleta()), tecno, ctxV()), tecno);
  });
});

describe("vitrinaDesdeCms — la portada", () => {
  it("con todo publicado, la portada sale del CMS y NADA del registro se filtra", () => {
    const v = vitrinaDesdeCms(snapDe(homeCompleta()), REGISTRO, ctxV());
    assert.deepEqual(v.heroImage, { src: `/catalogo/prueba/vitrina/${ASSET_PORTADA}.webp`, width: 1600, height: 900, alt: "Mujer con un collar", focus: "70% 40%" });
    assert.equal(v.heroEyebrow, "Más que joyas");
    assert.equal(v.heroTitle, "Historias que brillan");
    assert.equal(v.heroDescription, "Diseños únicos.");
    assert.equal(v.heroCta, "Ver todo");
    assert.equal(v.heroHref, "/catalogo/prueba?todo=1");
    assert.notEqual(v.heroTitle, REGISTRO.heroTitle);
    assert.equal(v.tecnologia, undefined);
  });

  it("la marca y el aspecto siguen siendo los del registro (el CMS no los maneja)", () => {
    const v = vitrinaDesdeCms(snapDe(homeCompleta()), REGISTRO, ctxV());
    assert.deepEqual(v.brand, { name: "Tienda de prueba", descriptor: "Joyería" });
    assert.equal(v.tema, "clasico");
    const sinMarca = vitrinaDesdeCms(snapDe(homeCompleta()), {}, ctxV());
    assert.ok(!("brand" in sinMarca) && !("tema" in sinMarca));
  });

  it("una portada estática (la actual de Delacour, sembrada como contenido del CMS) se entrega con su ruta propia", () => {
    const v = vitrinaDesdeCms(snapDe(home()), REGISTRO, ctxV());
    assert.deepEqual(v.heroImage, { src: "/catalogo/prueba/portada.png", width: 1600, height: 900, alt: "Portada de prueba" });
  });

  it("oculta (visible: false): no hay portada, y tampoco se rescata la del registro", () => {
    const h = homeCompleta({ portada: { ...homeCompleta().portada, visible: false } });
    const v = vitrinaDesdeCms(snapDe(h), REGISTRO, ctxV());
    assert.equal(v.heroImage, undefined);
    assert.equal(v.heroTitle, undefined);
    assert.equal(v.heroCta, undefined);
    assert.equal(v.heroHref, undefined);
  });

  it("la sección «portada» fuera de la lista (o desactivada) también la oculta", () => {
    const fuera = vitrinaDesdeCms(snapDe(homeCompleta({ secciones: [{ tipo: "destacados", visible: true }] })), REGISTRO, ctxV());
    assert.equal(fuera.heroImage, undefined);
    const apagada = vitrinaDesdeCms(snapDe(homeCompleta({ secciones: [{ tipo: "portada", visible: false }, { tipo: "destacados", visible: true }] })), REGISTRO, ctxV());
    assert.equal(apagada.heroImage, undefined);
  });

  it("nunca a medias: sin imagen, o con una imagen que no está lista, no hay portada", () => {
    const sinImagen = homeCompleta({ portada: { visible: true, titulo: "Solo texto" } });
    assert.equal(vitrinaDesdeCms(snapDe(sinImagen), REGISTRO, ctxV()).heroTitle, undefined);
    const noLista = homeCompleta({ portada: { visible: true, titulo: "Imagen perdida", imagen: cms("a0000000-0000-4000-8000-0000000000ee") } });
    const v = vitrinaDesdeCms(snapDe(noLista), REGISTRO, ctxV());
    assert.equal(v.heroImage, undefined);
    assert.equal(v.heroTitle, undefined);
  });

  it("sin botón: heroCta queda VACÍO (la tienda no dibuja el botón) y no hay destino", () => {
    const h = homeCompleta({ portada: { visible: true, titulo: "Sin botón", imagen: cms(ASSET_PORTADA) } });
    const v = vitrinaDesdeCms(snapDe(h), REGISTRO, ctxV());
    assert.equal(v.heroCta, "");
    assert.equal(v.heroHref, undefined);
    assert.equal(v.heroTitle, "Sin botón");
  });

  it("un botón cuyo destino desapareció (categoría borrada) no se muestra, aunque la portada sí", () => {
    const h = homeCompleta({ portada: { visible: true, titulo: "Portada", imagen: cms(ASSET_PORTADA), boton: { texto: "Ver aretes", destino: { tipo: "categoria", categoria_id: CAT_BORRADA } } } });
    const v = vitrinaDesdeCms(snapDe(h), REGISTRO, ctxV());
    assert.equal(v.heroTitle, "Portada");
    assert.equal(v.heroCta, "");
    assert.equal(v.heroHref, undefined);
  });

  it("el destino del botón se traduce con el contexto de la tienda (categoría, búsqueda, WhatsApp)", () => {
    const con = (destino: Destino) =>
      vitrinaDesdeCms(snapDe(homeCompleta({ portada: { visible: true, titulo: "Portada", imagen: cms(ASSET_PORTADA), boton: { texto: "Ir", destino } } })), REGISTRO, ctxV());
    assert.equal(con({ tipo: "categoria", categoria_id: CAT_ARETES }).heroHref, `/catalogo/prueba?categoria=${CAT_ARETES}`);
    assert.equal(con({ tipo: "busqueda", consulta: "anillos" }).heroHref, "/catalogo/prueba?q=anillos");
    assert.equal(con({ tipo: "whatsapp" }).heroHref, "https://wa.me/573001112233");
    assert.equal(con({ tipo: "whatsapp" }).heroCta, "Ir");
  });
});

describe("vitrinaDesdeCms — el banner", () => {
  it("visible, con imagen lista: sale con las medidas reales del archivo y su destino", () => {
    const v = vitrinaDesdeCms(snapDe(homeCompleta()), REGISTRO, ctxV());
    assert.deepEqual(v.bannerImage, { src: `/catalogo/prueba/vitrina/${ASSET_BANNER}.webp`, width: 2000, height: 600, alt: "El regalo perfecto" });
    assert.equal(v.bannerHref, `/catalogo/prueba?categoria=${CAT_ARETES}`);
  });

  it("sin destino, o con un destino que ya no existe, el banner es solo una imagen", () => {
    const sinDestino = vitrinaDesdeCms(snapDe(homeCompleta({ banner: { visible: true, imagen: cms(ASSET_BANNER) } })), REGISTRO, ctxV());
    assert.ok(sinDestino.bannerImage);
    assert.equal(sinDestino.bannerHref, undefined);
    const roto = vitrinaDesdeCms(snapDe(homeCompleta({ banner: { visible: true, imagen: cms(ASSET_BANNER), destino: { tipo: "categoria", categoria_id: CAT_BORRADA } } })), REGISTRO, ctxV());
    assert.ok(roto.bannerImage);
    assert.equal(roto.bannerHref, undefined);
  });

  it("oculto, sin imagen lista, ausente o con su sección apagada: no hay banner (y el del registro no reaparece)", () => {
    assert.equal(vitrinaDesdeCms(snapDe(homeCompleta({ banner: { visible: false, imagen: cms(ASSET_BANNER) } })), REGISTRO, ctxV()).bannerImage, undefined);
    assert.equal(vitrinaDesdeCms(snapDe(homeCompleta({ banner: { visible: true, imagen: cms("a0000000-0000-4000-8000-0000000000ee") } })), REGISTRO, ctxV()).bannerImage, undefined);
    assert.equal(vitrinaDesdeCms(snapDe(homeCompleta({ banner: undefined })), REGISTRO, ctxV()).bannerImage, undefined);
    const sinSeccion = homeCompleta({ secciones: [{ tipo: "portada", visible: true }, { tipo: "banner", visible: false }] });
    assert.equal(vitrinaDesdeCms(snapDe(sinSeccion), REGISTRO, ctxV()).bannerImage, undefined);
  });
});

describe("vitrinaDesdeCms — secciones, destacados y categorías", () => {
  it("las secciones son las visibles que la tienda sabe dibujar, en el orden elegido (ofertas y combos se omiten por ahora)", () => {
    const h = homeCompleta({
      secciones: [
        { tipo: "banner", visible: true },
        { tipo: "ofertas", visible: true },
        { tipo: "categorias", visible: false },
        { tipo: "combos", visible: true },
        { tipo: "portada", visible: true },
        { tipo: "campana", visible: true },
      ],
    });
    assert.deepEqual(vitrinaDesdeCms(snapDe(h), REGISTRO, ctxV()).secciones, ["banner", "portada", "campana"]);
  });

  it("cuando la tienda ya las dibuja (contexto), ofertas y combos entran en la lista", () => {
    const h = homeCompleta({ secciones: TODAS_VISIBLES });
    const v = vitrinaDesdeCms(snapDe(h), REGISTRO, ctxV({ dibujadas: SECCIONES_INICIO }));
    assert.deepEqual(v.secciones, [...SECCIONES_HOME]);
  });

  it("una lista vacía de secciones deja la página sin ninguna (la administradora lo decidió)", () => {
    assert.deepEqual(vitrinaDesdeCms(snapDe(homeCompleta({ secciones: [] })), REGISTRO, ctxV()).secciones, []);
  });

  it("los destacados y las categorías elegidos salen en su orden, solo si su sección está visible", () => {
    const v = vitrinaDesdeCms(snapDe(homeCompleta()), REGISTRO, ctxV());
    assert.deepEqual(v.destacados, ["DL-000003", "DL-000001"]);
    assert.deepEqual(v.categoriasDestacadas, [CAT_DIJES, CAT_ARETES]);

    const apagadas = homeCompleta({ secciones: [{ tipo: "portada", visible: true }, { tipo: "destacados", visible: false }, { tipo: "categorias", visible: false }] });
    const w = vitrinaDesdeCms(snapDe(apagadas), REGISTRO, ctxV());
    assert.equal(w.destacados, undefined);
    assert.equal(w.categoriasDestacadas, undefined);
  });

  it("sin elegidos no se inventa nada: la tienda usa su criterio automático", () => {
    const v = vitrinaDesdeCms(snapDe(homeCompleta({ productos_destacados: [], categorias_destacadas: [] })), REGISTRO, ctxV());
    assert.equal(v.destacados, undefined);
    assert.equal(v.categoriasDestacadas, undefined);
  });
});

describe("vitrinaDesdeCms — la campaña vigente", () => {
  const conCampanas = (...campanas: PublicadaCms<"campana">[]) => snapDe(homeCompleta(), { campanas });
  const portadaCampana = { etiqueta: "Temporada", titulo: "Día de la Madre", subtitulo: "Regala una joya.", imagen: cms(ASSET_CAMPANA, "Madre e hija"), boton: { texto: "Ver regalos", destino: { tipo: "busqueda" as const, consulta: "regalo" } } };

  it("una campaña activa con portada sale completa: nombre, portada, imagen, botón y productos", () => {
    const v = vitrinaDesdeCms(conCampanas(publicada("madre", campana({ nombre: "Madres 2026", portada: portadaCampana, productos_destacados: ["DL-000005", "DL-000006"] }))), REGISTRO, ctxV());
    assert.deepEqual(v.campana, {
      nombre: "Madres 2026",
      portada: {
        etiqueta: "Temporada",
        titulo: "Día de la Madre",
        subtitulo: "Regala una joya.",
        imagen: { src: `/catalogo/prueba/vitrina/${ASSET_CAMPANA}.webp`, width: 1200, height: 800, alt: "Madre e hija" },
        boton: { texto: "Ver regalos", href: "/catalogo/prueba?q=regalo" },
      },
      productos: ["DL-000005", "DL-000006"],
    });
  });

  it("una campaña sin portada pero con productos: encabezado con su nombre y sus productos", () => {
    const v = vitrinaDesdeCms(conCampanas(publicada("solo-productos", campana({ nombre: "Pieza del mes", productos_destacados: ["DL-000009"] }))), REGISTRO, ctxV());
    assert.deepEqual(v.campana, { nombre: "Pieza del mes", productos: ["DL-000009"] });
  });

  it("la portada sin imagen propia usa la imagen de la campaña; sin ninguna, queda sin imagen", () => {
    const usa = vitrinaDesdeCms(conCampanas(publicada("c", campana({ imagen: cms(ASSET_CAMPANA, "De la campaña"), portada: { titulo: "Portada" } }))), REGISTRO, ctxV());
    assert.equal(usa.campana?.portada?.imagen?.alt, "De la campaña");
    const sin = vitrinaDesdeCms(conCampanas(publicada("c", campana({ portada: { titulo: "Portada" } }))), REGISTRO, ctxV());
    assert.equal(sin.campana?.portada?.imagen, undefined);
    assert.equal(sin.campana?.portada?.titulo, "Portada");
  });

  it("sin portada ni productos no hay nada que mostrar: se pasa a la siguiente que sí tenga", () => {
    const v = vitrinaDesdeCms(
      conCampanas(publicada("vacia", campana({ nombre: "Vacía", prioridad: 900 })), publicada("con-algo", campana({ nombre: "Con productos", prioridad: 10, productos_destacados: ["DL-000001"] }))),
      REGISTRO,
      ctxV(),
    );
    assert.equal(v.campana?.nombre, "Con productos");
    assert.equal(vitrinaDesdeCms(conCampanas(publicada("vacia", campana())), REGISTRO, ctxV()).campana, undefined);
  });

  it("solo una: gana la de mayor prioridad; en empate, la más antigua; luego el código (sin depender del orden de llegada)", () => {
    const a = publicada("alfa", campana({ nombre: "Alfa", prioridad: 5, productos_destacados: ["DL-000001"] }), { creadaAt: "2026-10-02T00:00:00.000Z" });
    const b = publicada("beta", campana({ nombre: "Beta", prioridad: 5, productos_destacados: ["DL-000001"] }), { creadaAt: "2026-10-01T00:00:00.000Z" });
    const c = publicada("gamma", campana({ nombre: "Gamma", prioridad: 9, productos_destacados: ["DL-000001"] }));
    for (const orden of [[a, b, c], [c, b, a], [b, c, a]]) assert.equal(vitrinaDesdeCms(conCampanas(...orden), REGISTRO, ctxV()).campana?.nombre, "Gamma");
    for (const orden of [[a, b], [b, a]]) assert.equal(vitrinaDesdeCms(conCampanas(...orden), REGISTRO, ctxV()).campana?.nombre, "Beta");
    const d = publicada("delta", campana({ nombre: "Delta", prioridad: 5, productos_destacados: ["DL-000001"] }), { creadaAt: "2026-10-01T00:00:00.000Z" });
    for (const orden of [[b, d], [d, b]]) assert.equal(vitrinaDesdeCms(conCampanas(...orden), REGISTRO, ctxV()).campana?.nombre, "Beta"); // "beta" < "delta"
  });

  it("vencida, programada o de otra modalidad (mayorista) NO se muestra a un cliente detal", () => {
    const vencida = publicada("v", campana({ vigencia: { desde: "2026-09-01", hasta: "2026-09-30" }, productos_destacados: ["DL-000001"] }));
    const programada = publicada("p", campana({ vigencia: { desde: "2026-11-01", hasta: "2026-11-30" }, productos_destacados: ["DL-000001"] }));
    const mayorista = publicada("m", campana({ modalidad: "mayorista", productos_destacados: ["DL-000001"] }));
    assert.equal(vitrinaDesdeCms(conCampanas(vencida, programada, mayorista), REGISTRO, ctxV()).campana, undefined);
  });

  it("el límite de la vigencia (hora de Bogotá): «hasta el 31» incluye todo el 31 y el instante siguiente ya no; «desde el 25» empieza a las 00:00", () => {
    const camp = publicada("k", campana({ vigencia: { desde: "2026-10-25", hasta: "2026-10-31" }, productos_destacados: ["DL-000001"] }));
    const antesDeEmpezar = Date.parse("2026-10-24T23:59:00-05:00");
    const empieza = Date.parse("2026-10-25T00:00:00-05:00");
    const ultimoMinuto = Date.parse("2026-10-31T23:59:00-05:00");
    const siguiente = Date.parse("2026-11-01T00:00:00-05:00");
    assert.equal(vitrinaDesdeCms(conCampanas(camp), REGISTRO, ctxV({ ahora: antesDeEmpezar })).campana, undefined);
    assert.ok(vitrinaDesdeCms(conCampanas(camp), REGISTRO, ctxV({ ahora: empieza })).campana);
    assert.ok(vitrinaDesdeCms(conCampanas(camp), REGISTRO, ctxV({ ahora: ultimoMinuto })).campana);
    assert.equal(vitrinaDesdeCms(conCampanas(camp), REGISTRO, ctxV({ ahora: siguiente })).campana, undefined);
  });

  it("con la sección «campaña» oculta no se muestra aunque esté vigente", () => {
    const h = homeCompleta({ secciones: [{ tipo: "portada", visible: true }, { tipo: "campana", visible: false }] });
    const v = vitrinaDesdeCms(snapDe(h, { campanas: [publicada("k", campana({ productos_destacados: ["DL-000001"] }))] }), REGISTRO, ctxV());
    assert.equal(v.campana, undefined);
    assert.deepEqual(v.secciones, ["portada"]);
  });

  it("el botón de la campaña que lleva a la propia campaña funciona (ancla) y uno a una oferta aún no dibujada no se muestra", () => {
    const a = vitrinaDesdeCms(conCampanas(publicada("k", campana({ portada: { titulo: "Campaña", boton: { texto: "Mira", destino: { tipo: "campana", clave: "k" } } } }))), REGISTRO, ctxV());
    assert.equal(a.campana?.portada?.boton?.href, "/catalogo/prueba#campana");
    const b = vitrinaDesdeCms(
      snapDe(homeCompleta(), { ofertas: [publicada("of", oferta())], campanas: [publicada("k", campana({ portada: { titulo: "Campaña", boton: { texto: "Ofertas", destino: { tipo: "oferta", clave: "of" } } } }))] }),
      REGISTRO,
      ctxV(),
    );
    assert.equal(b.campana?.portada?.boton, undefined);
    assert.equal(b.campana?.portada?.titulo, "Campaña");
  });
});

describe("vitrinaDesdeCms — pureza", () => {
  it("no modifica lo que recibe (instantánea y registro congelados) y da siempre el mismo resultado", () => {
    const snap = congelar(
      snapDe(homeCompleta(), { campanas: [publicada("k", campana({ portada: { titulo: "Campaña", imagen: cms(ASSET_CAMPANA) }, productos_destacados: ["DL-000001"] }))] }),
    );
    const registro = congelar(structuredClone(REGISTRO));
    const ctx = congelar(ctxV());
    const uno = vitrinaDesdeCms(snap, registro, ctx);
    const dos = vitrinaDesdeCms(snap, registro, ctx);
    assert.deepEqual(uno, dos);
    assert.notEqual(uno, registro);
  });

  it("seccionesDeInicio: sin contenido del CMS, el orden de siempre; con él, el elegido", () => {
    assert.deepEqual(seccionesDeInicio(REGISTRO), ORDEN_INICIO_CLASICO);
    assert.deepEqual(seccionesDeInicio({ secciones: ["banner", "portada"] }), ["banner", "portada"]);
    assert.deepEqual(seccionesDeInicio({ secciones: [] }), []);
  });
});
