/**
 * CMS comercial — carga de la PÁGINA «Mayoristas» de la tienda pública. Las dependencias llegan inyectadas (se prueba sin red ni base de datos).
 *
 * Nunca lanza: ante cualquier problema (módulo apagado, migración sin aplicar, tienda no publicada, un error de la base de datos o una lectura demasiado lenta) devuelve `null` y la página
 * se dibuja solo con lo que la tienda ya sabe (título, botón de WhatsApp), sin error para el cliente. El negocio sale de la publicación (por el slug), jamás de la petición del navegador.
 */
import { paginaMayoristas, type OpcionesPaginaMayoristas, type PaginaMayoristas } from "@/lib/cms-comercial/pagina-mayoristas";
import type { VariablesNegocio } from "@/lib/cms-comercial/puertos";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";

export interface DepsPaginaMayoristas {
  /** Id del negocio de una tienda publicada y visible (null si no existe). SOLO servidor. */
  tenantDe(slug: string): Promise<string | null>;
  /** Lector del CMS: null = el CMS no existe para ese negocio (módulo apagado o sin migración). */
  cargar(tenantId: string): Promise<InstantaneaCms | null>;
  /** Los valores de las variables de los textos (el mínimo mayorista…) a partir de la configuración del negocio. */
  negocio(tenantId: string): Promise<VariablesNegocio>;
  /** Reloj inyectado (milisegundos). */
  ahora(): number;
  /** Tope de espera de toda la lectura. Pasado el tope, la página sale sin contenido del CMS. */
  plazoMs?: number;
  /** Aviso interno de una falla (no recibe contenido del negocio). Por defecto, un registro en consola. */
  alFallar?(error: unknown): void;
}

export const PLAZO_PAGINA_MAYORISTAS_MS = 2500;

class PlazoVencido extends Error {
  constructor() {
    super("la lectura de la página de mayoristas tardó demasiado");
  }
}

async function conPlazo<T>(trabajo: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new PlazoVencido()), ms);
  });
  try {
    return await Promise.race([trabajo, tope]);
  } finally {
    clearTimeout(temporizador);
  }
}

const avisoPorDefecto = (error: unknown) => console.error("[cms-comercial/mayoristas] la página sale sin contenido del CMS:", error instanceof Error ? error.message : "error desconocido");

/** El aviso nunca puede romper la tienda. */
function avisar(deps: DepsPaginaMayoristas, error: unknown): void {
  try {
    (deps.alFallar ?? avisoPorDefecto)(error);
  } catch {
    /* el aviso nunca puede romper la tienda */
  }
}

/** Lo publicado para la página «Mayoristas» de una tienda, o null si no hay CMS para ella o algo falló. */
export async function cargarPaginaMayoristas(deps: DepsPaginaMayoristas, slug: string, opciones: OpcionesPaginaMayoristas): Promise<PaginaMayoristas | null> {
  try {
    const ahora = deps.ahora();
    return await conPlazo(
      (async () => {
        const tenantId = await deps.tenantDe(slug);
        if (!tenantId) return null;
        // El CMS y la configuración del negocio se leen a la vez: la página espera lo que tarde el más lento, no la suma.
        const [snap, negocio] = await Promise.all([deps.cargar(tenantId), deps.negocio(tenantId)]);
        if (!snap) return null;
        return paginaMayoristas(snap, negocio, ahora, opciones);
      })(),
      deps.plazoMs ?? PLAZO_PAGINA_MAYORISTAS_MS,
    );
  } catch (error) {
    avisar(deps, error);
    return null;
  }
}
