import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfigCumpleanos } from "./tipos";

// Cumpleaños automáticos (Fase 6A, genérico, autorizado) — 2) configuración
// del módulo, un tenant a la vez. Nunca asume "activo por defecto": un
// negocio que nunca configuró el módulo se trata como desactivado.
export async function obtenerConfigCumpleanos(supabase: SupabaseClient, idTenant: string): Promise<ConfigCumpleanos> {
  const { data } = await supabase
    .from("dulabs_cumpleanos_config")
    .select("id_tenant, activo, mensaje, nombre_negocio, hora_envio, zona_horaria")
    .eq("id_tenant", idTenant)
    .maybeSingle();

  if (!data) {
    return { idTenant, activo: false, mensaje: "", nombreNegocio: null, horaEnvio: "09:00", zonaHoraria: "America/Bogota" };
  }

  return {
    idTenant: data.id_tenant,
    activo: data.activo,
    mensaje: data.mensaje,
    nombreNegocio: data.nombre_negocio,
    horaEnvio: data.hora_envio,
    zonaHoraria: data.zona_horaria,
  };
}

/** Tenants con el módulo activo -- lo que recorre el cron diario (uno por uno, cada cual con su propia zona horaria). */
export async function listarTenantsConCumpleanosActivo(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("dulabs_cumpleanos_config").select("id_tenant").eq("activo", true);
  if (error) throw error;
  return (data ?? []).map((r) => r.id_tenant as string);
}
