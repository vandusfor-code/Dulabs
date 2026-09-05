import type { SupabaseClient } from "@supabase/supabase-js";
import type { FilaCitaCompletada, RangoFechas } from "./tipos";

type FilaCruda = {
  id: number;
  inicio: string;
  nombre_cliente: string;
  servicio: string;
  servicio_id: string | null;
  especialista_id: number;
  estado: string;
  dulabs_servicios: { nombre: string; precio: number | null } | null;
  dulabs_especialistas: { nombre: string } | null;
};

// Contabilidad (Fase 10, genérico, autorizado) — ÚNICA consulta real del
// módulo: cada cita 'completada' del tenant en el rango, con su servicio y
// especialista embebidos vía las FK ya existentes (mismo patrón de
// embedding que app/api/agenda/[token]/fidelizacion/reglas/route.ts). No
// duplica ninguna tabla -- lee directamente de dulabs_citas_especialista +
// dulabs_servicios + dulabs_especialistas.
export async function buscarCitasCompletadas(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    rango: RangoFechas;
    especialistaId?: number;
    servicioId?: string;
  }
): Promise<FilaCitaCompletada[]> {
  let consulta = supabase
    .from("dulabs_citas_especialista")
    .select(
      "id, inicio, nombre_cliente, servicio, servicio_id, especialista_id, estado, dulabs_servicios(nombre, precio), dulabs_especialistas(nombre)"
    )
    .eq("id_tenant", params.idTenant)
    .eq("estado", "completada")
    .gte("inicio", params.rango.desde.toISOString())
    .lt("inicio", params.rango.hasta.toISOString())
    .order("inicio", { ascending: false });

  if (params.especialistaId !== undefined) consulta = consulta.eq("especialista_id", params.especialistaId);
  if (params.servicioId !== undefined) consulta = consulta.eq("servicio_id", params.servicioId);

  const { data, error } = await consulta;
  if (error) throw error;

  return ((data ?? []) as unknown as FilaCruda[]).map((fila) => ({
    id: fila.id,
    inicio: fila.inicio,
    nombreCliente: fila.nombre_cliente,
    servicioTexto: fila.servicio,
    servicioId: fila.servicio_id,
    servicioNombre: fila.dulabs_servicios?.nombre ?? null,
    precio: fila.dulabs_servicios?.precio ?? null,
    especialistaId: fila.especialista_id,
    profesionalNombre: fila.dulabs_especialistas?.nombre ?? "(especialista eliminado)",
    estado: fila.estado,
  }));
}
