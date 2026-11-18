/**
 * Las piezas de HOMBRE de un negocio, para quien necesita decidir «¿de qué lado de la tienda es esto?» fuera de la tienda (hoy: el agente de WhatsApp).
 *
 * La tienda de un negocio separa Hombre y Mujer solo si su configuración lo dice (`generoDeLaTienda(slug)`, lib/catalogo/joyeria.ts); el «para quién» de cada pieza es
 * la columna `genero` (migración 20261215000000) y se lee APARTE de la lista de productos con `repo.listHombreReferences`. Esta función junta las tres condiciones y devuelve
 * las referencias de hombre, o `null` cuando NO hay nada que separar — y entonces nadie debe cambiar su comportamiento:
 *
 *   - el repositorio no ofrece la lectura, el negocio no tiene publicación o su tienda no separa hombre y mujer;
 *   - la migración aún no está aplicada (la lectura devuelve null) o todavía no hay ninguna pieza de hombre;
 *   - hay MÁS piezas de hombre que `HOMBRES_BUSQUEDA_MAX`: la búsqueda local (busqueda-local.ts) dejaría de ser razonable, así que la separación se apaga en vez de devolver
 *     resultados incompletos (se avisa en el registro);
 *   - la lectura falló (nunca lanza: un negocio sin esta señal sigue funcionando como siempre).
 */
import { conjuntoDeHombres } from "@/lib/catalogo/genero";
import { generoDeLaTienda } from "@/lib/catalogo/joyeria";
import type { CatalogRepository } from "@/lib/catalogo/repository";

/** Tope de piezas de hombre que se buscan en memoria (se leen por lotes de 100). Con más, la separación en la búsqueda del agente se apaga. */
export const HOMBRES_BUSQUEDA_MAX = 600;

export async function hombresDelNegocio(repo: Pick<CatalogRepository, "getPublication" | "listHombreReferences">, tenantId: string): Promise<ReadonlySet<string> | null> {
  try {
    if (!repo.listHombreReferences) return null;
    const publicacion = await repo.getPublication(tenantId);
    if (!publicacion || !generoDeLaTienda(publicacion.slug)) return null;
    const referencias = await repo.listHombreReferences(tenantId);
    if (!referencias || referencias.length === 0) return null;
    if (referencias.length > HOMBRES_BUSQUEDA_MAX) {
      console.error(`[catalogo/genero] ${referencias.length} piezas de hombre (tope ${HOMBRES_BUSQUEDA_MAX}): la búsqueda por género del agente queda apagada hasta pasarla a la base.`);
      return null;
    }
    return conjuntoDeHombres(referencias);
  } catch (error) {
    console.error("[catalogo/genero] no se pudieron leer las piezas de hombre; el agente sigue sin separar por género:", error instanceof Error ? error.message : error);
    return null;
  }
}
