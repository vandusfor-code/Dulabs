/**
 * CMS comercial — carga del PIE DE PÁGINA publicado de una tienda pública (y de los códigos de sus páginas propias publicadas, a las que el pie puede enlazar). Las dependencias llegan inyectadas (se prueba
 * sin red ni base de datos).
 *
 * El pie sale en TODAS las pantallas de la tienda, así que esta carga nunca puede romperla ni demorarla: ante cualquier problema (módulo apagado, migración sin aplicar, tienda no publicada, un
 * error de la base de datos o una lectura demasiado lenta) no hay pie ni páginas y la tienda dibuja el pie de siempre. El negocio sale de la publicación (por el slug), jamás de la petición.
 */
import type { Pie } from "@/lib/cms-comercial/esquemas";
import { clavesDePaginas } from "@/lib/cms-comercial/pagina";
import { conPlazo } from "@/lib/cms-comercial/plazo";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";

export interface DepsPiePublico {
  /** Id del negocio de una tienda publicada y visible (null si no existe). SOLO servidor. */
  tenantDe(slug: string): Promise<string | null>;
  /** Lector del CMS: null = el CMS no existe para ese negocio (módulo apagado o sin migración). */
  cargar(tenantId: string): Promise<InstantaneaCms | null>;
  /** Tope de espera de toda la lectura. Pasado el tope, la tienda usa el pie de siempre. */
  plazoMs?: number;
  /** Aviso interno de una falla (no recibe contenido del negocio). Por defecto, un registro en consola. */
  alFallar?(error: unknown): void;
}

/** Menos que la vitrina y la página de mayoristas: el pie va en todas las pantallas y no debe hacer esperar al cliente. */
export const PLAZO_PIE_MS = 2000;

/** Lo que el pie necesita saber de lo publicado: su contenido y los códigos de las páginas propias a las que puede enlazar. */
export interface DatosPie {
  /** El pie publicado, o null (la tienda dibuja el de siempre). */
  pie: Pie | null;
  /** Los códigos de las páginas propias publicadas HOY. */
  paginas: string[];
}

const sinDatos = (): DatosPie => ({ pie: null, paginas: [] });

const avisoPorDefecto = (error: unknown) => console.error("[cms-comercial/pie] la tienda usa el pie de siempre:", error instanceof Error ? error.message : "error desconocido");

/** El aviso nunca puede romper la tienda. */
function avisar(deps: DepsPiePublico, error: unknown): void {
  try {
    (deps.alFallar ?? avisoPorDefecto)(error);
  } catch {
    /* el aviso nunca puede romper la tienda */
  }
}

/** El pie publicado de una tienda y sus páginas publicadas; sin pie (o sin CMS para ella, o si algo falló) el pie es null y no hay páginas. */
export async function cargarPiePublico(deps: DepsPiePublico, slug: string): Promise<DatosPie> {
  try {
    return await conPlazo(
      (async (): Promise<DatosPie> => {
        const tenantId = await deps.tenantDe(slug);
        if (!tenantId) return sinDatos();
        const snap = await deps.cargar(tenantId);
        return snap ? { pie: snap.pie?.contenido ?? null, paginas: clavesDePaginas(snap) } : sinDatos();
      })(),
      deps.plazoMs ?? PLAZO_PIE_MS,
      "del pie de página",
    );
  } catch (error) {
    avisar(deps, error);
    return sinDatos();
  }
}
