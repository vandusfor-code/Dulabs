/**
 * PILOTO AMORE + Nylas (autorizado) — relación PERSISTENTE especialista ->
 * calendar_id de Nylas. Reutiliza la tabla ya existente `dulabs_especialistas`
 * (columna nueva `nylas_calendar_id`, ver migración propuesta) en vez de
 * crear una tabla paralela -- ver auditoría de la FASE B1: no existía
 * ninguna columna/tabla adecuada para esto todavía.
 *
 * NUNCA se hardcodea un calendar_id dentro de una función de negocio: todo
 * consumidor (disponibilidad, y más adelante creación de citas) recibe este
 * resolver inyectado, nunca un valor fijo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolverCalendarIdNylasDeEspecialista(
  supabase: SupabaseClient,
  idTenant: string,
  especialistaId: number,
): Promise<string | null> {
  const { data } = await supabase
    .from("dulabs_especialistas")
    .select("nylas_calendar_id")
    .eq("id_tenant", idTenant)
    .eq("id", especialistaId)
    .maybeSingle();
  return (data?.nylas_calendar_id as string | null | undefined) ?? null;
}
