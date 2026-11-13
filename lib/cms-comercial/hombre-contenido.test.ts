/**
 * CMS comercial — el LADO DE HOMBRE de la tienda (Delacour · Vértice) dentro de las mismas entidades, SIN migración: el contenido de hombre vive en `home.hombre` y `multimedia.hombre` con el mismo ciclo
 * borrador → publicar. Se prueba lo puro: los esquemas (estrictos, con los mismos límites que el lado de siempre), lo que la validación comprueba de lo de hombre, qué archivos puede servir la ruta
 * pública, y qué se dibuja del contenido publicado (videos, imágenes de categoría, destacados y categorías elegidos), siempre con lo de siempre intacto. Negocio y archivos FICTICIOS.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeSchema, multimediaSchema } from "@/lib/cms-comercial/esquemas";
import { contenidoHombreDesdeCms, multimediaDesdeCms, videosDeHombre } from "@/lib/cms-comercial/multimedia-tienda";
import { cargarContenidoHombrePublicado, type DepsMultimediaPublica } from "@/lib/cms-comercial/multimedia-publica";
import type { AssetPublicoCms, InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { assetsReferenciados, videosReferenciados } from "@/lib/cms-comercial/vitrina";
import { dependenciasDe, etiquetaDeCampo } from "@/lib/cms-comercial/validacion";
import { CAT_ARETES, CAT_DIJES, TENANT_A, home, instantanea, multimedia, publicada } from "@/lib/cms-comercial/testing/fixtures";

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const V = { portadaH: id(1), portadaV: id(2), colH: id(3), marca: id(5), mujerPortada: id(7) };
const P = { portadaH: id(11), portadaV: id(12), colH: id(13), marca: id(15), mujerPortada: id(17) };
const IMG_DIJES = id(21);
const IMG_MUJER = id(22);
const SLUG = "delacour";

const video = (ident: string, ancho: number, alto: number): AssetPublicoCms => ({ id: ident, storagePath: `${TENANT_A}/cms/${ident}/video.mp4`, mimeType: "video/mp4", ancho, alto });
const imagen = (ident: string, ancho = 1280, alto = 720): AssetPublicoCms => ({ id: ident, storagePath: `${TENANT_A}/cms/${ident}/imagen.webp`, mimeType: "image/webp", ancho, alto });
const ref = (v: string, p: string) => ({ video: v, poster: p });

const ASSETS: AssetPublicoCms[] = [
  video(V.portadaH, 1280, 720),
  video(V.portadaV, 720, 1280),
  video(V.colH, 1920, 1080),
  video(V.marca, 720, 900),
  video(V.mujerPortada, 1280, 720),
  ...Object.values(P).map((p) => imagen(p)),
  imagen(IMG_DIJES, 800, 1000),
  imagen(IMG_MUJER, 800, 1000),
];

/** Lo publicado de hombre: portada (con vertical), colección y marca, la imagen de «Dijes», y sus destacados y categorías. */
const MULTIMEDIA_HOMBRE = {
  videos: { portada: { horizontal: ref(V.portadaH, P.portadaH), vertical: ref(V.portadaV, P.portadaV) }, coleccion: { horizontal: ref(V.colH, P.colH) }, marca: { horizontal: ref(V.marca, P.marca) } },
  categorias: [{ categoria_id: CAT_DIJES, imagen: { origen: "cms" as const, asset: IMG_DIJES, alt: "Dijes de acero" } }],
};
const HOME_HOMBRE = { categorias_destacadas: [CAT_DIJES, CAT_ARETES], productos_destacados: ["DL-000844", "DL-000843"] };

const snap = (over: { multimedia?: Parameters<typeof multimedia>[0]; home?: Parameters<typeof home>[0]; assets?: AssetPublicoCms[] } = {}): InstantaneaCms =>
  instantanea({
    ...(over.multimedia ? { multimedia: publicada("multimedia", multimedia(over.multimedia)) } : {}),
    ...(over.home ? { home: publicada("home", home(over.home)) } : {}),
    assets: over.assets ?? ASSETS,
  });

