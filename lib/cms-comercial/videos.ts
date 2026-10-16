/**
 * CMS comercial — SERVICIO de videos: subida directa a Storage con URL firmada y verificación en el servidor, igual que las imágenes pero con las reglas de un video.
 *
 *   1. solicitarSubida: el servidor decide el id y las rutas, registra el video como «pendiente» y entrega una URL firmada para UN archivo (de hasta 3 MB);
 *   2. el navegador sube DIRECTO a Storage (el video no pasa por una función de Vercel). Antes de subir, el propio navegador ya le dijo a la administradora si el video sirve
 *      (mismo código, lib/cms-comercial/video-requisitos.ts), así que esto casi nunca rechaza nada;
 *   3. confirmar: el servidor lee lo subido y lo analiza DE NUEVO (la que manda es esta verificación, no la del navegador): que sea un MP4 de verdad, con video H.264 estándar, sin sonido,
 *      de las medidas y la duración del espacio donde se usa. Si cumple, mueve el índice de reproducción al principio (para que empiece a verse antes de bajar todo), lo guarda en su
 *      ruta final y recién entonces queda «listo». Si no cumple, se borra lo subido y se le dice a la administradora, regla por regla, qué arreglar.
 * Un video no se transforma en el servidor (no hay un codificador): se acepta tal cual o se rechaza. Solo un administrador sube; todos los roles del equipo ven la lista.
 */
import { randomUUID } from "node:crypto";
import { CMS_ROLES_ESCRITURA, CMS_ROLES_LECTURA, type ActorCms, type AssetCms, type Problema } from "@/lib/cms-comercial/contrato";
import type { AlmacenImagenes } from "@/lib/cms-comercial/almacen";
import { CmsError } from "@/lib/cms-comercial/errores";
import { nombreSeguro } from "@/lib/cms-comercial/imagenes";
import type { CmsRepositorio } from "@/lib/cms-comercial/repositorio";
import { analizarMp4, optimizarParaWeb } from "@/lib/cms-comercial/video-mp4";
import { ARCHIVOS_VIDEO, MAX_BYTES_VIDEO, evaluarVideo, pesoDicho, pesoLegible, type ArchivoVideoId } from "@/lib/cms-comercial/video-requisitos";

/**
 * Tope de videos listos por negocio. No hay forma de borrar un video (las versiones publicadas de la tienda son de solo añadir y un video viejo puede volver a usarse al restaurar una
 * versión), así que el tope cuenta TODA la vida del negocio: es generoso a propósito (unos 360 MB como máximo).
 */
export const LIMITE_VIDEOS = 120;

export const TIPO_VIDEO = "video/mp4";

export interface TicketVideo {
  id: string;
  bucket: string;
  /** Ruta temporal a la que sube el navegador (el servidor decidió su nombre). */
  path: string;
  token: string;
  maxBytes: number;
}

export interface VideoVista {
  id: string;
  /** Dirección del video para la vista previa en el panel (la tienda lo sirve por su propia ruta, solo cuando está publicado). */
  url: string;
  ancho: number;
  alto: number;
  bytes: number;
  nombreOriginal: string | null;
  createdAt: string;
}

export interface VideoConfirmado {
  video: VideoVista;
  /** Cuánto dura, en segundos (solo al confirmar por primera vez; null si ya estaba confirmado). */
  duracionSeg: number | null;
  /** Lo que el servidor arregló solo (por ejemplo, mover el índice de reproducción al principio). */
  seCorrigio: string[];
  /** Lo que no impide usarlo pero conviene saber (pesa más de lo ideal, dura más de 10 s…). */
  recomendaciones: string[];
}

export interface ServicioVideos {
  solicitarSubida(actor: ActorCms, input: { mimeType: string; bytes: number; nombreOriginal?: string | null }): Promise<TicketVideo>;
  confirmar(actor: ActorCms, id: string, input: { archivo: ArchivoVideoId }): Promise<VideoConfirmado>;
  listar(actor: ActorCms): Promise<VideoVista[]>;
}

