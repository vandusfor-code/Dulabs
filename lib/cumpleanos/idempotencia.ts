import type { SupabaseClient } from "@supabase/supabase-js";

// Cumpleaños automáticos (Fase 6A, genérico, autorizado) — 4) control de
// idempotencia. Mismo patrón ya probado en dulabs_idempotencia_reservas
// (lib/idempotencia-reserva.ts, Fase 4 de reservas): la garantía la da la
// restricción UNIQUE de Postgres (dulabs_cumpleanos_procesados_unico sobre
// id_tenant+cliente_id+anio), nunca un SELECT-then-INSERT de aplicación --
// eso sí tendría una carrera real entre dos ejecuciones concurrentes del
// cron. No se reutilizó ejecutarConIdempotencia tal cual porque esa función
// está atada a la tabla/forma de dulabs_idempotencia_reservas (huella +
// resultado_json de una reserva); acá la clave natural es distinta
// (cliente+año, no una idempotency_key libre) así que tiene su propia tabla,
// siguiendo el MISMO patrón en vez de forzar una abstracción genérica a
// medias.

export type EstadoProcesado = "registrado" | "enviado" | "simulado" | "fallido";
export type ResultadoClaim = { estado: "reclamado" } | { estado: "ya_procesado" };

/**
 * "Claim" atómico: intenta insertar la fila (id_tenant, cliente_id, anio).
 * Si otra ejecución (o una concurrente) ya la insertó, Postgres responde
 * 23505 -- esa es la señal real de "ya procesado", no un estado que
 * calculemos nosotros antes de intentar.
 */
export async function reclamarProcesamiento(
  supabase: SupabaseClient,
  params: { idTenant: string; clienteId: number; anio: number; telefonoCliente: string }
): Promise<ResultadoClaim> {
  const { error } = await supabase.from("dulabs_cumpleanos_procesados").insert({
    id_tenant: params.idTenant,
    cliente_id: params.clienteId,
    anio: params.anio,
    telefono_cliente: params.telefonoCliente,
  });
  if (!error) return { estado: "reclamado" };
  if (error.code === "23505") return { estado: "ya_procesado" };
  throw error;
}

/** Completa la fila ya reclamada con el resultado real del envío (o de la simulación de prueba). */
export async function registrarResultadoProcesamiento(
  supabase: SupabaseClient,
  params: { idTenant: string; clienteId: number; anio: number; estado: EstadoProcesado; mensajeEnviado?: string; detalle?: string }
): Promise<void> {
  await supabase
    .from("dulabs_cumpleanos_procesados")
    .update({ estado: params.estado, mensaje_enviado: params.mensajeEnviado ?? null, detalle: params.detalle ?? null })
    .eq("id_tenant", params.idTenant)
    .eq("cliente_id", params.clienteId)
    .eq("anio", params.anio);
}
