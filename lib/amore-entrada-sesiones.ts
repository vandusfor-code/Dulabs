/**
 * AMORE (autorizado, Fase 9 + Fase 1 atención humana) — acceso a la única
 * fuente de verdad del modo conversacional del puente
 * bienvenida/Gemini/Agenda V2/atención humana: dulabs_amore_entrada (ver
 * migraciones 20260919000000_amore_entrada_conversacional.sql y
 * 20260920000000_amore_atencion_humana.sql). Mismo patrón exacto que
 * lib/agenda-v2/sesiones.ts -- deliberadamente sin ninguna dependencia de
 * Flow Engine ni de Agenda V2.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ModoEntradaAmore = "inicio" | "gemini" | "atencion_humana" | "registro_nombre" | "registro_dia" | "registro_mes";

export interface EntradaAmore {
  id: number;
  tenantId: string;
  telefonoCliente: string;
  modo: ModoEntradaAmore;
  ultimoWamidProcesado: string | null;
  /** Fase 1 (atención humana) -- true en cuanto ya se notificó realmente a Jessica para esta conversación. */
  notificadoAJessica: boolean;
}

interface FilaDb {
  id: number;
  tenant_id: string;
  telefono_cliente: string;
  modo: ModoEntradaAmore;
  ultimo_wamid_procesado: string | null;
  notificado_a_jessica: boolean;
}

const TABLA = "dulabs_amore_entrada";
const COLUMNAS = "id, tenant_id, telefono_cliente, modo, ultimo_wamid_procesado, notificado_a_jessica";

function mapearFila(fila: FilaDb): EntradaAmore {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    telefonoCliente: fila.telefono_cliente,
    modo: fila.modo,
    ultimoWamidProcesado: fila.ultimo_wamid_procesado,
    notificadoAJessica: fila.notificado_a_jessica,
  };
}

export async function buscarEntradaAmore(supabase: SupabaseClient, tenantId: string, telefonoCliente: string): Promise<EntradaAmore | null> {
  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq("tenant_id", tenantId)
    .eq("telefono_cliente", telefonoCliente)
    .maybeSingle();
  if (error) throw error;
  return data ? mapearFila(data as FilaDb) : null;
}

export async function crearEntradaAmore(
  supabase: SupabaseClient,
  params: { tenantId: string; telefonoCliente: string; wamid: string; modo: ModoEntradaAmore; notificadoAJessica?: boolean },
): Promise<EntradaAmore> {
  const { data, error } = await supabase
    .from(TABLA)
    .insert({
      tenant_id: params.tenantId,
      telefono_cliente: params.telefonoCliente,
      modo: params.modo,
      ultimo_wamid_procesado: params.wamid,
      ...(params.notificadoAJessica !== undefined ? { notificado_a_jessica: params.notificadoAJessica } : {}),
    })
    .select(COLUMNAS)
    .single();
  if (error) throw error;
  return mapearFila(data as FilaDb);
}

export async function actualizarEntradaAmore(
  supabase: SupabaseClient,
  id: number,
  cambios: { modo?: ModoEntradaAmore; ultimoWamidProcesado?: string; notificadoAJessica?: boolean },
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (cambios.modo !== undefined) payload.modo = cambios.modo;
  if (cambios.ultimoWamidProcesado !== undefined) payload.ultimo_wamid_procesado = cambios.ultimoWamidProcesado;
  if (cambios.notificadoAJessica !== undefined) payload.notificado_a_jessica = cambios.notificadoAJessica;
  const { error } = await supabase.from(TABLA).update(payload).eq("id", id);
  if (error) throw error;
}