describe("esquemas: el lado de hombre dentro de home y multimedia", () => {
  it("home acepta `hombre` con sus categorías y productos destacados (los mismos límites que el lado de siempre) y sigue aceptando el contenido de siempre sin él", () => {
    assert.equal(homeSchema.safeParse(home()).success, true, "sin hombre sigue siendo válido");
    assert.equal(homeSchema.safeParse(home({ hombre: HOME_HOMBRE })).success, true);
    const mucho = homeSchema.safeParse(home({ hombre: { categorias_destacadas: [], productos_destacados: Array.from({ length: 25 }, (_, i) => `DL-${String(i + 1).padStart(6, "0")}`) } }));
    assert.equal(mucho.success, false);
    assert.match(JSON.stringify(mucho.error?.issues), /Máximo 24 productos destacados/);
    const repetido = homeSchema.safeParse(home({ hombre: { categorias_destacadas: [CAT_DIJES, CAT_DIJES], productos_destacados: [] } }));
    assert.equal(repetido.success, false);
    assert.match(JSON.stringify(repetido.error?.issues), /no puede repetirse/);
  });

  it("home.hombre es estricto: no admite claves ajenas (ni portada ni banner: el inicio de hombre tiene su propia portada de la colección)", () => {
    for (const extra of [{ portada: {} }, { banner: {} }, { raro: 1 }]) {
      assert.equal(homeSchema.safeParse({ ...home(), hombre: { ...HOME_HOMBRE, ...extra } }).success, false, JSON.stringify(extra));
    }
  });

  it("multimedia acepta `hombre.videos` (portada, colección y marca) e `hombre.categorias`; los mayoristas NO son del lado de hombre", () => {
    assert.equal(multimediaSchema.safeParse({ hombre: MULTIMEDIA_HOMBRE }).success, true);
    assert.equal(multimediaSchema.safeParse({}).success, true, "vacío sigue siendo válido");
    assert.equal(multimediaSchema.safeParse({ hombre: { videos: { mayoristas: { horizontal: ref(V.portadaH, P.portadaH) } } } }).success, false);
    assert.equal(multimediaSchema.safeParse({ hombre: { mayoristas: { titulo: "x" } } }).success, false);
  });

  it("las imágenes de categoría de hombre tienen el mismo tope y la misma regla de no repetir", () => {
    const repetida = multimediaSchema.safeParse({ hombre: { categorias: [MULTIMEDIA_HOMBRE.categorias[0], MULTIMEDIA_HOMBRE.categorias[0]] } });
    assert.equal(repetida.success, false);
    assert.match(JSON.stringify(repetida.error?.issues), /Una categoría no puede repetirse/);
  });
});

describe("validación: lo de hombre se comprueba igual que lo de siempre", () => {
  it("home: sus categorías y productos destacados quedan como dependencias a verificar, con su campo «hombre.…»", () => {
    const d = dependenciasDe("home", home({ hombre: HOME_HOMBRE }));
    assert.deepEqual(d.categorias.filter((c) => c.campo.startsWith("hombre.")).map((c) => [c.valor, c.campo]), [[CAT_DIJES, "hombre.categorias_destacadas.0"], [CAT_ARETES, "hombre.categorias_destacadas.1"]]);
    assert.deepEqual(d.referencias.filter((r) => r.campo.startsWith("hombre.")).map((r) => [r.valor, r.campo]), [["DL-000844", "hombre.productos_destacados.0"], ["DL-000843", "hombre.productos_destacados.1"]]);
  });

  it("multimedia: sus videos (con el espacio donde van, para comprobar las medidas), sus imágenes fijas y las imágenes de sus categorías", () => {
    const d = dependenciasDe("multimedia", multimedia({ videos: { portada: { horizontal: ref(V.mujerPortada, P.mujerPortada) } }, hombre: MULTIMEDIA_HOMBRE }));
    const deHombre = d.videos.filter((v) => v.campo.startsWith("hombre."));
    assert.deepEqual(deHombre.map((v) => [v.archivo, v.valor]), [["portada.horizontal", V.portadaH], ["portada.vertical", V.portadaV], ["coleccion.horizontal", V.colH], ["marca.horizontal", V.marca]]);
    assert.ok(deHombre.every((v) => /^hombre\.videos\.\w+\.(horizontal|vertical)\.video$/.test(v.campo)));
    assert.deepEqual(d.assets.filter((a) => a.campo.startsWith("hombre.")).map((a) => a.valor).sort(), [P.portadaH, P.portadaV, P.colH, P.marca, IMG_DIJES].sort());
    assert.deepEqual(d.categorias.filter((c) => c.campo.startsWith("hombre.")).map((c) => c.campo), ["hombre.categorias.0.categoria_id"]);
    // lo de siempre no se mezcla con lo de hombre
    assert.deepEqual(d.videos.filter((v) => !v.campo.startsWith("hombre.")).map((v) => v.valor), [V.mujerPortada]);
  });

  it("los mensajes nombran el lado: «Lado de hombre · Video de la portada»", () => {
    assert.equal(etiquetaDeCampo("hombre.videos.portada.horizontal"), "Lado de hombre · Portada · pantalla horizontal");
    assert.equal(etiquetaDeCampo("hombre.categorias.2.imagen"), "Lado de hombre · Imagen de la categoría");
    assert.equal(etiquetaDeCampo("hombre.productos_destacados.0"), "Lado de hombre · Productos destacados");
    assert.equal(etiquetaDeCampo("hombre"), "Lado de hombre");
    assert.equal(etiquetaDeCampo("productos_destacados.0"), "Productos destacados", "lo de siempre se llama como siempre");
  });
});

