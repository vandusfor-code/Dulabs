// DuLabs Business — Business Agent 2.0, FASE 7 — lectura del catálogo REAL de servicios (dulabs_servicios).
//
// Solo lectura, tenant-scoped (id_tenant = el tenant del turno, nunca del mensaje) y solo servicios activos: la misma
// tabla y el mismo filtro que usan los handlers de agenda para la duración. Acotada: el runtime no carga catálogos
// gigantes (y al modelo solo le llegan los nombres relevantes, ver entities.ts::relevantOfferings).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceTableReader } from "@/lib/agent-compiler/conversation/entities";

export const MAX_CATALOG_SERVICES = 300;

export function createSupabaseServiceTableReader(supabase: SupabaseClient): ServiceTableReader {
  return async (tenantId) => {
    const { data, error } = await supabase
      .from("dulabs_servicios")
      .select("nombre, duracion_min, precio")
      .eq("id_tenant", tenantId)
      .eq("activo", true)
      .order("nombre", { ascending: true })
      .limit(MAX_CATALOG_SERVICES);
    if (error) throw new Error(`catalog_read_failed:${error.code ?? "unknown"}`);
    return ((data ?? []) as Array<{ nombre: string; duracion_min: number | null; precio?: number | null }>)
      .filter((r) => typeof r.nombre === "string" && r.nombre.trim())
      // FASE 8: precio real (null = sin precio fijo) para responder "¿cuánto cuesta?" con datos del negocio.
      .map((r) => ({ name: r.nombre.trim(), ...(typeof r.duracion_min === "number" ? { durationMinutes: r.duracion_min } : {}), ...(typeof r.precio === "number" ? { price: r.precio } : r.precio === null ? { price: null } : {}) }));
  };
}
