/**
 * CMS comercial — ADAPTADORES reales de los puertos: catálogo (productos y categorías del negocio) y variables (configuración del negocio de ARIA).
 * Solo lectura; nada de aquí modifica el catálogo ni la configuración.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { availabilityOf, isReference, type CatalogProduct } from "@/lib/catalogo/domain";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import type { ProductoVista, PuertoCatalogo, PuertoVariables, VariablesNegocio } from "@/lib/cms-comercial/puertos";
import { formatearPesos, type ValoresVariables } from "@/lib/cms-comercial/variables";

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
  };
}

interface FilaConfigAgente {
  negocio: unknown;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valores de las variables a partir de `negocio` (la configuración del negocio de ARIA). Lo que no esté configurado simplemente no existe. */
export function variablesDeNegocio(negocio: unknown): VariablesNegocio {
  const n = esObjeto(negocio) ? negocio : {};
  const pedido = esObjeto(n.pedido) ? n.pedido : {};
  const variables: ValoresVariables = {};
  const minimo = typeof pedido.minimo_mayorista === "number" && Number.isInteger(pedido.minimo_mayorista) && pedido.minimo_mayorista > 0 ? pedido.minimo_mayorista : null;
  if (minimo !== null) variables.minimo_mayorista = formatearPesos(minimo);
  if (typeof pedido.direccion_tienda === "string" && pedido.direccion_tienda.trim() !== "") variables.direccion_tienda = pedido.direccion_tienda.trim();
  if (typeof n.nombre_negocio === "string" && n.nombre_negocio.trim() !== "") variables.nombre_negocio = n.nombre_negocio.trim();
  return { variables, minimoMayorista: minimo };
}

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
