import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnticipacionRecordatorioMinutos, ConfigComunicaciones } from "./tipos";
import { ANTICIPACIONES_RECORDATORIO_MINUTOS } from "./tipos";

// Ajuste final (autorizado) -- mensajes predeterminados reales, EXACTOS al
// pedido: se muestran automáticamente en el campo cuando el tenant nunca
// guardó una personalización (nunca campos vacíos). El usuario puede
// editarlos después -- estos valores solo llenan el "hueco" mientras no
// exista una fila propia en dulabs_comunicaciones_config.
export const MENSAJE_CONFIRMACION_PREDETERMINADO =
  "Hola, {{nombre}}. 💗\n\nTu cita en AMORE ha sido confirmada.\n\nServicio: {{servicio}}\nProfesional: {{profesional}}\nFecha: {{fecha}}\nHora: {{hora}}\n\nTe esperamos. ✨";
export const MENSAJE_RECORDATORIO_PREDETERMINADO =
  "Hola, {{nombre}}. 💗\n\nTe recordamos que tienes una cita en AMORE.\n\nServicio: {{servicio}}\nProfesional: {{profesional}}\nFecha: {{fecha}}\nHora: {{hora}}\n\n¡Te esperamos! ✨";

// Ajuste final (autorizado) -- la anticipación real y estable del cron que
// SÍ envía de verdad (app/api/cron/recordatorios-citas, ventana de 55-65
// min) es "1 hora antes" -- este valor predeterminado deja de mentir con
// "24" (un número que nunca tuvo efecto real, la interfaz de Recordatorios
// ahora lo muestra como dato fijo, ver app/admin/amore/recordatorios/page.tsx).
export const RECORDATORIO_ANTICIPACION_HORAS_REAL = 1;

/** Mejora Recordatorios (autorizado) -- ahora SÍ editable y SÍ usada por el motor real (ver app/api/cron/recordatorios-citas/route.ts). 60 min = "1 hora antes", mismo comportamiento de siempre cuando no hay configuración guardada. */
export const RECORDATORIO_ANTICIPACION_MINUTOS_PREDETERMINADA: AnticipacionRecordatorioMinutos = 60;

function anticipacionMinutosValida(valor: unknown): valor is AnticipacionRecordatorioMinutos {
  return ANTICIPACIONES_RECORDATORIO_MINUTOS.includes(valor as AnticipacionRecordatorioMinutos);
}

// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) —
// configuración del módulo, un tenant a la vez. Nunca asume "activo por
// defecto": un negocio que nunca configuró esto se trata como desactivado
// para AMBOS tipos -- los mensajes predeterminados solo rellenan el campo
// para que el usuario los vea y pueda editarlos, nunca activan el envío
// por sí solos.
export async function obtenerConfigComunicaciones(supabase: SupabaseClient, idTenant: string): Promise<ConfigComunicaciones> {
  const { data } = await supabase
    .from("dulabs_comunicaciones_config")
    .select(
      "id_tenant, confirmacion_activa, confirmacion_mensaje, recordatorio_activo, recordatorio_anticipacion_horas, recordatorio_anticipacion_minutos, recordatorio_mensaje"
    )
    .eq("id_tenant", idTenant)
    .maybeSingle();

  if (!data) {
    return {
      idTenant,
      confirmacionActiva: false,
      confirmacionMensaje: MENSAJE_CONFIRMACION_PREDETERMINADO,
      recordatorioActivo: false,
      recordatorioAnticipacionHoras: RECORDATORIO_ANTICIPACION_HORAS_REAL,
      recordatorioAnticipacionMinutos: RECORDATORIO_ANTICIPACION_MINUTOS_PREDETERMINADA,
      recordatorioMensaje: MENSAJE_RECORDATORIO_PREDETERMINADO,
      tieneConfiguracionGuardada: false,
    };
  }

  return {
    idTenant: data.id_tenant,
    confirmacionActiva: data.confirmacion_activa,
    // Fila ya existente pero con el mensaje todavía vacío (ej. el tenant
    // solo activó/editó el recordatorio, nunca tocó la confirmación) -- se
    // trata igual que "sin personalización guardada", nunca se muestra un
    // campo vacío.
    confirmacionMensaje: data.confirmacion_mensaje || MENSAJE_CONFIRMACION_PREDETERMINADO,
    recordatorioActivo: data.recordatorio_activo,
    recordatorioAnticipacionHoras: data.recordatorio_anticipacion_horas,
    // Defensivo: si por algún motivo llega un valor fuera de las 9 opciones
    // reales (ej. dato viejo/corrupto), nunca se lo pasa tal cual al motor
    // -- cae al predeterminado real (60 min = "1 hora antes").
    recordatorioAnticipacionMinutos: anticipacionMinutosValida(data.recordatorio_anticipacion_minutos)
      ? data.recordatorio_anticipacion_minutos
      : RECORDATORIO_ANTICIPACION_MINUTOS_PREDETERMINADA,
    recordatorioMensaje: data.recordatorio_mensaje || MENSAJE_RECORDATORIO_PREDETERMINADO,
    tieneConfiguracionGuardada: true,
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
