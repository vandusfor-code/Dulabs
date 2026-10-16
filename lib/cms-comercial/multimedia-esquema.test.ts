/**
 * Fotos y videos del inicio (tipo «multimedia» del CMS): el esquema estricto, la normalización del borrador y la validación antes de publicar. Cada regla es una forma real de que un video
 * quede mal puesto, de que un archivo ajeno se cuele como «video» o de que la tienda pierda su portada.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TIPOS_ENTIDAD, nombreDeEntidad } from "@/lib/cms-comercial/contrato";
import { MAX_CATEGORIAS_CON_IMAGEN, multimediaSchema, normalizarBorrador, type Multimedia } from "@/lib/cms-comercial/esquemas";
import { AHORA, CAT_ARETES, CAT_DIJES, multimedia } from "@/lib/cms-comercial/testing/fixtures";
import { ARCHIVOS_VIDEO, ESPECIFICACIONES, usosDeVideo } from "@/lib/cms-comercial/video-requisitos";
import { dependenciasDe, etiquetaDeCampo, validar, type ContextoValidacion } from "@/lib/cms-comercial/validacion";

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const V = { portadaH: id(1), portadaV: id(2), colH: id(3), colV: id(4), marca: id(5), mayor: id(6) };
const P = { portadaH: id(11), portadaV: id(12), colH: id(13), colV: id(14), marca: id(15), mayor: id(16) };
const IMG_ARETES = id(21);
const IMG_DIJES = id(22);

const MB = 1024 * 1024;
type Asset = ContextoValidacion["assets"] extends ReadonlyMap<string, infer T> ? T : never;
const video = (ident: string, ancho: number, alto: number, bytes = 1.5 * MB, over: Partial<Asset> = {}): [string, Asset] => [ident, { id: ident, estado: "listo", mime: "video/mp4", ancho, alto, bytes: Math.round(bytes), ...over }];
const imagen = (ident: string, over: Partial<Asset> = {}): [string, Asset] => [ident, { id: ident, estado: "listo", mime: "image/webp", ancho: 800, alto: 800, bytes: 90_000, ...over }];

/** Los archivos de un negocio con todos los videos y posters bien (las medidas ideales de cada espacio). */
const ASSETS_BIEN: Array<[string, Asset]> = [
  video(V.portadaH, 1280, 720),
  video(V.portadaV, 720, 1280),
  video(V.colH, 1280, 720),
  video(V.colV, 720, 1280),
  video(V.marca, 720, 900),
  video(V.mayor, 1280, 576),
  ...Object.values(P).map((p) => imagen(p)),
  imagen(IMG_ARETES),
  imagen(IMG_DIJES),
];

const ctx = (assets: Array<[string, Asset]> = ASSETS_BIEN, categorias: string[] = [CAT_ARETES, CAT_DIJES]): ContextoValidacion => ({
  ahora: AHORA,
  productos: new Map(),
  categorias: new Map(categorias.map((c) => [c, { id: c, nombre: "Categoría" }])),
  assets: new Map(assets),
  elementos: new Map(),
  variables: {},
  minimoMayorista: null,
});

const ref = (v: string, p: string) => ({ video: v, poster: p });
const COMPLETO: Multimedia = {
  videos: {
    portada: { horizontal: ref(V.portadaH, P.portadaH), vertical: ref(V.portadaV, P.portadaV) },
    coleccion: { horizontal: ref(V.colH, P.colH), vertical: ref(V.colV, P.colV) },
    marca: { horizontal: ref(V.marca, P.marca) },
    mayoristas: { horizontal: ref(V.mayor, P.mayor) },
  },
  categorias: [
    { categoria_id: CAT_ARETES, imagen: { origen: "cms", asset: IMG_ARETES, alt: "Aretes dorados sobre fondo claro" } },
    { categoria_id: CAT_DIJES, imagen: { origen: "cms", asset: IMG_DIJES, alt: "Dijes de plata en una mano" } },
  ],
};

const errores = (borrador: unknown, c = ctx()) => validar("multimedia", borrador, c).errores;
const codigos = (borrador: unknown, c = ctx()) => errores(borrador, c).map((e) => `${e.codigo}@${e.campo}`);
const sinError = (borrador: unknown, c = ctx()) => assert.deepEqual(errores(borrador, c), [], JSON.stringify(errores(borrador, c)));
/** Una copia con un cambio en `ruta` (a.b.0.c). */
function con(base: unknown, ruta: string, valor: unknown): unknown {
  const copia = structuredClone(base) as Record<string, unknown>;
  const pasos = ruta.split(".");
  let actual: Record<string, unknown> | unknown[] = copia;
  for (const p of pasos.slice(0, -1)) actual = (actual as Record<string, unknown>)[p] as Record<string, unknown>;
  const ultimo = pasos[pasos.length - 1];
  if (valor === undefined) delete (actual as Record<string, unknown>)[ultimo];
  else (actual as Record<string, unknown>)[ultimo] = valor;
  return copia;
}

