/**
 * AGENDA V2 (autorizado) — acceso a la ÚNICA fuente de verdad del estado de
 * una reserva guiada: dulabs_agenda_v2_sesiones (ver la migración
 * correspondiente). Deliberadamente sin ninguna dependencia de Flow Engine
 * -- ni tipos, ni tablas, ni ejecuciones.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type PasoAgendaV2 =
  | "S1_SERVICIO"
  | "S2_PROFESIONAL"
  | "S3_DIA"
  | "S4_HORA"
  | "S5_CONFIRMAR"
  // FASE 8 -- gestión de citas existentes. S3_DIA/S4_HORA/S5_CONFIRMAR se
  // REUTILIZAN tal cual para la porción "elegir nueva fecha/hora" de una
  // reprogramación (ver cita_objetivo_id) -- nunca se duplican esos steps.
  | "SG_SELECCIONAR_CITA"
  | "SG_CANCELAR_CONFIRMAR"
  | "SG_REPROGRAMAR_CONFIRMAR_INICIO";

/** FASE 8 -- qué gestión se pidió, mientras se resuelve cuál cita (SG_SELECCIONAR_CITA). */
export type AccionGestionAgendaV2 = "consultar" | "cancelar" | "reprogramar";

export interface SesionAgendaV2 {
  id: number;
  tenantId: string;
  telefonoCliente: string;
  activo: boolean;
  step: PasoAgendaV2;
  servicioId: string | null;
  profesionalId: number | null;
  fechaIso: string | null;
  slotSeleccionado: unknown | null;
  opcionesMostradas: unknown | null;
  ultimoWamidProcesado: string | null;
  /** FASE 8 -- la cita real (dulabs_citas_especialista) sobre la que se está consultando/cancelando/reprogramando. Nunca viene de un dato enviado por el cliente. */
  citaObjetivoId: number | null;
  /** FASE 8 -- qué gestión se pidió, mientras se espera que el cliente elija cuál de sus varias citas (SG_SELECCIONAR_CITA). */
  accionGestion: AccionGestionAgendaV2 | null;
  createdAt: string;
  updatedAt: string;
}

interface FilaDb {
  id: number;
  tenant_id: string;
  telefono_cliente: string;
  activo: boolean;
  step: PasoAgendaV2;
  servicio_id: string | null;
  profesional_id: number | null;
  fecha_iso: string | null;
  slot_seleccionado: unknown | null;
  opciones_mostradas: unknown | null;
  ultimo_wamid_procesado: string | null;
  cita_objetivo_id: number | null;
  accion_gestion: AccionGestionAgendaV2 | null;
  created_at: string;
  updated_at: string;
}

const TABLA = "dulabs_agenda_v2_sesiones";

function mapearFila(fila: FilaDb): SesionAgendaV2 {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    telefonoCliente: fila.telefono_cliente,
    activo: fila.activo,
    step: fila.step,
    servicioId: fila.servicio_id,
    profesionalId: fila.profesional_id,
    fechaIso: fila.fecha_iso,
    slotSeleccionado: fila.slot_seleccionado,
    opcionesMostradas: fila.opciones_mostradas,
    ultimoWamidProcesado: fila.ultimo_wamid_procesado,
    citaObjetivoId: fila.cita_objetivo_id,
    accionGestion: fila.accion_gestion,
    createdAt: fila.created_at,
    updatedAt: fila.updated_at,
  };
}

/**
 * Nunca busca por teléfono solo (sección 8 del pedido) -- siempre
 * (tenant_id, telefono_cliente) juntos, para que una sesión de un tenant
 * jamás pueda resolverse para otro tenant con el mismo número real.
 */
export async function buscarSesionActivaAgendaV2(
  supabase: SupabaseClient,
  tenantId: string,
  telefonoCliente: string,
): Promise<SesionAgendaV2 | null> {
  const { data, error } = await supabase
    .from(TABLA)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("telefono_cliente", telefonoCliente)
    .eq("activo", true)
    .maybeSingle();
  if (error) throw error;
  return data ? mapearFila(data as FilaDb) : null;
}

