/**
 * CMS comercial — ADAPTADORES reales de los puertos: catálogo (productos y categorías del negocio) y variables (configuración del negocio de ARIA).
 * Solo lectura; nada de aquí modifica el catálogo ni la configuración.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { availabilityOf, isReference, type CatalogProduct } from "@/lib/catalogo/domain";
import { retailPath } from "@/lib/catalogo/publicacion";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import type { ProductoVista, PuertoCatalogo, PuertoVariables } from "@/lib/cms-comercial/puertos";
import { variablesDeNegocio } from "@/lib/cms-comercial/variables-negocio";

/** Un precio de 0 o negativo equivale a «a consultar»: ninguna oferta puede apoyarse en él. */
const precioONulo = (v: number | null): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

export function crearPuertoCatalogoSupabase(supabase: SupabaseClient): PuertoCatalogo {
  const repo = createSupabaseCatalogRepository(supabase);
  const vista = (p: CatalogProduct): ProductoVista => ({
    referencia: p.reference,
    nombre: p.name,
    categoriaId: p.categoryId,
    categoriaNombre: p.categoryName,
    activo: p.status === "ACTIVE",
    agotado: availabilityOf(p) === "sold_out",
    precioDetal: precioONulo(p.pricing.retail),
    precioMayor: precioONulo(p.pricing.wholesale),
    miniatura: p.primaryImage?.thumbUrl ?? null,
  });
  return {
    async productosPorReferencia(tenantId, referencias) {
      const validas = [...new Set(referencias)].filter(isReference).slice(0, 300);
      if (validas.length === 0) return [];
      return (await repo.getProductsByReferences(tenantId, validas)).map(vista);
    },

    async buscarProductos(tenantId, consulta, limite) {
      const { items } = await repo.listProducts(tenantId, { search: consulta || undefined, status: "ACTIVE", offset: 0, limit: Math.max(1, Math.min(limite, 50)) });
      return items.map(vista);
    },

    async categoriasPorId(tenantId, ids) {
      const buscadas = new Set(ids);
      return (await repo.listCategories(tenantId)).filter((c) => buscadas.has(c.id)).map((c) => ({ id: c.id, nombre: c.name }));
    },

    async listarCategorias(tenantId) {
      return (await repo.listCategories(tenantId)).map((c) => ({ id: c.id, nombre: c.name }));
    },

    async rutaPublica(tenantId) {
      const publicacion = await repo.getPublication(tenantId);
      return publicacion?.published ? retailPath(publicacion.slug) : null;
    },
  };
}

interface FilaConfigAgente {
  negocio: unknown;
}

export { variablesDeNegocio };

export function crearPuertoVariablesSupabase(supabase: SupabaseClient): PuertoVariables {
  return {
    async valores(tenantId) {
      // Un negocio puede tener más de una línea configurada: manda la habilitada más antigua.
      const { data, error } = await supabase
        .from("dulabs_agente_runtime_config")
        .select("negocio")
        .eq("id_tenant", tenantId)
        .order("habilitado", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Sin configuración legible no se inventa nada: ninguna variable queda con valor y los textos que las usen no se podrán publicar ni se entregarán.
        console.error("[cms-comercial] no se pudo leer la configuración del negocio:", error.code, error.message);
        return { variables: {}, minimoMayorista: null };
      }
      return variablesDeNegocio((data as FilaConfigAgente | null)?.negocio);
    },
  };
}