describe("fotos y videos — el tipo", () => {
  it("es un tipo del CMS con nombre propio y su fixture es válido", () => {
    assert.ok((TIPOS_ENTIDAD as readonly string[]).includes("multimedia"));
    assert.equal(nombreDeEntidad("multimedia", {}), "Fotos y videos");
    assert.equal(nombreDeEntidad("multimedia", { titulo: "Otro", nombre: "Otro" }), "Fotos y videos", "no depende del contenido");
    assert.equal(multimediaSchema.safeParse(multimedia()).success, true);
  });
});

describe("fotos y videos — el esquema", () => {
  it("acepta el borrador con el que arranca la administradora (vacío) y lo avisa como advertencia, no como error", () => {
    assert.equal(multimediaSchema.safeParse({}).success, true);
    const r = validar("multimedia", {}, ctx());
    assert.equal(r.ok, true);
    assert.deepEqual(r.advertencias.map((a) => a.codigo), ["multimedia_vacia"]);
    assert.match(r.advertencias[0].mensaje, /no cambia nada en tu tienda/);
    // lo mismo con listas vacías
    assert.deepEqual(validar("multimedia", { videos: {}, categorias: [] }, ctx()).advertencias.map((a) => a.codigo), ["multimedia_vacia"]);
  });

  it("acepta los seis archivos de video y las imágenes de categoría, y no avisa de nada", () => {
    const r = multimediaSchema.safeParse(COMPLETO);
    assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
    const v = validar("multimedia", COMPLETO, ctx());
    assert.deepEqual(v.errores, []);
    assert.deepEqual(v.advertencias, []);
  });

  it("cada espacio se puede personalizar por separado: solo videos, solo categorías, solo uno", () => {
    sinError({ videos: { marca: { horizontal: ref(V.marca, P.marca) } } });
    sinError({ videos: { portada: { horizontal: ref(V.portadaH, P.portadaH) } } });
    sinError({ categorias: COMPLETO.categorias });
    assert.deepEqual(validar("multimedia", { videos: { marca: { horizontal: ref(V.marca, P.marca) } } }, ctx()).advertencias, []);
  });

  it("la portada y la colección llevan siempre el video horizontal: el vertical solo no basta", () => {
    for (const espacio of ["portada", "coleccion"]) {
      const r = multimediaSchema.safeParse({ videos: { [espacio]: { vertical: ref(V.portadaV, P.portadaV) } } });
      assert.equal(r.success, false, espacio);
    }
  });

  it("la marca y los mayoristas solo tienen un archivo: no aceptan versión vertical", () => {
    for (const espacio of ["marca", "mayoristas"]) {
      assert.equal(multimediaSchema.safeParse({ videos: { [espacio]: { horizontal: ref(V.marca, P.marca), vertical: ref(V.portadaV, P.portadaV) } } }).success, false, espacio);
    }
  });

  it("rechaza espacios que no existen, campos de más y archivos a medias", () => {
    assert.equal(multimediaSchema.safeParse({ videos: { pie: { horizontal: ref(V.marca, P.marca) } } }).success, false, "un espacio inventado");
    assert.equal(multimediaSchema.safeParse({ videos: { portada: { horizontal: { ...ref(V.portadaH, P.portadaH), url: "https://x.co/v.mp4" } } } }).success, false, "una dirección externa no entra");
    assert.equal(multimediaSchema.safeParse({ videos: { portada: { horizontal: { video: V.portadaH } } } }).success, false, "sin imagen fija");
    assert.equal(multimediaSchema.safeParse({ videos: { portada: { horizontal: { poster: P.portadaH } } } }).success, false, "sin video");
    assert.equal(multimediaSchema.safeParse({ videos: { portada: { horizontal: ref("no-es-un-id", P.portadaH) } } }).success, false, "id que no es un identificador");
    assert.equal(multimediaSchema.safeParse({ videos: { portada: { horizontal: ref(V.portadaH, "../../etc/passwd") } } }).success, false, "una ruta no es un id");
    assert.equal(multimediaSchema.safeParse({ ...COMPLETO, extra: 1 }).success, false, "un campo desconocido");
    assert.equal(multimediaSchema.safeParse({ videos: [] }).success, false);
    assert.equal(multimediaSchema.safeParse({ videos: null }).success, false);
  });

  it("las imágenes de categoría: cada categoría una sola vez, con texto alternativo y hasta el máximo", () => {
    const img = { origen: "cms", asset: IMG_ARETES, alt: "Aretes dorados" } as const;
    assert.equal(multimediaSchema.safeParse({ categorias: [{ categoria_id: CAT_ARETES, imagen: img }, { categoria_id: CAT_ARETES, imagen: img }] }).success, false, "repetida");
    assert.equal(multimediaSchema.safeParse({ categorias: [{ categoria_id: CAT_ARETES, imagen: { origen: "cms", asset: IMG_ARETES } }] }).success, false, "sin texto alternativo");
    assert.equal(multimediaSchema.safeParse({ categorias: [{ categoria_id: CAT_ARETES, imagen: { ...img, alt: "x" } }] }).success, false, "texto alternativo demasiado corto");
    assert.equal(multimediaSchema.safeParse({ categorias: [{ categoria_id: "aretes", imagen: img }] }).success, false, "la categoría se identifica por su id");
    assert.equal(multimediaSchema.safeParse({ categorias: [{ imagen: img }] }).success, false, "sin categoría");
    assert.equal(multimediaSchema.safeParse({ categorias: [{ categoria_id: CAT_ARETES }] }).success, false, "sin imagen");
    const muchas = Array.from({ length: MAX_CATEGORIAS_CON_IMAGEN + 1 }, (_, i) => ({ categoria_id: `c0000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`, imagen: img }));
    assert.equal(multimediaSchema.safeParse({ categorias: muchas.slice(0, MAX_CATEGORIAS_CON_IMAGEN) }).success, true, "el máximo exacto cabe");
    const r = multimediaSchema.safeParse({ categorias: muchas });
    assert.equal(r.success, false);
    assert.match(JSON.stringify(r.error?.issues), /Máximo 60 categorías/);
  });

  it("la normalización del borrador deja pasar solo las claves del tipo y rechaza lo ajeno", () => {
    const ok = normalizarBorrador("multimedia", COMPLETO);
    assert.equal(ok.ok, true);
    assert.deepEqual(normalizarBorrador("multimedia", {}), { ok: true, borrador: {} });
    for (const ajeno of [{ columnas: [] }, { titulo: "x" }, { portada: {} }, { descripcion: "x" }]) {
      const r = normalizarBorrador("multimedia", ajeno);
      assert.equal(r.ok, false, JSON.stringify(ajeno));
      assert.match((r as { mensaje: string }).mensaje, /Campo no permitido/);
    }
    assert.equal(normalizarBorrador("multimedia", [] as never).ok, false);
    assert.equal(normalizarBorrador("multimedia", null as never).ok, false);
    // lo de los otros tipos tampoco admite los campos de este
    assert.equal(normalizarBorrador("pie", { videos: {} }).ok, false);
    assert.equal(normalizarBorrador("home", { categorias: [] }).ok, false);
  });
});

