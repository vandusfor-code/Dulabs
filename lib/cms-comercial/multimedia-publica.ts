/**
 * CMS comercial — carga de las FOTOS Y VIDEOS publicados de una tienda pública (los videos del inicio y la imagen de presentación de las categorías). Las dependencias llegan inyectadas (se
 * prueba sin red ni base de datos).
 *
 * El inicio de la tienda se dibuja con sus videos de siempre; esto solo los reemplaza cuando la administradora publicó otros. Así que nunca puede romper la tienda ni demorarla: ante cualquier
 * problema (módulo apagado, migración sin aplicar, tienda no publicada, un error de la base de datos o una lectura demasiado lenta) no hay nada que reemplazar y la tienda se ve como siempre.
 * El negocio sale de la publicación (por el slug), jamás de la petición.
 */
import { conPlazo } from "@/lib/cms-comercial/plazo";
import { multimediaDesdeCms, type MultimediaTienda } from "@/lib/cms-comercial/multimedia-tienda";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";

export interface DepsMultimediaPublica {
  /** Id del negocio de una tienda publicada y visible (null si no existe). SOLO servidor. */
  tenantDe(slug: string): Promise<string | null>;
  /** Lector del CMS: null = el CMS no existe para ese negocio (módulo apagado o sin migración). */
  cargar(tenantId: string): Promise<InstantaneaCms | null>;
  /** Tope de espera de toda la lectura. Pasado el tope, la tienda se ve como siempre. */
  plazoMs?: number;
  /** Aviso interno de una falla (no recibe contenido del negocio). Por defecto, un registro en consola. */
  alFallar?(error: unknown): void;
}

/** Como el pie y la vitrina: el inicio no debe hacer esperar al cliente por algo que solo cambia un video. */
export const PLAZO_MULTIMEDIA_MS = 2000;

const avisoPorDefecto = (error: unknown) => console.error("[cms-comercial/multimedia] la tienda usa sus videos de siempre:", error instanceof Error ? error.message : "error desconocido");

/** El aviso nunca puede romper la tienda. */
function avisar(deps: DepsMultimediaPublica, error: unknown): void {
  try {
    (deps.alFallar ?? avisoPorDefecto)(error);
  } catch {
    /* el aviso nunca puede romper la tienda */
  }
}

/** Lo publicado de «fotos y videos» listo para la tienda; null si no hay nada que reemplazar (o si algo falló: nunca lanza). */
export async function cargarMultimediaPublica(deps: DepsMultimediaPublica, slug: string): Promise<MultimediaTienda | null> {
  try {
    return await conPlazo(
      (async (): Promise<MultimediaTienda | null> => {
        const tenantId = await deps.tenantDe(slug);
        if (!tenantId) return null;
        const snap = await deps.cargar(tenantId);
        return snap ? multimediaDesdeCms(snap, slug) : null;
      })(),
      deps.plazoMs ?? PLAZO_MULTIMEDIA_MS,
      "de las fotos y videos",
    );
  } catch (error) {
    avisar(deps, error);
    return null;
  }
}