describe("lo que la ruta pública puede servir incluye lo de hombre (y solo lo publicado)", () => {
  it("las imágenes fijas de sus videos y las imágenes de sus categorías están referenciadas; sus videos también", () => {
    const s = snap({ multimedia: { hombre: MULTIMEDIA_HOMBRE } });
    const imagenes = assetsReferenciados(s);
    for (const p of [P.portadaH, P.portadaV, P.colH, P.marca, IMG_DIJES]) assert.ok(imagenes.has(p), p);
    const videos = videosReferenciados(s);
    for (const v of [V.portadaH, V.portadaV, V.colH, V.marca]) assert.ok(videos.has(v), v);
  });

  it("lo de siempre y lo de hombre se suman sin pisarse, y sin nada publicado no hay nada referenciado", () => {
    const s = snap({ multimedia: { videos: { portada: { horizontal: ref(V.mujerPortada, P.mujerPortada) } }, categorias: [{ categoria_id: CAT_ARETES, imagen: { origen: "cms", asset: IMG_MUJER, alt: "Aretes" } }], hombre: MULTIMEDIA_HOMBRE } });
    assert.ok(videosReferenciados(s).has(V.mujerPortada) && videosReferenciados(s).has(V.portadaH));
    assert.ok(assetsReferenciados(s).has(IMG_MUJER) && assetsReferenciados(s).has(IMG_DIJES));
    assert.equal(videosReferenciados(instantanea({ assets: ASSETS })).size, 0);
    assert.equal(assetsReferenciados(instantanea({ assets: ASSETS })).size, 0);
  });
});

describe("contenidoHombreDesdeCms: lo que el inicio de hombre dibuja de lo publicado", () => {
  it("videos de portada (con su vertical), colección y marca con rutas propias de la tienda, la imagen de su categoría y lo elegido en su inicio", () => {
    const c = contenidoHombreDesdeCms(snap({ multimedia: { hombre: MULTIMEDIA_HOMBRE }, home: { hombre: HOME_HOMBRE } }), SLUG);
    assert.ok(c);
    assert.deepEqual(Object.keys(c.multimedia?.videos ?? {}).sort(), ["coleccion", "marca", "portada"]);
    assert.deepEqual(c.multimedia?.videos.portada?.vertical, { src: `/catalogo/delacour/vitrina/${V.portadaV}.mp4`, poster: `/catalogo/delacour/vitrina/${P.portadaV}.webp`, width: 720, height: 1280 });
    assert.deepEqual([...(c.multimedia?.categorias ?? [])], [[CAT_DIJES, { src: `/catalogo/delacour/vitrina/${IMG_DIJES}.webp`, ancho: 800, alto: 1000 }]]);
    assert.deepEqual(c.destacadas, ["DL-000844", "DL-000843"]);
    assert.deepEqual(c.categorias, [CAT_DIJES, CAT_ARETES]);
    assert.ok(!JSON.stringify(c).includes("supabase") && !JSON.stringify(c).includes(TENANT_A), "ni direcciones de Storage ni ids del negocio");
  });

  it("sin nada de hombre publicado no hay nada (aunque lo de mujer sí esté publicado): el inicio de hombre usa lo automático", () => {
    assert.equal(contenidoHombreDesdeCms(instantanea({ assets: ASSETS }), SLUG), null);
    const soloMujer = snap({ multimedia: { videos: { portada: { horizontal: ref(V.mujerPortada, P.mujerPortada) } } }, home: home() as never });
    assert.equal(contenidoHombreDesdeCms(soloMujer, SLUG), null);
    assert.equal(contenidoHombreDesdeCms(snap({ multimedia: { hombre: {} }, home: { hombre: { categorias_destacadas: [], productos_destacados: [] } } }), SLUG), null);
  });

  it("solo los destacados (sin videos) o solo los videos (sin destacados) también cuentan", () => {
    const soloDestacados = contenidoHombreDesdeCms(snap({ home: { hombre: HOME_HOMBRE } }), SLUG);
    assert.equal(soloDestacados?.multimedia, null);
    assert.deepEqual(soloDestacados?.destacadas, ["DL-000844", "DL-000843"]);
    const soloVideos = contenidoHombreDesdeCms(snap({ multimedia: { hombre: { videos: { marca: { horizontal: ref(V.marca, P.marca) } } } } }), SLUG);
    assert.deepEqual(Object.keys(soloVideos?.multimedia?.videos ?? {}), ["marca"]);
    assert.deepEqual(soloVideos?.destacadas, []);
  });

  it("un video de hombre que no sirve (medidas de otro espacio, sin imagen fija) no se dibuja: ese bloque no existe, sin huecos ni videos deformados", () => {
    const vertEnHorizontal = ASSETS.map((a) => (a.id === V.colH ? video(V.colH, 720, 1280) : a));
    const c = contenidoHombreDesdeCms(snap({ multimedia: { hombre: MULTIMEDIA_HOMBRE }, assets: vertEnHorizontal }), SLUG);
    assert.equal(c?.multimedia?.videos.coleccion, undefined);
    assert.ok(c?.multimedia?.videos.portada && c.multimedia.videos.marca, "los demás espacios siguen");
    const sinPoster = ASSETS.filter((a) => a.id !== P.marca);
    assert.equal(contenidoHombreDesdeCms(snap({ multimedia: { hombre: MULTIMEDIA_HOMBRE }, assets: sinPoster }), SLUG)?.multimedia?.videos.marca, undefined);
  });

  it("lo de MUJER no cambia por tener lo de hombre publicado: multimediaDesdeCms devuelve solo sus espacios", () => {
    const mixto = snap({ multimedia: { videos: { portada: { horizontal: ref(V.mujerPortada, P.mujerPortada) } }, hombre: MULTIMEDIA_HOMBRE } });
    const m = multimediaDesdeCms(mixto, SLUG);
    assert.deepEqual(Object.keys(m?.videos ?? {}), ["portada"]);
    assert.equal(m?.videos.portada?.horizontal.src, `/catalogo/delacour/vitrina/${V.mujerPortada}.mp4`);
    assert.equal(m?.categorias.size, 0, "la imagen de «Dijes» es de hombre: la tienda de mujer no la usa");
    // y solo hombre publicado no cuenta como contenido de mujer
    assert.equal(multimediaDesdeCms(snap({ multimedia: { hombre: MULTIMEDIA_HOMBRE } }), SLUG), null);
  });
});

