/**
 * CMS comercial — las FOTOS Y VIDEOS del inicio sobre la base SQL REAL (Postgres embebido) y los videos REALES de la tienda de Delacour: el mismo ciclo borrador → revisar → publicar → versión
 * activa que los demás tipos, uno por negocio, solo un administrador lo cambia, el lector lo entrega a la tienda y nada se ve hasta publicarlo. Y la RED DE SEGURIDAD: aunque alguien eluda
 * el aviso del navegador, publicar comprueba contra lo que la base conoce de cada archivo (tipo, medidas y peso) que un video sirva para el espacio donde se usa.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import type { Rol } from "@/lib/team";
import type { ActorCms } from "@/lib/cms-comercial/contrato";
import { isCmsError } from "@/lib/cms-comercial/errores";
import { crearServicioImagenes } from "@/lib/cms-comercial/imagenes";
import { crearLector } from "@/lib/cms-comercial/lector";
import { multimediaDesdeCms } from "@/lib/cms-comercial/multimedia-tienda";
import type { PuertoCatalogo, PuertoVariables } from "@/lib/cms-comercial/puertos";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import { crearServicioCms } from "@/lib/cms-comercial/servicio";
import { crearAlmacenMemoria } from "@/lib/cms-comercial/testing/almacen-memoria";
import { AHORA, CAT_ARETES, CAT_DIJES } from "@/lib/cms-comercial/testing/fixtures";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { assetsReferenciados, videosReferenciados } from "@/lib/cms-comercial/vitrina";
import { crearServicioVideos } from "@/lib/cms-comercial/videos";

const CARPETA = path.join(process.cwd(), "public", "catalogo", "delacour", "video");
const real = (nombre: string) => new Uint8Array(readFileSync(path.join(CARPETA, nombre)));

let base: BaseCms;
let serie = 0;
let jpeg: Uint8Array;

const catalogo: PuertoCatalogo = {
  async productosPorReferencia() {
    return [];
  },
  async buscarProductos() {
    return [];
  },
  async categoriasPorId(_t, ids) {
    return ids.filter((i) => i === CAT_ARETES || i === CAT_DIJES).map((id) => ({ id, nombre: id === CAT_ARETES ? "Aretes" : "Dijes" }));
  },
  async listarCategorias() {
    return [
      { id: CAT_ARETES, nombre: "Aretes" },
      { id: CAT_DIJES, nombre: "Dijes" },
    ];
  },
};
const variablesPuerto: PuertoVariables = {
  async valores() {
    return { variables: { minimo_mayorista: "$750.000" }, minimoMayorista: 750000 };
  },
};

let repo: ReturnType<typeof crearRepositorioSupabaseCms>;
let servicio: ReturnType<typeof crearServicioCms>;
let lector: ReturnType<typeof crearLector>;
let videos: ReturnType<typeof crearServicioVideos>;
let imagenes: ReturnType<typeof crearServicioImagenes>;
const almacen = crearAlmacenMemoria();

before(async () => {
  base = await crearBaseCms();
  repo = crearRepositorioSupabaseCms(base.supabase);
  servicio = crearServicioCms({ repo, catalogo, variables: variablesPuerto, reloj: () => AHORA });
  lector = crearLector(repo, { alDescartar: () => {} });
  videos = crearServicioVideos({ repo, almacen });
  imagenes = crearServicioImagenes({ repo, almacen });
  jpeg = new Uint8Array(await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toBuffer());
});
after(async () => {
  await base.cerrar();
});

async function negocio() {
  serie += 1;
  const tenantId = `a0000000-0000-4000-8000-${String(serie).padStart(12, "0")}`;
  await base.habilitarModulo(tenantId);
  return tenantId;
}
const actor = (tenantId: string, rol: Rol = "admin", n = 1): ActorCms => ({ tenantId, userId: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, miembroId: n, rol, etiqueta: `Persona ${n}` });
const fallo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (isCmsError(e)) return e;
    throw e;
  }
  return assert.fail("debía fallar");
};

/** Un video REAL ya subido, verificado y listo, con su imagen fija lista. Devuelve los ids para ponerlos en el borrador. */
async function subirVideo(a: ActorCms, archivoReal: string, espacio: Parameters<typeof videos.confirmar>[2]["archivo"]) {
  const bytes = real(archivoReal);
  const ticket = await videos.solicitarSubida(a, { mimeType: "video/mp4", bytes: bytes.byteLength, nombreOriginal: archivoReal });
  almacen.subirComoNavegador(ticket.path, bytes, "video/mp4");
  await videos.confirmar(a, ticket.id, { archivo: espacio });
  const fija = await imagenes.solicitarSubida(a, { mimeType: "image/jpeg", bytes: jpeg.byteLength, nombreOriginal: "fija.jpg" });
  almacen.subirComoNavegador(fija.path, jpeg, "image/jpeg");
  await imagenes.confirmar(a, fija.id);
  return { video: ticket.id, poster: fija.id };
}

