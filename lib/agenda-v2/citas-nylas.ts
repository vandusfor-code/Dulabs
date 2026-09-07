/**
 * AGENDA V2 (autorizado) — FASE 8: mapeo mínimo cita_id -> evento real de
 * Nylas (dulabs_agenda_v2_citas_nylas, ver migración
 * 20260918000000_agenda_v2_gestion_citas.sql). dulabs_citas_especialista
 * nunca guardó este dato -- crearCitaConNylas devolvía el id del evento solo
 * en memoria -- así que sin esta tabla no hay forma real de encontrar qué
 * evento de calendario corresponde a una cita ya creada, para poder
 * cancelarlo/reprogramarlo de verdad.
 *
 * Deliberadamente "best-effort" para escribir/leer: guardar o leer este
 * mapeo NUNCA debe tumbar el flujo que lo dispara (la cita/reserva real en
 * DuLabs ya se resolvió aparte) -- mismo criterio que recordarNombreCliente
 * (lib/clientes-conocidos.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const TABLA = "dulabs_agenda_v2_citas_nylas";

/** Guarda (o reemplaza) el evento de Nylas real asociado a esta cita. Nunca lanza. */
export async function guardarNylasEventIdDeCita(supabase: SupabaseClient, citaId: number, nylasEventId: string): Promise<void> {
  try {
    await supabase.from(TABLA).upsert(
      { cita_id: citaId, nylas_event_id: nylasEventId, updated_at: new Date().toISOString() },
      { onConflict: "cita_id" },
    );
  } catch (err) {
    console.error(`[agenda-v2] no se pudo guardar el mapeo cita->evento Nylas (cita ${citaId}) -- no bloquea la reserva ya creada:`, err instanceof Error ? err.message : "error desconocido");
  }
}

/** Lee el evento de Nylas real asociado a esta cita, si existe. Nunca lanza -- ausencia de mapeo se trata igual que "no hay evento que tocar". */
export async function obtenerNylasEventIdDeCita(supabase: SupabaseClient, citaId: number): Promise<string | null> {
  try {
    const { data } = await supabase.from(TABLA).select("nylas_event_id").eq("cita_id", citaId).maybeSingle();
    return (data as { nylas_event_id: string } | null)?.nylas_event_id ?? null;
  } catch (err) {
    console.error(`[agenda-v2] no se pudo leer el mapeo cita->evento Nylas (cita ${citaId}):`, err instanceof Error ? err.message : "error desconocido");
    return null;
  }
}

/** Borra el mapeo cuando la cita se cancela (best-effort, nunca lanza) -- evita reutilizar un event_id de un evento que ya no existe. */
export async function borrarNylasEventIdDeCita(supabase: SupabaseClient, citaId: number): Promise<void> {
  try {
    await supabase.from(TABLA).delete().eq("cita_id", citaId);
  } catch (err) {
    console.error(`[agenda-v2] no se pudo borrar el mapeo cita->evento Nylas (cita ${citaId}):`, err instanceof Error ? err.message : "error desconocido");
  }
}
