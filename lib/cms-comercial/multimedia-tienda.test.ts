/**
 * CMS comercial — de las fotos y videos PUBLICADOS a lo que la tienda de joyería dibuja: qué se reemplaza, qué vuelve a lo de siempre y que nada se rompa ni se invente.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PublicHome } from "@/lib/catalogo/service";
import { joyeriaOf, storefrontConfigFor, type ConfigJoyeria } from "@/lib/catalogo/vitrina";
import { aplicarCategorias, aplicarMultimedia, aplicarVideoMayoristas, multimediaDesdeCms, type MultimediaTienda } from "@/lib/cms-comercial/multimedia-tienda";
import { cargarMultimediaPublica, PLAZO_MULTIMEDIA_MS, type DepsMultimediaPublica } from "@/lib/cms-comercial/multimedia-publica";
import type { AssetPublicoCms, InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { CAT_ARETES, CAT_DIJES, TENANT_A, instantanea, multimedia, publicada } from "@/lib/cms-comercial/testing/fixtures";

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const V = { portadaH: id(1), portadaV: id(2), colH: id(3), colV: id(4), marca: id(5), mayor: id(6) };
const P = { portadaH: id(11), portadaV: id(12), colH: id(13), colV: id(14), marca: id(15), mayor: id(16) };
const IMG_ARETES = id(21);
const SLUG = "delacour";

const video = (ident: string, ancho: number, alto: number, mimeType = "video/mp4"): AssetPublicoCms => ({ id: ident, storagePath: `${TENANT_A}/cms/${ident}/video.mp4`, mimeType, ancho, alto });
const imagen = (ident: string, ancho = 1280, alto = 720, mimeType = "image/webp"): AssetPublicoCms => ({ id: ident, storagePath: `${TENANT_A}/cms/${ident}/imagen.webp`, mimeType, ancho, alto });
const ref = (v: string, p: string) => ({ video: v, poster: p });

const ASSETS: AssetPublicoCms[] = [
  video(V.portadaH, 1280, 720),
  video(V.portadaV, 720, 1280),
  video(V.colH, 1920, 1080),
  video(V.colV, 1080, 1920),
  video(V.marca, 720, 900),
  video(V.mayor, 1280, 576),
  ...Object.values(P).map((p) => imagen(p)),
  imagen(IMG_ARETES, 800, 1000),
];

const COMPLETO = multimedia({
  videos: {
    portada: { horizontal: ref(V.portadaH, P.portadaH), vertical: ref(V.portadaV, P.portadaV) },
    coleccion: { horizontal: ref(V.colH, P.colH), vertical: ref(V.colV, P.colV) },
    marca: { horizontal: ref(V.marca, P.marca) },
    mayoristas: { horizontal: ref(V.mayor, P.mayor) },
  },
  categorias: [{ categoria_id: CAT_ARETES, imagen: { origen: "cms", asset: IMG_ARETES, alt: "Aretes dorados" } }],
});

const snap = (contenido: Parameters<typeof multimedia>[0] = COMPLETO, assets: AssetPublicoCms[] = ASSETS): InstantaneaCms => instantanea({ multimedia: publicada("multimedia", multimedia(contenido)), assets });
const ruta = (r: ReturnType<typeof multimediaDesdeCms>) => JSON.stringify(r);

describe("multimediaDesdeCms — lo que se puede mostrar de lo publicado", () => {
  it("sin fotos y videos publicados, o publicados vacíos, no hay nada que mostrar", () => {
    assert.equal(multimediaDesdeCms(instantanea({ assets: ASSETS }), SLUG), null);
    assert.equal(multimediaDesdeCms(snap({}), SLUG), null);
    assert.equal(multimediaDesdeCms(snap({ videos: {}, categorias: [] }), SLUG), null);
  });

  it("los cuatro espacios con sus archivos: rutas propias de la tienda (nunca de Storage), medidas reales y la imagen fija de cada uno", () => {
    const m = multimediaDesdeCms(snap(), SLUG);
    assert.ok(m);
    assert.deepEqual(m.videos.portada, {
      horizontal: { src: `/catalogo/delacour/vitrina/${V.portadaH}.mp4`, poster: `/catalogo/delacour/vitrina/${P.portadaH}.webp`, width: 1280, height: 720 },
      vertical: { src: `/catalogo/delacour/vitrina/${V.portadaV}.mp4`, poster: `/catalogo/delacour/vitrina/${P.portadaV}.webp`, width: 720, height: 1280 },
    });
    assert.deepEqual(m.videos.coleccion?.horizontal, { src: `/catalogo/delacour/vitrina/${V.colH}.mp4`, poster: `/catalogo/delacour/vitrina/${P.colH}.webp`, width: 1920, height: 1080 });
    assert.deepEqual(m.videos.marca, { horizontal: { src: `/catalogo/delacour/vitrina/${V.marca}.mp4`, poster: `/catalogo/delacour/vitrina/${P.marca}.webp`, width: 720, height: 900 } });
    assert.deepEqual(m.videos.mayoristas?.horizontal, { src: `/catalogo/delacour/vitrina/${V.mayor}.mp4`, poster: `/catalogo/delacour/vitrina/${P.mayor}.webp`, width: 1280, height: 576 });
    assert.deepEqual([...m.categorias], [[CAT_ARETES, { src: `/catalogo/delacour/vitrina/${IMG_ARETES}.webp`, ancho: 800, alto: 1000 }]]);
    assert.ok(!ruta(m).includes("supabase") && !ruta(m).includes(TENANT_A), "ni direcciones de Storage ni ids del negocio");
  });

  it("solo los espacios elegidos: lo demás no aparece", () => {
    const m = multimediaDesdeCms(snap({ videos: { marca: { horizontal: ref(V.marca, P.marca) } } }), SLUG);
    assert.deepEqual(Object.keys(m?.videos ?? {}), ["marca"]);
    assert.equal(m?.categorias.size, 0);
  });

  it("sin video vertical, el espacio solo lleva el horizontal (el celular lo usa recortado)", () => {
    const m = multimediaDesdeCms(snap({ videos: { portada: { horizontal: ref(V.portadaH, P.portadaH) } } }), SLUG);
    assert.deepEqual(Object.keys(m?.videos.portada ?? {}), ["horizontal"]);
  });

  it("un archivo que ya no está listo, que no es un MP4 o cuya imagen fija no sirve deja ESE espacio con el video de siempre", () => {
    const sinVideo = ASSETS.filter((a) => a.id !== V.marca);
    assert.equal(multimediaDesdeCms(snap(COMPLETO, sinVideo), SLUG)?.videos.marca, undefined, "video ausente");
    const noMp4 = ASSETS.map((a) => (a.id === V.marca ? video(V.marca, 720, 900, "video/webm") : a));
    assert.equal(multimediaDesdeCms(snap(COMPLETO, noMp4), SLUG)?.videos.marca, undefined, "no es un MP4");
    const sinPoster = ASSETS.filter((a) => a.id !== P.marca);
    assert.equal(multimediaDesdeCms(snap(COMPLETO, sinPoster), SLUG)?.videos.marca, undefined, "sin imagen fija");
    const posterVideo = ASSETS.map((a) => (a.id === P.marca ? imagen(P.marca, 1280, 720, "video/mp4") : a));
    assert.equal(multimediaDesdeCms(snap(COMPLETO, posterVideo), SLUG)?.videos.marca, undefined, "la imagen fija no es una imagen");
    // y los demás espacios siguen
    for (const espacio of ["portada", "coleccion", "mayoristas"] as const) assert.ok(multimediaDesdeCms(snap(COMPLETO, sinVideo), SLUG)?.videos[espacio], espacio);
  });

  it("las medidas del archivo se vuelven a comprobar contra las del espacio: un video vertical en un espacio horizontal, o fuera de rango, no se muestra", () => {
    const vertEnHorizontal = ASSETS.map((a) => (a.id === V.portadaH ? video(V.portadaH, 720, 1280) : a));
    assert.equal(multimediaDesdeCms(snap(COMPLETO, vertEnHorizontal), SLUG)?.videos.portada, undefined);
    const enorme = ASSETS.map((a) => (a.id === V.colH ? video(V.colH, 3840, 2160) : a));
    assert.equal(multimediaDesdeCms(snap(COMPLETO, enorme), SLUG)?.videos.coleccion, undefined);
    const diminuto = ASSETS.map((a) => (a.id === V.mayor ? video(V.mayor, 320, 144) : a));
    assert.equal(multimediaDesdeCms(snap(COMPLETO, diminuto), SLUG)?.videos.mayoristas, undefined);
  });

  it("si el horizontal no sirve, el espacio vuelve a lo de siempre COMPLETO (aunque el vertical sí sirva); si solo falla el vertical, se queda el horizontal", () => {
    const horizontalMalo = ASSETS.filter((a) => a.id !== V.portadaH);
    assert.equal(multimediaDesdeCms(snap(COMPLETO, horizontalMalo), SLUG)?.videos.portada, undefined);
    const verticalMalo = ASSETS.filter((a) => a.id !== V.portadaV);
    const p = multimediaDesdeCms(snap(COMPLETO, verticalMalo), SLUG)?.videos.portada;
    assert.ok(p?.horizontal);
    assert.equal(p?.vertical, undefined);
  });

  it("las imágenes de categoría: solo las que existen y están listas", () => {
    const sinImagen = ASSETS.filter((a) => a.id !== IMG_ARETES);
    assert.equal(multimediaDesdeCms(snap(COMPLETO, sinImagen), SLUG)?.categorias.size, 0);
    const dos = multimedia({
      categorias: [
        { categoria_id: CAT_ARETES, imagen: { origen: "cms", asset: IMG_ARETES, alt: "Aretes" } },
        { categoria_id: CAT_DIJES, imagen: { origen: "cms", asset: id(99), alt: "Dijes" } },
      ],
    });
    assert.deepEqual([...(multimediaDesdeCms(snap(dos), SLUG)?.categorias.keys() ?? [])], [CAT_ARETES]);
  });

  it("si nada de lo elegido se puede mostrar, no hay nada que mostrar", () => {
    assert.equal(multimediaDesdeCms(snap(COMPLETO, []), SLUG), null);
  });
});

const config = (): ConfigJoyeria => {
  const j = joyeriaOf(storefrontConfigFor("delacour"));
  assert.ok(j);
  return j;
};
const archivo = (nombre: string, w = 1280, h = 720) => ({ src: `/catalogo/delacour/vitrina/${nombre}.mp4`, poster: `/catalogo/delacour/vitrina/${nombre}.webp`, width: w, height: h });

describe("aplicarMultimedia — los videos de la tienda con los de la administradora", () => {
  it("sin nada que reemplazar devuelve EXACTAMENTE la misma configuración (la tienda se ve idéntica a hoy)", () => {
    const j = config();
    assert.equal(aplicarMultimedia(j, null), j);
    assert.equal(aplicarMultimedia(j, { videos: {}, categorias: new Map() }), j);
    assert.equal(aplicarMultimedia(j, { videos: {}, categorias: new Map([[CAT_ARETES, { src: "/x.webp", ancho: 1, alto: 1 }]]) }), j, "solo categorías: los videos no cambian");
  });

  it("reemplaza la portada: horizontal y vertical nuevos, la etiqueta de siempre y sin el punto focal de la escena anterior", () => {
    const j = config();
    const m: MultimediaTienda = { videos: { portada: { horizontal: archivo("nuevo-h"), vertical: archivo("nuevo-v", 720, 1280) } }, categorias: new Map() };
    const r = aplicarMultimedia(j, m);
    assert.notEqual(r, j);
    assert.equal(r.portada?.video.foco, undefined);
    assert.deepEqual(r.portada?.video, { horizontal: archivo("nuevo-h"), vertical: archivo("nuevo-v", 720, 1280), etiqueta: "Video de la portada" });
    // lo demás es la MISMA cosa que antes
    assert.equal(r.coleccion, j.coleccion);
    assert.equal(r.marca, j.marca);
    assert.equal(r.mayoristas, j.mayoristas);
    assert.equal(r.anuncios, j.anuncios);
    assert.equal(r.acabados, j.acabados);
  });

  it("con un video nuevo SIN vertical, el celular usa el horizontal nuevo: no queda el vertical de siempre (es de otra escena)", () => {
    const j = config();
    assert.ok(j.coleccion?.video.vertical, "la tienda trae su vertical");
    const r = aplicarMultimedia(j, { videos: { coleccion: { horizontal: archivo("c-h", 1920, 1080) } }, categorias: new Map() });
    assert.equal(r.coleccion?.video.vertical, undefined);
    assert.deepEqual(r.coleccion?.video.horizontal, archivo("c-h", 1920, 1080));
  });

  it("los textos de cada bloque no se tocan", () => {
    const j = config();
    const r = aplicarMultimedia(j, { videos: { coleccion: { horizontal: archivo("c-h") }, marca: { horizontal: archivo("m", 720, 900) }, mayoristas: { horizontal: archivo("y", 1280, 576) } }, categorias: new Map() });
    assert.deepEqual({ ...r.coleccion, video: undefined }, { ...j.coleccion, video: undefined });
    assert.equal(r.marca?.titulo, j.marca?.titulo);
    assert.equal(r.mayoristas?.titulo, j.mayoristas?.titulo);
    assert.equal(r.mayoristas?.pagina, j.mayoristas?.pagina);
    assert.equal(r.mayoristas?.video?.etiqueta, "Video de compras por mayor");
    assert.equal(r.mayoristas?.video?.foco, undefined, "el foco de 72% 46% era de la escena de siempre");
  });

  it("no inventa bloques: solo reemplaza el video de un espacio que la tienda ya tiene", () => {
    const base = config();
    const sinBloques: ConfigJoyeria = { ...base, portada: undefined, coleccion: undefined, marca: undefined, mayoristas: base.mayoristas && { ...base.mayoristas, video: undefined } };
    const todo: MultimediaTienda = { videos: { portada: { horizontal: archivo("a") }, coleccion: { horizontal: archivo("b") }, marca: { horizontal: archivo("c") }, mayoristas: { horizontal: archivo("d") } }, categorias: new Map() };
    const r = aplicarMultimedia(sinBloques, todo);
    assert.equal(r, sinBloques, "ni portada, ni colección, ni marca, ni video de mayoristas que reemplazar");
    assert.equal(r.portada, undefined);
    assert.equal(r.coleccion, undefined);
    assert.equal(r.marca, undefined);
    assert.equal(r.mayoristas?.video, undefined);
  });

  it("no modifica la configuración original (es la del registro de la tienda y se comparte)", () => {
    const j = config();
    const copia = structuredClone(j);
    aplicarMultimedia(j, { videos: { portada: { horizontal: archivo("a") }, coleccion: { horizontal: archivo("b") }, marca: { horizontal: archivo("c") }, mayoristas: { horizontal: archivo("d") } }, categorias: new Map() });
    assert.deepEqual(j, copia);
  });

  it("aplicarVideoMayoristas: la banda y la página de mayoristas usan el mismo video; sin video de siempre o sin cambio, el mismo objeto", () => {
    const m = config().mayoristas!;
    const nuevo: MultimediaTienda = { videos: { mayoristas: { horizontal: archivo("y", 1280, 576) } }, categorias: new Map() };
    assert.deepEqual(aplicarVideoMayoristas(m, nuevo).video?.horizontal, archivo("y", 1280, 576));
    assert.equal(aplicarVideoMayoristas(m, null), m);
    assert.equal(aplicarVideoMayoristas(m, { videos: {}, categorias: new Map() }), m);
    const sinVideo = { ...m, video: undefined };
    assert.equal(aplicarVideoMayoristas(sinVideo, nuevo), sinVideo);
  });
});

const categoria = (idc: string, nombre: string, cover: string | null) => ({ id: idc, name: nombre, coverUrl: cover }) as PublicHome["categories"][number];

describe("aplicarCategorias — la imagen de presentación de cada categoría", () => {
  const lista = [categoria(CAT_ARETES, "Aretes", "/foto-producto.webp"), categoria(CAT_DIJES, "Dijes", null)];

  it("sin nada elegido devuelve EXACTAMENTE la misma lista", () => {
    assert.equal(aplicarCategorias(lista, null), lista);
    assert.equal(aplicarCategorias(lista, { videos: {}, categorias: new Map() }), lista);
    assert.equal(aplicarCategorias(lista, { videos: {}, categorias: new Map([[id(77), { src: "/otra.webp", ancho: 1, alto: 1 }]]) }), lista, "una categoría que no está en el inicio");
  });

  it("la categoría con imagen elegida la usa en lugar de la foto de un producto; las demás conservan la suya", () => {
    const r = aplicarCategorias(lista, { videos: {}, categorias: new Map([[CAT_DIJES, { src: "/catalogo/delacour/vitrina/x.webp", ancho: 800, alto: 1000 }]]) });
    assert.deepEqual(r.map((c) => [c.id, c.coverUrl]), [[CAT_ARETES, "/foto-producto.webp"], [CAT_DIJES, "/catalogo/delacour/vitrina/x.webp"]]);
    assert.equal(r[0], lista[0], "la que no cambia es el mismo objeto");
    assert.equal(lista[1].coverUrl, null, "la lista original no se toca");
  });

  it("conserva el orden y los demás datos de la categoría", () => {
    const r = aplicarCategorias(lista, { videos: {}, categorias: new Map([[CAT_ARETES, { src: "/n.webp", ancho: 1, alto: 1 }]]) });
    assert.deepEqual(r.map((c) => c.name), ["Aretes", "Dijes"]);
    assert.equal(r[0].coverUrl, "/n.webp");
  });
});

describe("cargarMultimediaPublica — nunca rompe ni demora la tienda", () => {
  const deps = (over: Partial<DepsMultimediaPublica> = {}): { d: DepsMultimediaPublica; fallos: unknown[]; vistas: string[] } => {
    const fallos: unknown[] = [];
    const vistas: string[] = [];
    return {
      d: { tenantDe: async (s) => (vistas.push(s), s === SLUG ? TENANT_A : null), cargar: async () => snap(), alFallar: (e) => void fallos.push(e), ...over },
      fallos,
      vistas,
    };
  };

  it("entrega lo publicado, listo para dibujar", async () => {
    const { d, vistas } = deps();
    const m = await cargarMultimediaPublica(d, SLUG);
    assert.ok(m?.videos.portada && m.categorias.size === 1);
    assert.deepEqual(vistas, [SLUG]);
  });

  it("tienda inexistente, CMS apagado o nada publicado: null, sin avisar de ninguna falla", async () => {
    const a = deps();
    assert.equal(await cargarMultimediaPublica(a.d, "otra"), null);
    const b = deps({ cargar: async () => null });
    assert.equal(await cargarMultimediaPublica(b.d, SLUG), null);
    const c = deps({ cargar: async () => instantanea() });
    assert.equal(await cargarMultimediaPublica(c.d, SLUG), null);
    assert.deepEqual([a.fallos, b.fallos, c.fallos], [[], [], []]);
  });

  it("un error de la base de datos, o de quien lo avisa: null, y se avisa una vez sin contenido del negocio", async () => {
    const { d, fallos } = deps({ cargar: async () => Promise.reject(new Error("db caída")) });
    assert.equal(await cargarMultimediaPublica(d, SLUG), null);
    assert.equal(fallos.length, 1);
    const roto = deps({ cargar: async () => Promise.reject(new Error("x")), alFallar: () => Promise.reject(new Error("el aviso también falla")) as never });
    assert.equal(await cargarMultimediaPublica({ ...roto.d, alFallar: () => { throw new Error("el aviso también falla"); } }, SLUG), null);
  });

  it("una lectura demasiado lenta se rinde y la tienda se ve como siempre", async () => {
    const { d, fallos } = deps({ cargar: () => new Promise(() => {}), plazoMs: 20 });
    const inicio = Date.now();
    assert.equal(await cargarMultimediaPublica(d, SLUG), null);
    assert.ok(Date.now() - inicio < 1500);
    assert.equal(fallos.length, 1);
    assert.match(String((fallos[0] as Error).message), /tardó demasiado/);
    assert.equal(PLAZO_MULTIMEDIA_MS, 2000);
  });

  it("sin aviso propio, la falla se registra en consola y no se lanza", async () => {
    const original = console.error;
    const registros: unknown[][] = [];
    console.error = (...a: unknown[]) => void registros.push(a);
    try {
      assert.equal(await cargarMultimediaPublica({ tenantDe: async () => TENANT_A, cargar: async () => Promise.reject(new Error("db caída")) }, SLUG), null);
    } finally {
      console.error = original;
    }
    assert.equal(registros.length, 1);
    assert.match(String(registros[0][0]), /multimedia/);
  });
});
