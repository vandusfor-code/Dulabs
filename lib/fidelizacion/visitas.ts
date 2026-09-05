import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisitaCompletada } from "./tipos";

// Fidelización (Fase 7, genérico, autorizado) — 2) búsqueda de visitas
// elegibles. SOLO citas con estado 'completada' cuentan como visita válida
// -- 'cancelada'/'rechazada'/'no_show'/etc. nunca generan una oportunidad de
// fidelización, sin importar cuánto tiempo haya pasado.
export async function buscarVisitasCompletadas(supabase: SupabaseClient, idTenant: string, servicioId: string): Promise<VisitaCompletada[]> {
  const { data, error } = await supabase
    .from("dulabs_citas_especialista")
    .select("id, id_tenant, servicio_id, servicio, phone_number_id, telefono_cliente, nombre_cliente, inicio")
    .eq("id_tenant", idTenant)
    .eq("servicio_id", servicioId)
    .eq("estado", "completada");
  if (error) throw error;

  type Fila = {
    id: number;
    id_tenant: string;
    servicio_id: string;
    servicio: string;
    phone_number_id: string;
    telefono_cliente: string | null;
    nombre_cliente: string;
    inicio: string;
  };

  return ((data ?? []) as Fila[])
    .filter((c) => Boolean(c.telefono_cliente?.trim()))
    .map((c) => ({
      citaId: c.id,
      idTenant: c.id_tenant,
      servicioId: c.servicio_id,
      servicioNombre: c.servicio,
      phoneNumberId: c.phone_number_id,
      telefonoCliente: (c.telefono_cliente as string).trim(),
      nombreCliente: c.nombre_cliente,
      inicio: c.inicio,
    }));
}
