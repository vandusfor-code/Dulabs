/**
 * CMS comercial — carga de la VITRINA PÚBLICA con respaldo. Las dependencias llegan inyectadas (se prueba sin red ni base de datos).
 *
 * La tienda NUNCA se cae ni se ve peor por el CMS. Cada una de estas situaciones deja la vitrina de siempre (el registro del negocio), sin error para el cliente:
 *   - la tienda de tecnología (tiene su propio contenido: ni siquiera se consulta el CMS);
 *   - módulo apagado, migración sin aplicar o tienda no publicada;
 *   - nada publicado en el CMS (sin página principal);
 *   - un error de la base de datos o una lectura demasiado lenta (se registra el motivo, nunca el contenido).
 * El negocio de la tienda sale de la publicación (por el slug), jamás de la petición del navegador.
 */
import type { OpcionesInicio } from "@/lib/catalogo/service";
import type { CatalogStorefrontConfig } from "@/lib/catalogo/vitrina";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { vitrinaDesdeCms, type ContextoVitrina } from "@/lib/cms-comercial/vitrina";

export interface DepsVitrinaPublica {
  /** Id del negocio de una tienda publicada y visible (null si no existe). SOLO servidor. */
  tenantDe(slug: string): Promise<string | null>;
  /** Lector del CMS: null = el CMS no existe para ese negocio (módulo apagado o sin migración). */
  cargar(tenantId: string): Promise<InstantaneaCms | null>;
  /** Reloj inyectado (milisegundos). */
  ahora(): number;
  /** Tope de espera de toda la lectura del CMS. Pasado el tope, la tienda sigue con su vitrina de siempre. */
  plazoMs?: number;
  /** Aviso interno de una falla (no recibe contenido del negocio). Por defecto, un registro en consola. */
  alFallar?(error: unknown): void;
}

export interface VitrinaInicio {
  config: CatalogStorefrontConfig;
  /** Lo que el servicio del catálogo debe resolver para ese inicio (destacados, categorías y productos de la campaña). */
  opciones: OpcionesInicio;
  /** De dónde salió: "cms" (hay página principal publicada) o "registro" (la vitrina de siempre). */
  origen: "cms" | "registro";
}

export const PLAZO_VITRINA_MS = 2500;

class PlazoVencido extends Error {
  constructor() {
    super("la lectura del CMS tardó demasiado");
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

/** Lo que el catálogo debe resolver para esta vitrina: las referencias y los ids elegidos, nada más. */
export function opcionesDeInicio(config: CatalogStorefrontConfig): OpcionesInicio {
  return {
    ...(config.destacados && config.destacados.length > 0 ? { destacadas: config.destacados } : {}),
    ...(config.categoriasDestacadas && config.categoriasDestacadas.length > 0 ? { categorias: config.categoriasDestacadas } : {}),
    ...(config.campana && config.campana.productos.length > 0 ? { campana: config.campana.productos } : {}),
  };
}

const deSiempre = (registro: CatalogStorefrontConfig): VitrinaInicio => ({ config: registro, opciones: {}, origen: "registro" });

const avisoPorDefecto = (error: unknown) => console.error("[cms-comercial/vitrina] se usa la vitrina de siempre:", error instanceof Error ? error.message : "error desconocido");

/** Nunca lanza: ante cualquier problema devuelve la vitrina de siempre. `ctx` lleva la tienda (slug, rutas, WhatsApp y categorías); el reloj lo pone `deps`. */
export async function cargarVitrinaInicio(deps: DepsVitrinaPublica, registro: CatalogStorefrontConfig, ctx: Omit<ContextoVitrina, "ahora">): Promise<VitrinaInicio> {
  if (registro.tema === "tecnologia") return deSiempre(registro);
  try {
    const snap = await conPlazo(
      (async () => {
        const tenantId = await deps.tenantDe(ctx.slug);
        return tenantId ? deps.cargar(tenantId) : null;
      })(),
      deps.plazoMs ?? PLAZO_VITRINA_MS,
    );
    if (!snap) return deSiempre(registro);
    const config = vitrinaDesdeCms(snap, registro, { ...ctx, ahora: deps.ahora() });
    return config === registro ? deSiempre(registro) : { config, opciones: opcionesDeInicio(config), origen: "cms" };
  } catch (error) {
    try {
      (deps.alFallar ?? avisoPorDefecto)(error);
    } catch {
      /* el aviso nunca puede romper la tienda */
    }
    return deSiempre(registro);
  }
}