/** Un archivo directo en la base (para casos que la subida normal ya no deja pasar: otro peso, otro tipo, sin confirmar…). */
async function archivo(tenant: string, id: string, mime: string, opciones: { bytes?: number; ancho?: number; alto?: number; listo?: boolean } = {}) {
  const ext = mime.startsWith("video/") ? "video.mp4" : "imagen.webp";
  await base.sql("select public.dulabs_cms_asset_crear($1, $2, $3, $4, $5, $6, $7, 'prueba', null)", [tenant, id, `${tenant}/cms/${id}/${ext}`, mime, opciones.bytes ?? 1_000_000, opciones.ancho ?? 1280, opciones.alto ?? 720]);
  if (opciones.listo !== false) await base.sql("select public.dulabs_cms_asset_confirmar($1, $2, $3, $4, $5, null, 'Prueba')", [tenant, id, opciones.bytes ?? 1_000_000, opciones.ancho ?? 1280, opciones.alto ?? 720]);
  return id;
}
let ids = 0;
const nuevoId = () => `b0000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

describe("FOTOS Y VIDEOS: crear (uno por negocio)", () => {
  it("nace en borrador con su código fijo «multimedia», su nombre y sin vigencia", async () => {
    const t = await negocio();
    const e = await servicio.crear(actor(t), { tipo: "multimedia", borrador: {} });
    assert.equal(e.tipo, "multimedia");
    assert.equal(e.clave, "multimedia");
    assert.equal(e.nombre, "Fotos y videos");
    assert.equal(e.estado, "borrador");
    assert.equal(e.estadoVigencia, null);
    assert.equal(e.versionActiva, null);
    assert.deepEqual(e.borrador, {});
  });

  it("un segundo elemento en el mismo negocio se rechaza con un mensaje claro (también con uno archivado); otro negocio tiene el suyo", async () => {
    const t = await negocio();
    const a = actor(t);
    const e = await servicio.crear(a, { tipo: "multimedia", borrador: {} });
    const rechazo = await fallo(servicio.crear(a, { tipo: "multimedia", borrador: {} }));
    assert.equal(rechazo.code, "VALIDATION_ERROR");
    assert.equal(rechazo.message, "Las fotos y videos ya existen.");
    await servicio.archivar(a, e.id);
    assert.equal((await fallo(servicio.crear(a, { tipo: "multimedia", borrador: {} }))).message, "Las fotos y videos ya existen.");
    const otro = await negocio();
    assert.equal((await servicio.crear(actor(otro), { tipo: "multimedia", borrador: {} })).clave, "multimedia");
  });

  it("solo un administrador lo crea, lo edita o lo publica; los demás roles solo lo consultan", async () => {
    const t = await negocio();
    const e = await servicio.crear(actor(t), { tipo: "multimedia", borrador: {} });
    for (const rol of ["agente", "lectura"] as const) {
      const otro = actor(t, rol, 2);
      assert.equal((await fallo(servicio.crear(otro, { tipo: "multimedia", borrador: {} }))).code, "FORBIDDEN");
      assert.equal((await fallo(servicio.guardarBorrador(otro, e.id, { borrador: {}, rev: e.rev }))).code, "FORBIDDEN");
      assert.equal((await fallo(servicio.publicar(otro, e.id, { rev: e.rev }))).code, "FORBIDDEN");
      assert.equal((await servicio.listar(otro, { tipo: "multimedia" })).length, 1, "pero lo puede ver");
    }
  });

  it("un borrador con campos de otro tipo, o con un espacio que no existe, se rechaza al guardar", async () => {
    const t = await negocio();
    const a = actor(t);
    const ajeno = await fallo(servicio.crear(a, { tipo: "multimedia", borrador: { columnas: [] } }));
    assert.equal(ajeno.code, "VALIDATION_ERROR");
    assert.match(ajeno.message, /Campo no permitido: columnas/);
    const e = await servicio.crear(a, { tipo: "multimedia", borrador: {} });
    // Un espacio que no existe se guarda (un borrador puede estar a medias) pero la revisión lo rechaza y no deja publicar.
    const guardado = await servicio.guardarBorrador(a, e.id, { borrador: { videos: { pie: { horizontal: { video: nuevoId(), poster: nuevoId() } } } }, rev: e.rev });
    const v = await servicio.validar(a, e.id);
    assert.equal(v.ok, false);
    assert.ok(v.errores.some((x) => x.codigo === "esquema"));
    assert.equal((await fallo(servicio.publicar(a, e.id, { rev: guardado.rev }))).code, "NOT_PUBLISHABLE");
  });
});

describe("FOTOS Y VIDEOS: revisar y publicar con videos de verdad", () => {
  it("sin nada elegido se puede publicar (avisa que no cambia nada) y la tienda sigue con lo de siempre", async () => {
    const t = await negocio();
    const a = actor(t);
    const e = await servicio.crear(a, { tipo: "multimedia", borrador: {} });
    const v = await servicio.validar(a, e.id);
    assert.equal(v.ok, true);
    assert.deepEqual(v.advertencias.map((x) => x.codigo), ["multimedia_vacia"]);
    await servicio.publicar(a, e.id, { rev: e.rev });
    const snap = await lector.cargar(t);
    assert.ok(snap?.multimedia);
    assert.equal(multimediaDesdeCms(snap, "demo"), null, "nada que reemplazar");
  });

  it("dos videos reales y la imagen de una categoría: se revisan, se publican y la tienda los recibe por sus rutas propias", async () => {
    const t = await negocio();
    const a = actor(t);
    const portada = await subirVideo(a, "portada-h.mp4", "portada.horizontal");
    const marca = await subirVideo(a, "marca.mp4", "marca.horizontal");
    const imagenCat = (await archivo(t, nuevoId(), "image/webp", { bytes: 90_000, ancho: 800, alto: 1000 })) as string;
    const borrador = {
      videos: { portada: { horizontal: portada }, marca: { horizontal: marca } },
      categorias: [{ categoria_id: CAT_ARETES, imagen: { origen: "cms", asset: imagenCat, alt: "Aretes dorados" } }],
    };
    const e = await servicio.crear(a, { tipo: "multimedia", borrador });
    const v = await servicio.validar(a, e.id);
    assert.deepEqual([v.ok, v.errores, v.advertencias], [true, [], []]);
    assert.equal((await lector.cargar(t))?.multimedia, null, "en borrador la tienda no lo ve");

    const p = await servicio.publicar(a, e.id, { rev: e.rev, nota: "Mis videos" });
    assert.equal(p.version, 1);
    const snap = await lector.cargar(t);
    assert.ok(snap?.multimedia);
    assert.deepEqual(snap.multimedia.contenido, borrador);
    assert.deepEqual([...videosReferenciados(snap)].sort(), [portada.video, marca.video].sort());
    assert.ok(assetsReferenciados(snap).has(portada.poster) && assetsReferenciados(snap).has(marca.poster) && assetsReferenciados(snap).has(imagenCat), "las imágenes fijas y la de la categoría también se sirven");

    const m = multimediaDesdeCms(snap, "demo");
    assert.equal(m?.videos.portada?.horizontal.src, `/catalogo/demo/vitrina/${portada.video}.mp4`);
    assert.equal(m?.videos.portada?.horizontal.poster, `/catalogo/demo/vitrina/${portada.poster}.webp`);
    assert.deepEqual([m?.videos.portada?.horizontal.width, m?.videos.portada?.horizontal.height], [1280, 720]);
    assert.deepEqual([m?.videos.marca?.horizontal.width, m?.videos.marca?.horizontal.height], [720, 900]);
    assert.equal(m?.categorias.get(CAT_ARETES)?.src, `/catalogo/demo/vitrina/${imagenCat}.webp`);
  });

  it("editar después de publicar NO cambia lo que ve la tienda hasta volver a publicar; pausar y despublicar la devuelven a lo de siempre", async () => {
    const t = await negocio();
    const a = actor(t);
    const v1 = await subirVideo(a, "marca.mp4", "marca.horizontal");
    const v2 = await subirVideo(a, "marca.mp4", "marca.horizontal");
    const e = await servicio.crear(a, { tipo: "multimedia", borrador: { videos: { marca: { horizontal: v1 } } } });
    await servicio.publicar(a, e.id, { rev: e.rev });
    const editado = await servicio.guardarBorrador(a, e.id, { borrador: { videos: { marca: { horizontal: v2 } } }, rev: (await servicio.obtener(a, e.id)).rev });
    assert.equal(editado.tieneCambios, true);
    assert.equal((await lector.cargar(t))?.multimedia?.contenido.videos?.marca?.horizontal.video, v1.video, "la tienda sigue con lo publicado");
    await servicio.publicar(a, e.id, { rev: editado.rev });
    const publicado = await lector.cargar(t);
    assert.equal(publicado?.multimedia?.contenido.videos?.marca?.horizontal.video, v2.video);
    assert.deepEqual([...videosReferenciados(publicado!)], [v2.video], "el video anterior deja de servirse");
    await servicio.pausar(a, e.id);
    assert.equal((await lector.cargar(t))?.multimedia, null, "pausado: la tienda vuelve a sus videos de siempre");
    await servicio.reanudar(a, e.id);
    assert.ok((await lector.cargar(t))?.multimedia);
    await servicio.despublicar(a, e.id);
    assert.equal((await lector.cargar(t))?.multimedia, null);
  });

  it("restaurar una versión anterior vuelve a poner su video; el historial registra cada paso con el tipo «multimedia»", async () => {
    const t = await negocio();
    const a = actor(t);
    const v1 = await subirVideo(a, "mayoristas.mp4", "mayoristas.horizontal");
    const v2 = await subirVideo(a, "mayoristas.mp4", "mayoristas.horizontal");
    const e = await servicio.crear(a, { tipo: "multimedia", borrador: { videos: { mayoristas: { horizontal: v1 } } } });
    await servicio.publicar(a, e.id, { rev: e.rev });
    const g = await servicio.guardarBorrador(a, e.id, { borrador: { videos: { mayoristas: { horizontal: v2 } } }, rev: (await servicio.obtener(a, e.id)).rev });
    await servicio.publicar(a, e.id, { rev: g.rev });
    await servicio.restaurar(a, e.id, { version: 1, nota: "Volver al primero" });
    assert.equal((await lector.cargar(t))?.multimedia?.contenido.videos?.mayoristas?.horizontal.video, v1.video);
    const historial = (await servicio.auditoria(a, { entidadId: e.id })).filter((h) => h.entidadTipo === "multimedia");
    assert.deepEqual([...new Set(historial.map((h) => h.accion))].sort(), ["crear", "editar_borrador", "publicar", "restaurar"]);
    // y cada video subido quedó en el historial general como un archivo, con su tipo
    const archivos = (await servicio.auditoria(a, {})).filter((h) => h.entidadTipo === "imagen");
    assert.ok(archivos.some((h) => (h.despues as { mime_type?: string } | null)?.mime_type === "video/mp4"));
  });

  it("un negocio no ve los videos de otro: el borrador con un video ajeno no se puede publicar", async () => {
    const t = await negocio();
    const ajeno = await negocio();
    const a = actor(t);
    const delOtro = await subirVideo(actor(ajeno), "marca.mp4", "marca.horizontal");
    const e = await servicio.crear(a, { tipo: "multimedia", borrador: { videos: { marca: { horizontal: delOtro } } } });
    const v = await servicio.validar(a, e.id);
    assert.equal(v.ok, false);
    assert.deepEqual(v.errores.map((x) => `${x.codigo}@${x.campo}`).sort(), ["imagen_inexistente@videos.marca.horizontal.poster", "video_inexistente@videos.marca.horizontal.video"]);
    assert.equal((await fallo(servicio.publicar(a, e.id, { rev: e.rev }))).code, "NOT_PUBLISHABLE");
  });
});

describe("FOTOS Y VIDEOS: la red de seguridad al publicar (contra lo que la base conoce de cada archivo)", () => {
  const codigos = async (a: ActorCms, borrador: Record<string, unknown>) => {
    const e = await servicio.crear(a, { tipo: "multimedia", borrador });
    const v = await servicio.validar(a, e.id);
    return { e, v, codigos: v.errores.map((x) => `${x.codigo}@${x.campo}`).sort() };
  };

  it("un video sin confirmar, que no existe, o que es en realidad una imagen", async () => {
    const t = await negocio();
    const a = actor(t);
    const poster = await archivo(t, nuevoId(), "image/webp");
    const pendiente = await archivo(t, nuevoId(), "video/mp4", { listo: false });
    const imagenComoVideo = await archivo(t, nuevoId(), "image/webp");
    const e = await servicio.crear(a, { tipo: "multimedia", borrador: { videos: { portada: { horizontal: { video: pendiente, poster } }, marca: { horizontal: { video: imagenComoVideo, poster } }, mayoristas: { horizontal: { video: nuevoId(), poster } } } } });
    const v = await servicio.validar(a, e.id);
    assert.deepEqual(v.errores.map((x) => `${x.codigo}@${x.campo}`).sort(), ["video_inexistente@videos.mayoristas.horizontal.video", "video_invalido@videos.marca.horizontal.video", "video_pendiente@videos.portada.horizontal.video"]);
  });

  it("la imagen fija que es un video, o que no existe, impide publicar", async () => {
    const t = await negocio();
    const a = actor(t);
    const video = await archivo(t, nuevoId(), "video/mp4");
    const otroVideo = await archivo(t, nuevoId(), "video/mp4");
    const { codigos: c } = await codigos(a, { videos: { marca: { horizontal: { video, poster: otroVideo } }, mayoristas: { horizontal: { video, poster: nuevoId() } } } });
    // El mismo video (1280×720) sirve para los mayoristas pero no para la tarjeta de la marca (4:5): ahí falla la proporción y las medidas.
    assert.deepEqual([...new Set(c)], ["imagen_inexistente@videos.mayoristas.horizontal.poster", "imagen_invalida@videos.marca.horizontal.poster", "video_no_cumple@videos.marca.horizontal.video"]);
  });

  it("un video de otro espacio (el de la marca, 4:5, puesto en la portada horizontal 16:9) NO se publica, y el mensaje dice por qué", async () => {
    const t = await negocio();
    const a = actor(t);
    const marca = await subirVideo(a, "marca.mp4", "marca.horizontal");
    const { e, v } = await codigos(a, { videos: { portada: { horizontal: marca } } });
    assert.equal(v.ok, false);
    const m = v.errores.find((x) => x.codigo === "video_no_cumple");
    assert.ok(m);
    assert.equal(m.campo, "videos.portada.horizontal.video");
    assert.match(m.mensaje, /El video de «Portada · pantalla horizontal» no cumple/);
    assert.match(m.mensaje, /Es de 720×900/);
    const rechazo = await fallo(servicio.publicar(a, e.id, { rev: e.rev }));
    assert.equal(rechazo.code, "NOT_PUBLISHABLE");
    assert.ok(rechazo.problemas?.some((p) => p.codigo === "video_no_cumple"));
    assert.equal((await lector.cargar(t))?.multimedia, null, "no salió nada a la tienda");
  });

  it("un video más pesado de 3 MB que llegó a la base por otro camino NO se publica", async () => {
    const t = await negocio();
    const a = actor(t);
    const pesado = await archivo(t, nuevoId(), "video/mp4", { bytes: 4 * 1024 * 1024 });
    const poster = await archivo(t, nuevoId(), "image/webp");
    const { v } = await codigos(a, { videos: { portada: { horizontal: { video: pesado, poster } } } });
    const m = v.errores.find((x) => x.codigo === "video_no_cumple");
    assert.ok(m);
    assert.match(m.mensaje, /Pesa 4 MB\./);
    assert.match(m.mensaje, /Redúcelo a 3 MB o menos/);
  });

  it("medidas fuera del rango del espacio (muy grande o muy pequeño) NO se publican", async () => {
    const t = await negocio();
    const a = actor(t);
    const poster = await archivo(t, nuevoId(), "image/webp");
    const grande = await archivo(t, nuevoId(), "video/mp4", { ancho: 3840, alto: 2160 });
    const chico = await archivo(t, nuevoId(), "video/mp4", { ancho: 640, alto: 360 });
    const { v } = await codigos(a, { videos: { portada: { horizontal: { video: grande, poster } }, coleccion: { horizontal: { video: chico, poster } } } });
    const mensajes = v.errores.filter((x) => x.codigo === "video_no_cumple").map((x) => `${x.campo}|${x.mensaje}`);
    assert.ok(mensajes.some((m) => m.startsWith("videos.portada.horizontal.video|") && /demasiado grande/.test(m)), mensajes.join("\n"));
    assert.ok(mensajes.some((m) => m.startsWith("videos.coleccion.horizontal.video|") && /demasiado pequeño/.test(m)), mensajes.join("\n"));
  });

  it("una categoría que ya no existe, o una imagen de categoría que es un video, impiden publicar", async () => {
    const t = await negocio();
    const a = actor(t);
    const video = await archivo(t, nuevoId(), "video/mp4");
    const falta = "c0000000-0000-4000-8000-0000000000ff";
    const { codigos: c } = await codigos(a, {
      categorias: [
        { categoria_id: falta, imagen: { origen: "cms", asset: await archivo(t, nuevoId(), "image/webp"), alt: "Una imagen" } },
        { categoria_id: CAT_DIJES, imagen: { origen: "cms", asset: video, alt: "Un video" } },
      ],
    });
    assert.deepEqual(c, ["categoria_inexistente@categorias.0.categoria_id", "imagen_invalida@categorias.1.imagen.asset"]);
  });
});

describe("FOTOS Y VIDEOS: antes de aplicar la migración", () => {
  it("crear las fotos y videos avisa con claridad que todavía no están disponibles, y lo demás sigue funcionando", async () => {
    const vieja = await crearBaseCms({ conMultimedia: false });
    try {
      const r = crearRepositorioSupabaseCms(vieja.supabase);
      const s = crearServicioCms({ repo: r, catalogo, variables: variablesPuerto, reloj: () => AHORA });
      const t = "a0000000-0000-4000-8000-0000000000f2";
      await vieja.habilitarModulo(t);
      const e = await fallo(s.crear(actor(t), { tipo: "multimedia", borrador: {} }));
      assert.equal(e.code, "FEATURE_UNAVAILABLE");
      assert.equal(e.status, 503);
      assert.equal(e.message, "Las fotos y videos todavía no están disponibles para tu tienda. Avísale al equipo de DuLabs para que lo active.");
      assert.equal((await s.crear(actor(t), { tipo: "pie", borrador: { columnas: [], mostrar_categorias: true, redes: [] } })).tipo, "pie");
      assert.deepEqual(await s.listar(actor(t), { tipo: "multimedia" }), []);
    } finally {
      await vieja.cerrar();
    }
  });

  it("subir un video antes de la migración se rechaza con un error entendible (el formato todavía no existe en la base)", async () => {
    const vieja = await crearBaseCms({ conMultimedia: false });
    try {
      const r = crearRepositorioSupabaseCms(vieja.supabase);
      const v = crearServicioVideos({ repo: r, almacen: crearAlmacenMemoria() });
      const t = "a0000000-0000-4000-8000-0000000000f3";
      await vieja.habilitarModulo(t);
      const e = await fallo(v.solicitarSubida(actor(t), { mimeType: "video/mp4", bytes: 1_000_000 }));
      assert.equal(e.code, "INTERNAL_ERROR");
      assert.equal((await vieja.sql("select 1 from public.dulabs_cms_assets")).length, 0, "no quedó nada a medias");
    } finally {
      await vieja.cerrar();
    }
  });
});
