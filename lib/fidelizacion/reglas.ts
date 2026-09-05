import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReglaFidelizacion } from "./tipos";

// Fidelización (Fase 7, genérico, autorizado) — 1) reglas de fidelización.
// Separado a propósito de visitas/vencimiento/candidatos/idempotencia/
// mensaje/motor (cada uno en su propio archivo).

function mapear(fila: { id: number; id_tenant: string; servicio_id: string; dias: number; activa: boolean; mensaje: string }): ReglaFidelizacion {
  return { id: fila.id, idTenant: fila.id_tenant, servicioId: fila.servicio_id, dias: fila.dias, activa: fila.activa, mensaje: fila.mensaje };
}

/** Reglas activas de UN tenant -- lo que recorre el motor diario. SIEMPRE filtrado por id_tenant. */
export async function obtenerReglasActivas(supabase: SupabaseClient, idTenant: string): Promise<ReglaFidelizacion[]> {
  const { data, error } = await supabase
    .from("dulabs_fidelizacion_reglas")
    .select("id, id_tenant, servicio_id, dias, activa, mensaje")
    .eq("id_tenant", idTenant)
    .eq("activa", true);
  if (error) throw error;
  return (data ?? []).map(mapear);
}

/** Tenants con al menos una regla activa -- lo que recorre el cron diario. */
export async function listarTenantsConReglasActivas(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("dulabs_fidelizacion_reglas").select("id_tenant").eq("activa", true);
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r) => r.id_tenant as string)));
}

/** TODAS las reglas de un tenant (activas e inactivas) -- para el panel administrativo. */
export async function obtenerTodasLasReglas(supabase: SupabaseClient, idTenant: string): Promise<ReglaFidelizacion[]> {
  const { data, error } = await supabase
    .from("dulabs_fidelizacion_reglas")
    .select("id, id_tenant, servicio_id, dias, activa, mensaje")
    .eq("id_tenant", idTenant)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapear);
}