describe("fotos y videos — qué usa el borrador", () => {
  it("lista cada video con el espacio donde va, las imágenes fijas y las categorías", () => {
    const dep = dependenciasDe("multimedia", COMPLETO);
    assert.deepEqual(dep.videos.map((v) => [v.archivo, v.valor, v.campo]), [
      ["portada.horizontal", V.portadaH, "videos.portada.horizontal.video"],
      ["portada.vertical", V.portadaV, "videos.portada.vertical.video"],
      ["coleccion.horizontal", V.colH, "videos.coleccion.horizontal.video"],
      ["coleccion.vertical", V.colV, "videos.coleccion.vertical.video"],
      ["marca.horizontal", V.marca, "videos.marca.horizontal.video"],
      ["mayoristas.horizontal", V.mayor, "videos.mayoristas.horizontal.video"],
    ]);
    assert.deepEqual(dep.assets.map((a) => a.valor).sort(), [...Object.values(P), IMG_ARETES, IMG_DIJES].sort());
    assert.deepEqual(dep.categorias.map((c) => [c.valor, c.campo]), [[CAT_ARETES, "categorias.0.categoria_id"], [CAT_DIJES, "categorias.1.categoria_id"]]);
    assert.deepEqual(dep.referencias, []);
    assert.deepEqual(dep.elementos, []);
  });

  it("no revienta con basura: ignora lo que no tiene la forma esperada", () => {
    for (const basura of [{}, { videos: null }, { videos: { portada: 3 } }, { videos: { portada: { horizontal: { video: 5, poster: {} } } } }, { categorias: "x" }, { categorias: [null, 3, { imagen: 1 }] }]) {
      assert.doesNotThrow(() => dependenciasDe("multimedia", basura), JSON.stringify(basura));
    }
    assert.deepEqual(dependenciasDe("multimedia", { videos: { portada: { horizontal: { video: 5, poster: {} } } } }).videos, []);
  });

  it("usosDeVideo entrega los mismos archivos que ve la validación, en el orden de la lista", () => {
    assert.deepEqual(usosDeVideo(COMPLETO).map((u) => u.archivo), [...ARCHIVOS_VIDEO]);
    assert.deepEqual(usosDeVideo({}), []);
    assert.deepEqual(usosDeVideo({ videos: { marca: { horizontal: ref(V.marca, P.marca) } } }), [{ archivo: "marca.horizontal", video: V.marca, poster: P.marca }]);
  });
});

