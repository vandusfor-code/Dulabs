/**
 * CMS comercial — PUERTOS hacia lo que el CMS NO es dueño: el catálogo (productos y categorías) y la configuración del negocio (variables).
 * El CMS referencia productos por `referencia` y nunca los duplica; las implementaciones reales viven en adaptadores (catalogo-supabase.ts, variables-supabase.ts).
 */
import type { ProductoValidacion } from "@/lib/cms-comercial/validacion";
import type { ValoresVariables } from "@/lib/cms-comercial/variables";

/** Un producto del catálogo tal como lo necesita el editor (selectores) y la validación. Nunca incluye ids internos. */
export interface ProductoVista extends ProductoValidacion {
  categoriaNombre: string | null;
  /** URL de la miniatura (la misma que usa el catálogo), si el producto tiene foto. */
  miniatura: string | null;
}

export interface PuertoCatalogo {
  /** Los productos del negocio que existan con esas referencias (las que no existan simplemente no vienen). */
  productosPorReferencia(tenantId: string, referencias: readonly string[]): Promise<ProductoVista[]>;
  /** Búsqueda por nombre o referencia para los selectores del editor (el texto ya viene normalizado). Con texto vacío: los más recientes. */
  buscarProductos(tenantId: string, consulta: string, limite: number): Promise<ProductoVista[]>;
  categoriasPorId(tenantId: string, ids: readonly string[]): Promise<Array<{ id: string; nombre: string }>>;
  listarCategorias(tenantId: string): Promise<Array<{ id: string; nombre: string }>>;
  /** Ruta pública de la tienda detal (`/catalogo/{tienda}`) si está publicada; null si no. Solo para el enlace «Ver mi tienda» del editor. */
  rutaPublica?(tenantId: string): Promise<string | null>;
}

export interface VariablesNegocio {
  variables: ValoresVariables;
  /** Mínimo de la compra inicial mayorista, en pesos (null = no configurado). */
  minimoMayorista: number | null;
}

export interface PuertoVariables {
  valores(tenantId: string): Promise<VariablesNegocio>;
}
