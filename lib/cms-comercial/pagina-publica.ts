/**
 * CMS comercial — carga de UNA PÁGINA propia publicada de la tienda pública (/catalogo/{tienda}/p/{código}): la política de privacidad, los términos… que la administradora escribió. Las
 * dependencias llegan inyectadas (se prueba sin red ni base de datos).
 *
 * A diferencia del pie, una página no tiene un «de siempre» al que volver, así que el resultado distingue tres casos: la página (`ok`), que NO existe (`no_existe`: la tienda no existe, el negocio no
 * tiene CMS, el código no tiene el formato de un código o la página no está publicada hoy; la tienda responde 404) y que no se pudo leer (`error`: un fallo de la base de datos o una lectura demasiado
 * lenta; la tienda lo dice con claridad en lugar de fingir que la página no existe). Nunca lanza. El negocio sale de la publicación (por el slug), jamás de la petición del navegador.
 */
import { esClavePagina, paginaDesdeCms, type PaginaVista } from "@/lib/cms-comercial/pagina";
import type { DepsPiePublico } from "@/lib/cms-comercial/pie-publico";
import { conPlazo } from "@/lib/cms-comercial/plazo";

/** Las mismas dependencias que la carga del pie: quién es el negocio de la tienda y el lector del CMS. */
export type DepsPaginaPublica = DepsPiePublico;

/** Una página es el contenido de la pantalla (no un adorno como el pie): se le da un poco más de espera. */
export const PLAZO_PAGINA_MS = 2500;

export type ResultadoPagina = { estado: "ok"; pagina: PaginaVista } | { estado: "no_existe" } | { estado: "error" };

const avisoPorDefecto = (error: unknown) => console.error("[cms-comercial/pagina] no se pudo leer la página:", error instanceof Error ? error.message : "error desconocido");

/** El aviso nunca puede romper la tienda. */
function avisar(deps: DepsPaginaPublica, error: unknown): void {
  try {
    (deps.alFallar ?? avisoPorDefecto)(error);
  } catch {
    /* el aviso nunca puede romper la tienda */
  }
}

/** La página publicada con ese código en esa tienda. Un código que no tiene el formato de un código no consulta nada. */
export async function cargarPaginaPublica(deps: DepsPaginaPublica, slug: string, clave: string): Promise<ResultadoPagina> {
  if (!esClavePagina(clave)) return { estado: "no_existe" };
  try {
    return await conPlazo(
      (async (): Promise<ResultadoPagina> => {
        const tenantId = await deps.tenantDe(slug);
        if (!tenantId) return { estado: "no_existe" };
        const pagina = paginaDesdeCms(await deps.cargar(tenantId), clave);
        return pagina ? { estado: "ok", pagina } : { estado: "no_existe" };
      })(),
      deps.plazoMs ?? PLAZO_PAGINA_MS,
      "de la página",
    );
  } catch (error) {
    avisar(deps, error);
    return { estado: "error" };
  }
}
