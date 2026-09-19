// DuLabs Business — Agent Compiler (Fase 1), Pilar 1 (Step 3).
//
// Adapter de producción del puerto CatalogRepository sobre las tablas y
// abstracciones EXISTENTES de DuLabs Business:
//  - productos -> lib/amore-inventario (crearProducto/actualizarProducto),
//    que ya aplican id_tenant y validaciones.
//  - servicios -> insert/update directo a dulabs_servicios con las MISMAS
//    columnas y filtro id_tenant que la ruta app/api/agenda/[token]/servicios.
// No crea tablas ni modifica el schema. El `supabase` (y por tanto el alcance
// tenant) lo aporta el caller autenticado.

import type { SupabaseClient } from "@supabase/supabase-js";
import { crearProducto, actualizarProducto } from "@/lib/amore-inventario";
import type { CatalogRepository, ExistingCatalogEntry } from "@/lib/agent-compiler/catalog-repository";

export function createSupabaseCatalogRepository(supabase: SupabaseClient): CatalogRepository {
  return {
    async listExisting(tenantId: string): Promise<ExistingCatalogEntry[]> {
      const [serv, prod] = await Promise.all([
        supabase.from("dulabs_servicios").select("id, nombre, precio").eq("id_tenant", tenantId),
        supabase.from("dulabs_inventario_productos").select("id, nombre, precio").eq("id_tenant", tenantId),
      ]);
      if (serv.error) throw serv.error;
      if (prod.error) throw prod.error;
      const entries: ExistingCatalogEntry[] = [];
      for (const s of (serv.data ?? []) as { id: string; nombre: string; precio: number | null }[]) {
        entries.push({ id: s.id, type: "service", name: s.nombre, priceCop: s.precio ?? null });
      }
      for (const p of (prod.data ?? []) as { id: string; nombre: string; precio: number | null }[]) {
        entries.push({ id: p.id, type: "product", name: p.nombre, priceCop: p.precio ?? null });
      }
      return entries;
    },

    async insert(tenantId, item) {
      if (item.type === "product") {
        const producto = await crearProducto(supabase, tenantId, {
          nombre: item.name,
          descripcion: item.description ?? null,
          precio: item.priceCop ?? 0,
          stock: item.stock ?? 0,
          categoria: item.category ?? null,
          activo: true,
        });
        return { id: producto.id };
      }
      const { data, error } = await supabase
        .from("dulabs_servicios")
        .insert({
          id_tenant: tenantId,
          nombre: item.name,
          categoria: item.category ?? null,
          descripcion: item.description ?? null,
          duracion_min: item.durationMin ?? 60,
          precio: item.priceCop,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("No se pudo crear el servicio");
      return { id: (data as { id: string }).id };
    },

    async updatePrice(tenantId, ref, priceCop) {
      if (ref.type === "product") {
        await actualizarProducto(supabase, tenantId, ref.id, { precio: priceCop ?? 0 });
        return;
      }
      const { error } = await supabase
        .from("dulabs_servicios")
        .update({ precio: priceCop, updated_at: new Date().toISOString() })
        .eq("id_tenant", tenantId)
        .eq("id", ref.id);
      if (error) throw error;
    },
  };
}