export interface VideosDeps {
  repo: CmsRepositorio;
  almacen: AlmacenImagenes;
  nuevoId?: () => string;
  /** Mueve el índice de reproducción al principio (por defecto, `optimizarParaWeb`). Se puede reemplazar para probar que el resultado se comprueba antes de usarlo. */
  optimizar?: (bytes: Uint8Array) => Uint8Array | null;
}

/** Rutas de un video: la final (MP4 verificado) y la temporal de subida, ambas bajo `{negocio}/cms/{id}/`. */
export const rutasDeVideo = (tenantId: string, id: string) => ({ final: `${tenantId}/cms/${id}/video.mp4`, temporal: `${tenantId}/cms/${id}/subida` });

export const esVideo = (a: Pick<AssetCms, "mimeType">) => a.mimeType === TIPO_VIDEO;

const DEMASIADO_PESADO = (bytes: number) => `El video pesa ${pesoDicho(bytes)} y el máximo es ${pesoLegible(MAX_BYTES_VIDEO)}. Redúcelo (por ejemplo en HandBrake: «Fast 720p30» con calidad RF 28) y vuelve a intentar.`;

export function crearServicioVideos(deps: VideosDeps): ServicioVideos {
  const { repo, almacen } = deps;
  const nuevoId = deps.nuevoId ?? randomUUID;
  const optimizar = deps.optimizar ?? optimizarParaWeb;

  const exigirEscritura = (actor: ActorCms) => {
    if (!CMS_ROLES_ESCRITURA.includes(actor.rol)) throw new CmsError("FORBIDDEN", "Solo un administrador puede modificar la tienda.");
  };
  const exigirLectura = (actor: ActorCms) => {
    if (!CMS_ROLES_LECTURA.includes(actor.rol)) throw new CmsError("FORBIDDEN", "No tienes acceso a la administración de la tienda.");
  };

  const vista = (a: AssetCms): VideoVista => ({ id: a.id, url: almacen.urlPublica(a.storagePath), ancho: a.ancho, alto: a.alto, bytes: a.bytes, nombreOriginal: a.nombreOriginal, createdAt: a.createdAt });

  return {
    async solicitarSubida(actor, input) {
      exigirEscritura(actor);
      if (input.mimeType !== TIPO_VIDEO) throw new CmsError("VALIDATION_ERROR", "Usa un video MP4 (con video H.264). Si el tuyo es MOV, WebM u otro formato, expórtalo de nuevo como MP4.");
      if (!Number.isInteger(input.bytes) || input.bytes < 1) throw new CmsError("VALIDATION_ERROR", "El video está vacío.");
      if (input.bytes > MAX_BYTES_VIDEO) throw new CmsError("VALIDATION_ERROR", DEMASIADO_PESADO(input.bytes));
      if ((await repo.listarAssets(actor.tenantId, 500)).filter(esVideo).length >= LIMITE_VIDEOS) {
        throw new CmsError("VALIDATION_ERROR", `Llegaste al máximo de ${LIMITE_VIDEOS} videos subidos. Escríbele al equipo de DuLabs para ampliarlo.`);
      }
      const id = nuevoId();
      const { final, temporal } = rutasDeVideo(actor.tenantId, id);
      // Las medidas reales se registran al confirmar; mientras tanto, valores mínimos válidos.
      const creada = await repo.crearAsset(actor.tenantId, { id, storagePath: final, mimeType: TIPO_VIDEO, bytes: input.bytes, ancho: 16, alto: 16, nombreOriginal: nombreSeguro(input.nombreOriginal), actor });
      if (creada.resultado !== "ok") throw new CmsError("INTERNAL_ERROR", "No se pudo preparar la subida del video. Intenta de nuevo.");
      const firma = await almacen.firmarSubida(temporal);
      return { id, bucket: almacen.bucket, path: firma.path, token: firma.token, maxBytes: MAX_BYTES_VIDEO };
    },

    async confirmar(actor, id, { archivo }) {
      exigirEscritura(actor);
      if (!(ARCHIVOS_VIDEO as readonly string[]).includes(archivo)) throw new CmsError("VALIDATION_ERROR", "El espacio del video no es válido.");
      const asset = await repo.obtenerAsset(actor.tenantId, id);
      if (!asset || !esVideo(asset)) throw new CmsError("NOT_FOUND", "No encontramos ese video.");
      if (asset.estado === "listo") return { video: vista(asset), duracionSeg: null, seCorrigio: [], recomendaciones: [] }; // confirmar dos veces es idempotente
      // Las rutas se recalculan desde el negocio de la sesión y el id: nunca de lo que mande el navegador.
      const { final, temporal } = rutasDeVideo(actor.tenantId, asset.id);
      if (asset.storagePath !== final) throw new CmsError("INTERNAL_ERROR", "No se pudo verificar el video. Intenta de nuevo.");

      const infoTemporal = await almacen.info(temporal);
      if (infoTemporal && infoTemporal.size !== null && infoTemporal.size > MAX_BYTES_VIDEO) {
        await almacen.borrar([temporal]);
        throw new CmsError("VALIDATION_ERROR", DEMASIADO_PESADO(infoTemporal.size));
      }
      let origen = infoTemporal ? await almacen.leer(temporal, MAX_BYTES_VIDEO) : null;
      // Un reintento después de que ya se escribió el video final (y se cayó antes de confirmar en la base): se vuelve a verificar el final.
      if (!origen) origen = await almacen.leer(final, MAX_BYTES_VIDEO);
      if (!origen) throw new CmsError("VALIDATION_ERROR", "No encontramos el video subido. Intenta subirlo de nuevo.");

      const analisis = analizarMp4(origen);
      const evaluacion = evaluarVideo(analisis, archivo);
      const medidas = analisis.video && analisis.video.ancho !== null && analisis.video.alto !== null ? { ancho: analisis.video.ancho, alto: analisis.video.alto } : null;
      if (!evaluacion.cumple || !analisis.video || !medidas) {
        await almacen.borrar([temporal]);
        const problemas: Problema[] = evaluacion.fallos.map((f) => ({ severidad: "error", codigo: f.id, campo: archivo, mensaje: [f.titulo + ".", f.detalle, f.arreglo].filter(Boolean).join(" ") }));
        const primero = evaluacion.fallos[0];
        throw new CmsError("VALIDATION_ERROR", `Este video no se puede usar: ${primero ? `${primero.detalle}${primero.arreglo ? ` ${primero.arreglo}` : ""}` : "no cumple los requisitos."}`, problemas);
      }

      // El índice de reproducción al principio: el video empieza a verse sin bajar todo el archivo. Si no se puede mover con seguridad, se guarda tal cual (se ve igual, solo arranca un poco después).
      let bytes: Uint8Array = origen;
      const seCorrigio: string[] = [];
      if (!analisis.indiceAlPrincipio) {
        const movido = optimizar(origen);
        const reanalisis = movido && movido !== origen ? analizarMp4(movido) : null;
        // El resultado se comprueba antes de usarlo: mismo tamaño, legible, con el índice al principio y con las mismas medidas y duración. Si algo no cuadra, se descarta.
        if (
          movido &&
          reanalisis &&
          movido.byteLength === origen.byteLength &&
          reanalisis.legible &&
          reanalisis.indiceAlPrincipio &&
          reanalisis.video?.ancho === medidas.ancho &&
          reanalisis.video?.alto === medidas.alto &&
          reanalisis.duracionSeg === analisis.duracionSeg
        ) {
          bytes = movido;
          seCorrigio.push(...evaluacion.seCorrigeSolo);
        }
      }

      await almacen.escribir(final, bytes, TIPO_VIDEO);
      await almacen.borrar([temporal]);

      const r = await repo.confirmarAsset(actor.tenantId, asset.id, { bytes: bytes.byteLength, ancho: medidas.ancho, alto: medidas.alto, actor });
      if (r.resultado === "ok") return { video: vista(r.asset), duracionSeg: analisis.duracionSeg, seCorrigio, recomendaciones: evaluacion.recomendaciones };
      if (r.resultado === "no_encontrada") throw new CmsError("NOT_FOUND", "No encontramos ese video.");
      throw new CmsError("VALIDATION_ERROR", "El video no cumple los requisitos. Prueba con otro.");
    },

    async listar(actor) {
      exigirLectura(actor);
      return (await repo.listarAssets(actor.tenantId, 500)).filter(esVideo).map(vista);
    },
  };
}
