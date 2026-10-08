/**
 * CMS comercial — SERVICIO de imágenes: subida directa a Storage con URL firmada, verificación y re-codificación en el servidor.
 *
 *   1. solicitarSubida: el servidor decide el id y las rutas, registra la imagen como «pendiente» y entrega una URL firmada para UN archivo;
 *   2. el navegador sube DIRECTO a Storage (la foto no pasa por una función de Vercel);
 *   3. confirmar: el servidor lee lo subido, comprueba que sea una imagen de verdad (firma real, dimensiones y píxeles acotados), la re-codifica a WebP sin metadatos,
 *      la guarda en su ruta final y recién entonces queda «lista» (solo las listas se pueden usar en el contenido y se entregan a la tienda).
 * Solo un administrador sube; todos los roles del equipo pueden ver la galería. Todo se filtra por el negocio de la sesión.
 */
import { randomUUID } from "node:crypto";
import {
  CMS_ROLES_ESCRITURA,
  CMS_ROLES_LECTURA,
  type ActorCms,
  type AssetCms,
} from "@/lib/cms-comercial/contrato";
import type { AlmacenImagenes } from "@/lib/cms-comercial/almacen";
import { CmsError } from "@/lib/cms-comercial/errores";
import { ImagenInvalida, MAX_BYTES_SUBIDA, procesarImagen } from "@/lib/cms-comercial/imagen-servidor";
import type { CmsRepositorio } from "@/lib/cms-comercial/repositorio";
import { normalizarTexto } from "@/lib/cms-comercial/texto-seguro";

/** Tope de imágenes listas por negocio. */
export const LIMITE_IMAGENES = 300;

export const TIPOS_SUBIDA = ["image/jpeg", "image/png", "image/webp"] as const;

export interface TicketSubida {
  id: string;
  bucket: string;
  /** Ruta temporal a la que sube el navegador (el servidor decidió su nombre). */
  path: string;
  token: string;
  maxBytes: number;
}

export interface ImagenVista {
  id: string;
  url: string;
  ancho: number;
  alto: number;
  bytes: number;
  nombreOriginal: string | null;
  createdAt: string;
}

export interface ServicioImagenes {
  solicitarSubida(actor: ActorCms, input: { mimeType: string; bytes: number; nombreOriginal?: string | null }): Promise<TicketSubida>;
  confirmar(actor: ActorCms, id: string): Promise<ImagenVista>;
  listar(actor: ActorCms): Promise<ImagenVista[]>;
}

export interface ImagenesDeps {
  repo: CmsRepositorio;
  almacen: AlmacenImagenes;
  nuevoId?: () => string;
}

/** Rutas de una imagen: la final (WebP verificado) y la temporal de subida, ambas bajo `{negocio}/cms/{id}/`. */
export const rutasDeImagen = (tenantId: string, id: string) => ({ final: `${tenantId}/cms/${id}/imagen.webp`, temporal: `${tenantId}/cms/${id}/subida` });