describe("videosDeHombre: los espacios listos para dibujar", () => {
  it("cada espacio publicado con el nombre de su botón de pausa; los no publicados no existen", () => {
    const m = contenidoHombreDesdeCms(snap({ multimedia: { hombre: MULTIMEDIA_HOMBRE } }), SLUG)?.multimedia;
    const v = videosDeHombre(m);
    assert.equal(v.portada?.etiqueta, "Video de la portada de hombre");
    assert.equal(v.coleccion?.etiqueta, "Video de la colección de hombre");
    assert.equal(v.marca?.etiqueta, "Video de la marca de hombre");
    assert.ok(v.portada?.vertical && !v.coleccion?.vertical, "el vertical solo si se subió");
    assert.deepEqual(videosDeHombre(null), {});
    assert.deepEqual(videosDeHombre(undefined), {});
  });
});

describe("cargarContenidoHombrePublicado: nunca rompe la tienda", () => {
  const deps = (over: Partial<DepsMultimediaPublica> = {}): DepsMultimediaPublica => ({
    tenantDe: async () => TENANT_A,
    cargar: async () => snap({ multimedia: { hombre: MULTIMEDIA_HOMBRE }, home: { hombre: HOME_HOMBRE } }),
    alFallar: () => {},
    ...over,
  });

  it("devuelve lo publicado; sin tienda, sin CMS o ante un error de la base devuelve null (el inicio de hombre usa lo automático) y no lanza", async () => {
    assert.ok((await cargarContenidoHombrePublicado(deps(), SLUG))?.multimedia);
    assert.equal(await cargarContenidoHombrePublicado(deps({ tenantDe: async () => null }), SLUG), null);
    assert.equal(await cargarContenidoHombrePublicado(deps({ cargar: async () => null }), SLUG), null);
    let avisos = 0;
    assert.equal(
      await cargarContenidoHombrePublicado(
        deps({
          cargar: async () => {
            throw new Error("la base no responde");
          },
          alFallar: () => void avisos++,
        }),
        SLUG,
      ),
      null,
    );
    assert.equal(avisos, 1);
  });

  it("una lectura demasiado lenta se corta y el inicio sigue", async () => {
    const lento = deps({ plazoMs: 20, cargar: () => new Promise(() => {}) });
    assert.equal(await cargarContenidoHombrePublicado(lento, SLUG), null);
  });
});