/**
 * Crea una sesión nueva en el paso inicial. El índice único parcial
 * (tenant_id, telefono_cliente) WHERE activo (ver migración) es la garantía
 * real de "una sola sesión activa" -- nunca una comprobación de aplicación
 * que pueda perder una carrera.
 */
export async function crearSesionAgendaV2(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    telefonoCliente: string;
    wamid: string;
    opcionesMostradas?: unknown;
    // FASE 8 -- una sesión de gestión de citas nace directamente en un step
    // SG_* (nunca en S1_SERVICIO, que es exclusivo de "agendar una cita
    // nueva"), con la cita real y/o la acción pedida ya resueltas.
    step?: PasoAgendaV2;
    citaObjetivoId?: number | null;
    accionGestion?: AccionGestionAgendaV2 | null;
    servicioId?: string | null;
    profesionalId?: number | null;
    fechaIso?: string | null;
  },
): Promise<SesionAgendaV2> {
  const { data, error } = await supabase
    .from(TABLA)
    .insert({
      tenant_id: params.tenantId,
      telefono_cliente: params.telefonoCliente,
      activo: true,
      step: params.step ?? "S1_SERVICIO",
      ultimo_wamid_procesado: params.wamid,
      opciones_mostradas: params.opcionesMostradas ?? null,
      cita_objetivo_id: params.citaObjetivoId ?? null,
      accion_gestion: params.accionGestion ?? null,
      servicio_id: params.servicioId ?? null,
      profesional_id: params.profesionalId ?? null,
      fecha_iso: params.fechaIso ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapearFila(data as FilaDb);
}

/** Solo campos que de verdad puede tocar el controlador -- nunca tenant_id/telefono_cliente/id (identidad de la sesión, inmutable). */
export interface CambiosSesionAgendaV2 {
  step?: PasoAgendaV2;
  servicioId?: string | null;
  profesionalId?: number | null;
  fechaIso?: string | null;
  slotSeleccionado?: unknown;
  opcionesMostradas?: unknown;
  ultimoWamidProcesado?: string;
  citaObjetivoId?: number | null;
  accionGestion?: AccionGestionAgendaV2 | null;
}

export async function actualizarSesionAgendaV2(
  supabase: SupabaseClient,
  sesionId: number,
  cambios: CambiosSesionAgendaV2,
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (cambios.step !== undefined) payload.step = cambios.step;
  if (cambios.servicioId !== undefined) payload.servicio_id = cambios.servicioId;
  if (cambios.profesionalId !== undefined) payload.profesional_id = cambios.profesionalId;
  if (cambios.fechaIso !== undefined) payload.fecha_iso = cambios.fechaIso;
  if (cambios.slotSeleccionado !== undefined) payload.slot_seleccionado = cambios.slotSeleccionado;
  if (cambios.opcionesMostradas !== undefined) payload.opciones_mostradas = cambios.opcionesMostradas;
  if (cambios.ultimoWamidProcesado !== undefined) payload.ultimo_wamid_procesado = cambios.ultimoWamidProcesado;
  if (cambios.citaObjetivoId !== undefined) payload.cita_objetivo_id = cambios.citaObjetivoId;
  if (cambios.accionGestion !== undefined) payload.accion_gestion = cambios.accionGestion;

  const { error } = await supabase.from(TABLA).update(payload).eq("id", sesionId);
  if (error) throw error;
}

/** Cierra la sesión (cancelar/completar) -- nunca la borra, para no dejar historial huérfano ni perder auditoría real. */
export async function cerrarSesionAgendaV2(supabase: SupabaseClient, sesionId: number): Promise<void> {
  const { error } = await supabase.from(TABLA).update({ activo: false, updated_at: new Date().toISOString() }).eq("id", sesionId);
  if (error) throw error;
}