function nombreSeguro(nombre: string | null | undefined): string | null {
  if (nombre === null || nombre === undefined) return null;
  const sinRuta = normalizarTexto(nombre).split(/[\\/]/).pop() ?? "";
  const limpio = sinRuta.replace(/[<>:"|?*]/g, "").trim().slice(0, 120);
  return limpio === "" ? null : limpio;
}

export function crearServicioImagenes(deps: ImagenesDeps): ServicioImagenes {
  const { repo, almacen } = deps;
  const nuevoId = deps.nuevoId ?? randomUUID;

  const exigirEscritura = (actor: ActorCms) => {
    if (!CMS_ROLES_ESCRITURA.includes(actor.rol)) throw new CmsError("FORBIDDEN", "Solo un administrador puede modificar la tienda.");
  };
  const exigirLectura = (actor: ActorCms) => {
    if (!CMS_ROLES_LECTURA.includes(actor.rol)) throw new CmsError("FORBIDDEN", "No tienes acceso a la administración de la tienda.");
  };

  const vista = (a: AssetCms): ImagenVista => ({ id: a.id, url: almacen.urlPublica(a.storagePath), ancho: a.ancho, alto: a.alto, bytes: a.bytes, nombreOriginal: a.nombreOriginal, createdAt: a.createdAt });

  return {
    async solicitarSubida(actor, input) {
      exigirEscritura(actor);
      if (!(TIPOS_SUBIDA as readonly string[]).includes(input.mimeType)) throw new CmsError("VALIDATION_ERROR", "Usa una imagen JPG, PNG o WebP.");
      if (!Number.isInteger(input.bytes) || input.bytes < 1) throw new CmsError("VALIDATION_ERROR", "La imagen está vacía.");
      if (input.bytes > MAX_BYTES_SUBIDA) throw new CmsError("VALIDATION_ERROR", "La imagen supera el tamaño máximo permitido (6 MB).");
      if ((await repo.listarAssets(actor.tenantId, 500)).length >= LIMITE_IMAGENES) {
        throw new CmsError("VALIDATION_ERROR", `Llegaste al máximo de ${LIMITE_IMAGENES} imágenes. Quita alguna que ya no uses.`);
      }
      const id = nuevoId();
      const { final, temporal } = rutasDeImagen(actor.tenantId, id);
      // Ancho y alto reales se registran al confirmar; mientras tanto, valores mínimos válidos.
      const creada = await repo.crearAsset(actor.tenantId, { id, storagePath: final, mimeType: "image/webp", bytes: input.bytes, ancho: 16, alto: 16, nombreOriginal: nombreSeguro(input.nombreOriginal), actor });
      if (creada.resultado !== "ok") throw new CmsError("INTERNAL_ERROR", "No se pudo preparar la subida de la imagen. Intenta de nuevo.");
      const firma = await almacen.firmarSubida(temporal);
      return { id, bucket: almacen.bucket, path: firma.path, token: firma.token, maxBytes: MAX_BYTES_SUBIDA };
    },

    async confirmar(actor, id) {
      exigirEscritura(actor);
      const asset = await repo.obtenerAsset(actor.tenantId, id);
      if (!asset) throw new CmsError("NOT_FOUND", "No encontramos esa imagen.");
      if (asset.estado === "listo") return vista(asset); // confirmar dos veces es idempotente
      // Las rutas se recalculan desde el negocio de la sesión y el id: nunca de lo que mande el navegador.
      const { final, temporal } = rutasDeImagen(actor.tenantId, asset.id);
      if (asset.storagePath !== final) throw new CmsError("INTERNAL_ERROR", "No se pudo verificar la imagen. Intenta de nuevo.");

      const infoTemporal = await almacen.info(temporal);
      if (infoTemporal && infoTemporal.size !== null && infoTemporal.size > MAX_BYTES_SUBIDA) {
        await almacen.borrar([temporal]);
        throw new CmsError("VALIDATION_ERROR", "La imagen supera el tamaño máximo permitido (6 MB).");
      }
      let origen = infoTemporal ? await almacen.leer(temporal, MAX_BYTES_SUBIDA) : null;
      // Un reintento después de que ya se escribió la imagen final (y se cayó antes de confirmar en la base): se vuelve a verificar la final.
      if (!origen) origen = await almacen.leer(final, MAX_BYTES_SUBIDA);
      if (!origen) throw new CmsError("VALIDATION_ERROR", "No encontramos la imagen subida. Intenta subirla de nuevo.");

      let procesada;
      try {
        procesada = await procesarImagen(origen);
      } catch (err) {
        await almacen.borrar([temporal]);
        if (err instanceof ImagenInvalida) throw new CmsError("VALIDATION_ERROR", err.message);
        throw err;
      }
      await almacen.escribir(final, procesada.bytes, procesada.mimeType);
      await almacen.borrar([temporal]);

      const r = await repo.confirmarAsset(actor.tenantId, asset.id, { bytes: procesada.bytes.byteLength, ancho: procesada.ancho, alto: procesada.alto, actor });
      if (r.resultado === "ok") return vista(r.asset);
      if (r.resultado === "no_encontrada") throw new CmsError("NOT_FOUND", "No encontramos esa imagen.");
      throw new CmsError("VALIDATION_ERROR", "La imagen no cumple los requisitos. Prueba con otra.");
    },

    async listar(actor) {
      exigirLectura(actor);
      return (await repo.listarAssets(actor.tenantId, 200)).map(vista);
    },
  };
}
