/**
 * CMS comercial — cableado REAL (solo servidor) de la tienda pública con el CMS: el negocio de la publicación, el lector de lo publicado y la lectura de Storage.
 * Lo usan la carga de la vitrina (página de inicio) y la ruta de las imágenes; ambos reciben estas dependencias inyectadas y se prueban sin red.
 *
 * Perezoso a propósito: el cliente de base de datos se crea al primer uso, DENTRO de quien llama, para que cualquier falla (por ejemplo, una variable de
 * entorno ausente) caiga en su manejo de errores (la tienda usa su vitrina de siempre; la imagen responde 502) y no rompa la página al construir las dependencias.
 */
import { createResolucionCatalogo } from "@/lib/catalogo/resolucion";
import { productoParaCombo } from "@/lib/cms-comercial/consulta";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createPublicCatalogService } from "@/lib/catalogo/service";
import type { ProductoParaCombo } from "@/lib/cms-comercial/evaluacion";
import { leerPublicado } from "@/lib/cms-comercial/lectura-publicada";
import { repositorioConPrecios } from "@/lib/cms-comercial/precios-supabase";
import { supabaseAdmin } from "@/lib/supabase";

// El mapeo producto → datos del combo vive en consulta.ts (lo comparten la tienda y ARIA); se vuelve a exportar aquí por los nombres que ya usan otros archivos.
export { productoParaCombo };

function construir() {
  const supabase = supabaseAdmin();
  const repo = createSupabaseCatalogRepository(supabase);
  return { supabase, repo, servicio: createPublicCatalogService({ repo }), conPrecios: repositorioConPrecios(supabase) };
}

export function crearDepsPublicasCms() {
  let base: ReturnType<typeof construir> | null = null;
  const dep = () => (base ??= construir());
  return {
    tenantDe: (slug: string) => dep().servicio.tenantOf(slug),
    // Lo publicado se lee UNA vez por render: la vitrina, los combos y los precios de la misma página comparten la lectura (lectura-publicada.ts).
    cargar: (tenantId: string) => leerPublicado(dep().supabase, tenantId),
    abrir: (path: string) => dep().repo.openImage(path),
    /**
     * Los datos reales de los productos de los combos, con el precio EFECTIVO detal (lo que el cliente pagaría hoy por separado: así «precio normal» y «ahorro»
     * nunca prometen un descuento que ya no existe). Solo uso interno: el stock exacto no sale de aquí hacia el navegador.
     */
    productosDeCombos: async (tenantId: string, referencias: readonly string[]): Promise<ReadonlyMap<string, ProductoParaCombo>> => {
      const lote = await createResolucionCatalogo({ repo: dep().conPrecios }).resolverReferencias(tenantId, referencias);
      return new Map(lote.items.map((p) => [p.reference, productoParaCombo(p)]));
    },
    ahora: () => Date.now(),
  };
}