describe("fotos y videos — validar antes de publicar", () => {
  it("un borrador completo con todos los archivos bien puestos se puede publicar", () => {
    sinError(COMPLETO);
  });

  it("un video que ya no existe, o que sigue subiéndose, no se puede publicar y el mensaje dice cuál es", () => {
    const sin = ASSETS_BIEN.filter(([k]) => k !== V.marca);
    assert.deepEqual(codigos(COMPLETO, ctx(sin)), ["video_inexistente@videos.marca.horizontal.video"]);
    assert.match(errores(COMPLETO, ctx(sin))[0].mensaje, /«Marca · tarjeta» ya no existe/);
    const pendiente = ASSETS_BIEN.map(([k, a]): [string, Asset] => (k === V.mayor ? [k, { ...a, estado: "pendiente" }] : [k, a]));
    assert.deepEqual(codigos(COMPLETO, ctx(pendiente)), ["video_pendiente@videos.mayoristas.horizontal.video"]);
    assert.match(errores(COMPLETO, ctx(pendiente))[0].mensaje, /todavía no terminó de subirse/);
  });

  it("un archivo que no es un video MP4 no se acepta como video, aunque exista y esté listo", () => {
    for (const mime of ["image/webp", "image/png", "video/webm", "video/quicktime", "application/pdf"]) {
      const assets = ASSETS_BIEN.map(([k, a]): [string, Asset] => (k === V.colH ? [k, { ...a, mime }] : [k, a]));
      assert.deepEqual(codigos(COMPLETO, ctx(assets)), ["video_invalido@videos.coleccion.horizontal.video"], mime);
    }
    assert.match(errores(COMPLETO, ctx(ASSETS_BIEN.map(([k, a]): [string, Asset] => (k === V.colH ? [k, { ...a, mime: "image/png" }] : [k, a]))))[0].mensaje, /no es un video\. Sube un video MP4/);
  });

  it("la imagen fija tiene que ser una imagen: un video no puede hacer de póster", () => {
    const assets = ASSETS_BIEN.map(([k, a]): [string, Asset] => (k === P.marca ? [k, { ...a, mime: "video/mp4" }] : [k, a]));
    assert.deepEqual(codigos(COMPLETO, ctx(assets)), ["imagen_invalida@videos.marca.horizontal.poster"]);
    const faltante = ASSETS_BIEN.filter(([k]) => k !== P.portadaV);
    assert.deepEqual(codigos(COMPLETO, ctx(faltante)), ["imagen_inexistente@videos.portada.vertical.poster"]);
    const pendiente = ASSETS_BIEN.map(([k, a]): [string, Asset] => (k === P.colH ? [k, { ...a, estado: "pendiente" }] : [k, a]));
    assert.deepEqual(codigos(COMPLETO, ctx(pendiente)), ["imagen_pendiente@videos.coleccion.horizontal.poster"]);
  });

  it("la imagen de una categoría tiene que existir, estar lista y ser una imagen; y la categoría tiene que existir", () => {
    assert.deepEqual(codigos(COMPLETO, ctx(ASSETS_BIEN, [CAT_ARETES])), ["categoria_inexistente@categorias.1.categoria_id"]);
    assert.deepEqual(codigos(COMPLETO, ctx(ASSETS_BIEN.filter(([k]) => k !== IMG_DIJES))), ["imagen_inexistente@categorias.1.imagen.asset"]);
    const video_en_categoria = ASSETS_BIEN.map(([k, a]): [string, Asset] => (k === IMG_ARETES ? [k, { ...a, mime: "video/mp4" }] : [k, a]));
    assert.deepEqual(codigos(COMPLETO, ctx(video_en_categoria)), ["imagen_invalida@categorias.0.imagen.asset"]);
  });

  it("la red de seguridad: un video demasiado pesado, de otra proporción o de otro tamaño NO se publica, aunque ya esté guardado", () => {
    const cambiar = (ident: string, ancho: number, alto: number, bytes: number) => ASSETS_BIEN.map(([k, a]): [string, Asset] => (k === ident ? video(ident, ancho, alto, bytes) : [k, a]));
    // pesa 4 MB
    let e = errores(COMPLETO, ctx(cambiar(V.portadaH, 1280, 720, 4 * MB)));
    assert.deepEqual(e.map((x) => x.codigo), ["video_no_cumple"]);
    assert.equal(e[0].campo, "videos.portada.horizontal.video");
    assert.match(e[0].mensaje, /«Portada · pantalla horizontal» no cumple: Pesa 4 MB\./);
    assert.match(e[0].mensaje, /Redúcelo a 3 MB o menos/);
    // un video vertical puesto en un espacio horizontal: dice dónde va
    e = errores(COMPLETO, ctx(cambiar(V.colH, 720, 1280, MB)));
    assert.ok(e.length >= 1 && e.every((x) => x.codigo === "video_no_cumple" && x.campo === "videos.coleccion.horizontal.video"));
    assert.match(e.map((x) => x.mensaje).join(" "), /tu video es vertical\. Súbelo en «Colección · pantalla vertical \(celular\)»/);
    // el video de la marca (4:5) no sirve de portada (16:9)
    e = errores(COMPLETO, ctx(cambiar(V.portadaH, 720, 900, MB)));
    assert.ok(e.some((x) => /Proporción|proporción/.test(x.mensaje) || /Es de 720×900/.test(x.mensaje)));
    // demasiado grande (4K) y demasiado pequeño
    e = errores(COMPLETO, ctx(cambiar(V.colV, 2160, 3840, MB)));
    assert.ok(e.some((x) => /demasiado grande/.test(x.mensaje)));
    e = errores(COMPLETO, ctx(cambiar(V.colV, 360, 640, MB)));
    assert.ok(e.some((x) => /demasiado pequeño/.test(x.mensaje)));
    // cada espacio con sus propias medidas ideales: ninguno falla
    sinError(COMPLETO, ctx([...ASSETS_BIEN, ...ARCHIVOS_VIDEO.map((a): [string, Asset] => video(a === "portada.horizontal" ? V.portadaH : a === "portada.vertical" ? V.portadaV : a === "coleccion.horizontal" ? V.colH : a === "coleccion.vertical" ? V.colV : a === "marca.horizontal" ? V.marca : V.mayor, ESPECIFICACIONES[a].ideal.ancho, ESPECIFICACIONES[a].ideal.alto))]));
  });

  it("el mismo video en dos espacios se comprueba contra cada uno", () => {
    const mismo = { videos: { portada: { horizontal: ref(V.portadaH, P.portadaH) }, marca: { horizontal: ref(V.portadaH, P.marca) } } };
    const e = errores(mismo);
    assert.ok(e.length >= 1 && e.every((x) => x.campo === "videos.marca.horizontal.video"), "pasa en la portada pero no en la tarjeta de la marca");
  });

  it("quien no informa el tipo ni las medidas del archivo solo valida que exista y esté listo (compatibilidad)", () => {
    const planos = new Map<string, Asset>([...ASSETS_BIEN.map(([k]): [string, Asset] => [k, { id: k, estado: "listo" }])]);
    sinError(COMPLETO, { ...ctx(), assets: planos });
  });

  it("un borrador con un error de forma no se salva por tener buenos los archivos", () => {
    const c = con(COMPLETO, "videos.portada.horizontal.poster", "no-es-un-id");
    const r = validar("multimedia", c, ctx());
    assert.equal(r.ok, false);
    assert.ok(r.errores.some((x) => x.codigo === "esquema"));
  });

  it("los nombres de los campos que ve la administradora son los de cada espacio", () => {
    assert.equal(etiquetaDeCampo("videos.portada.horizontal.video"), "Video · Portada · pantalla horizontal");
    assert.equal(etiquetaDeCampo("videos.marca.horizontal.poster"), "Imagen fija · Marca · tarjeta");
    assert.equal(etiquetaDeCampo("categorias.0.imagen"), "Imagen de la categoría");
    assert.equal(etiquetaDeCampo("videos.mayoristas"), "Video de mayoristas");
  });
});
