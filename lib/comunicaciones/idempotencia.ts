import type { SupabaseClient } from "@supabase/supabase-js";
import type { TipoComunicacion } from "./tipos";

// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) — control
// de idempotencia. Mismo patrón ya probado en dulabs_cumpleanos_procesados
// (Fase 6A) y dulabs_fidelizacion_oportunidades (Fase 7): la garantía la da
// la restricción UNIQUE de Postgres (id_tenant, cita_id, tipo), nunca un
// SELECT-then-INSERT de aplicación -- eso sí tendría una carrera real entre
// dos ejecuciones concurrentes del motor.

export type ResultadoClaimComunicacion = { estado: "reclamada" } | { estado: "ya_procesada" };

export async function reclamarComunicacion(
  supabase: SupabaseClient,
  params: { idTenant: string; citaId: number; tipo: TipoComunicacion; telefonoCliente: string; mensajeRenderizado: string }
): Promise<ResultadoClaimComunicacion> {
  const { error } = await supabase.from("dulabs_comunicaciones_procesadas").insert({
    id_tenant: params.idTenant,
    cita_id: params.citaId,
    tipo: params.tipo,
    telefono_cliente: params.telefonoCliente,
    mensaje_renderizado: params.mensajeRenderizado,
  });
  if (!error) return { estado: "reclamada" };
  if (error.code === "23505") return { estado: "ya_procesada" };
  throw error;
}
