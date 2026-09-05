import type { SupabaseClient } from "@supabase/supabase-js";
import { debeConfirmarse, debeRecordarse } from "./vencimiento";
import type { CitaComunicable } from "./tipos";

// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) — búsqueda
// de citas comunicables. SOLO estado 'confirmada' cuenta -- pendiente,
// propuesta, rechazada, cancelada, completada y no_show nunca generan una
// confirmación ni un recordatorio, sin importar el tiempo transcurrido.
// SIEMPRE filtrado por id_tenant -- un negocio nunca ve citas de otro.
async function buscarCitasConfirmadas(supabase: SupabaseClient, idTenant: string): Promise<CitaComunicable[]> {
  const { data, error } = await supabase
    .from("dulabs_citas_especialista")
    .select("id, id_tenant, especialista_id, telefono_cliente, nombre_cliente, servicio, inicio, fin")
    .eq("id_tenant", idTenant)
    .eq("estado", "confirmada");
  if (error) throw error;

  type Fila = {
    id: number;
    id_tenant: string;
    especialista_id: number;
    telefono_cliente: string | null;
    nombre_cliente: string;
    servicio: string;
    inicio: string;
    fin: string;
  };
  const filas = ((data ?? []) as Fila[]).filter((c) => Boolean(c.telefono_cliente?.trim()));
  if (filas.length === 0) return [];

  const especialistaIds = Array.from(new Set(filas.map((f) => f.especialista_id)));
  const { data: especialistas } = await supabase
    .from("dulabs_especialistas")
    .select("id, nombre")
    .eq("id_tenant", idTenant)
    .in("id", especialistaIds);
  const nombrePorEspecialista = new Map<number, string>();
  for (const e of (especialistas ?? []) as { id: number; nombre: string }[]) nombrePorEspecialista.set(e.id, e.nombre);

  return filas.map((c) => ({
    citaId: c.id,
    idTenant: c.id_tenant,
    telefonoCliente: (c.telefono_cliente as string).trim(),
    nombreCliente: c.nombre_cliente,
    servicio: c.servicio,
    profesionalNombre: nombrePorEspecialista.get(c.especialista_id) ?? "—",
    inicio: c.inicio,
    fin: c.fin,
  }));
}

/** Citas confirmadas cuya confirmación todavía puede enviarse (la cita no ha ocurrido). */
export async function buscarCandidatosConfirmacion(supabase: SupabaseClient, idTenant: string, ahora: Date): Promise<CitaComunicable[]> {
  const citas = await buscarCitasConfirmadas(supabase, idTenant);
  return citas.filter((c) => debeConfirmarse(new Date(c.inicio), ahora));
}

/** Citas confirmadas dentro de la ventana de anticipación configurada, todavía futuras. */
export async function buscarCandidatosRecordatorio(
  supabase: SupabaseClient,
  idTenant: string,
  anticipacionHoras: number,
  ahora: Date
): Promise<CitaComunicable[]> {
  const citas = await buscarCitasConfirmadas(supabase, idTenant);
  return citas.filter((c) => debeRecordarse(new Date(c.inicio), anticipacionHoras, ahora));
}
