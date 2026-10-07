/**
 * CMS comercial — PUERTOS hacia lo que el CMS NO es dueño: el catálogo (productos y categorías) y la configuración del negocio (variables).
 * El CMS referencia productos por `referencia` y nunca los duplica; las implementaciones reales viven en adaptadores (catalogo-supabase.ts, variables-supabase.ts).
 */
import type { ProductoValidacion } from "@/lib/cms-comercial/validacion";
import type { ValoresVariables } from "@/lib/cms-comercial/variables";

export interface PuertoCatalogo {
  /** Los productos del negocio que existan con esas referencias (las que no existan simplemente no vienen). */
  productosPorReferencia(tenantId: string, referencias: readonly string[]): Promise<ProductoValidacion[]>;
  categoriasPorId(tenantId: string, ids: readonly string[]): Promise<Array<{ id: string; nombre: string }>>;
}

export interface VariablesNegocio {
  variables: ValoresVariables;
  /** Mínimo de la compra inicial mayorista, en pesos (null = no configurado). */
  minimoMayorista: number | null;
}

export interface PuertoVariables {
  valores(tenantId: string): Promise<VariablesNegocio>;
}
