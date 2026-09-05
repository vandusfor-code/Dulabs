import type { SupabaseClient } from "@supabase/supabase-js";

// Fidelización (Fase 7, genérico, autorizado) — 5) control de idempotencia.
// Mismo patrón ya probado en dulabs_cumpleanos_procesados (Fase 6A): la
// garantía la da la restricción UNIQUE de Postgres
// (dulabs_fidelizacion_oportunidades_unico sobre id_tenant+regla_id+cita_id),
// nunca un SELECT-then-INSERT de aplicación -- eso sí tendría una carrera
// real entre dos ejecuciones concurrentes del motor.

export type ResultadoClaimOportunidad = { estado: "creada"; id: number } | { estado: "ya_existia" };

/**
 * "Claim" atómico: intenta insertar la oportunidad completa de una vez
 * (a diferencia de cumpleaños, acá no hay un paso posterior que "complete"
 * la fila -- no hay envío real todavía, así que la fila ya nace con todo
 * su contenido). Si otra ejecución (o una concurrente) ya la insertó,
 * Postgres responde 23505 y se sabe que ya existía, sin duplicar nada.
 */
export async function reclamarOportunidad(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    reglaId: number;
    citaId: number;
    clienteId: number;
    telefonoCliente: string;
    fechaVisita: string;
    diasRegla: number;
    mensajeRenderizado: string;
  }
): Promise<ResultadoClaimOportunidad> {
  const { data, error } = await supabase
    .from("dulabs_fidelizacion_oportunidades")
    .insert({
      id_tenant: params.idTenant,
      regla_id: params.reglaId,
      cita_id: params.citaId,
      cliente_id: params.clienteId,
      telefono_cliente: params.telefonoCliente,
      fecha_visita: params.fechaVisita,
      dias_regla: params.diasRegla,
      mensaje_renderizado: params.mensajeRenderizado,
    })
    .select("id")
    .single();

  if (!error) return { estado: "creada", id: data!.id as number };
  if (error.code === "23505") return { estado: "ya_existia" };
  throw error;
}
