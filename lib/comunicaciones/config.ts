import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfigComunicaciones } from "./tipos";

// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) —
// configuración del módulo, un tenant a la vez. Nunca asume "activo por
// defecto": un negocio que nunca configuró esto se trata como desactivado
// para AMBOS tipos.
export async function obtenerConfigComunicaciones(supabase: SupabaseClient, idTenant: string): Promise<ConfigComunicaciones> {
  const { data } = await supabase
    .from("dulabs_comunicaciones_config")
    .select("id_tenant, confirmacion_activa, confirmacion_mensaje, recordatorio_activo, recordatorio_anticipacion_horas, recordatorio_mensaje")
    .eq("id_tenant", idTenant)
    .maybeSingle();

  if (!data) {
    return {
      idTenant,
      confirmacionActiva: false,
      confirmacionMensaje: "",
      recordatorioActivo: false,
      recordatorioAnticipacionHoras: 24,
      recordatorioMensaje: "",
    };
  }

  return {
    idTenant: data.id_tenant,
    confirmacionActiva: data.confirmacion_activa,
    confirmacionMensaje: data.confirmacion_mensaje,
    recordatorioActivo: data.recordatorio_activo,
    recordatorioAnticipacionHoras: data.recordatorio_anticipacion_horas,
    recordatorioMensaje: data.recordatorio_mensaje,
  };
}

/** Tenants con al menos un tipo de comunicación activo -- lo que recorre el cron diario. */
export async function listarTenantsConComunicacionesActivas(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("dulabs_comunicaciones_config")
    .select("id_tenant")
    .or("confirmacion_activa.eq.true,recordatorio_activo.eq.true");
  if (error) throw error;
  return (data ?? []).map((r) => r.id_tenant as string);
}
