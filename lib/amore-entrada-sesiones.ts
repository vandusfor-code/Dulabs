/**
 * AMORE (autorizado, Fase 9) — acceso a la única fuente de verdad del modo
 * conversacional del puente bienvenida/Gemini/Agenda V2:
 * dulabs_amore_entrada (ver migración 20260919000000_amore_entrada_conversacional.sql).
 * Mismo patrón exacto que lib/agenda-v2/sesiones.ts -- deliberadamente sin
 * ninguna dependencia de Flow Engine ni de Agenda V2.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ModoEntradaAmore = "inicio" | "gemini";

export interface EntradaAmore {
  id: number;
  tenantId: string;
  telefonoCliente: string;
  modo: ModoEntradaAmore;
  ultimoWamidProcesado: string | null;
}

interface FilaDb {
  id: number;
  tenant_id: string;
  telefono_cliente: string;
  modo: ModoEntradaAmore;
  ultimo_wamid_procesado: string | null;
}

const TABLA = "dulabs_amore_entrada";

function mapearFila(fila: FilaDb): EntradaAmore {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    telefonoCliente: fila.telefono_cliente,
    modo: fila.modo,
    ultimoWamidProcesado: fila.ultimo_wamid_procesado,
  };
}

export async function buscarEntradaAmore(supabase: SupabaseClient, tenantId: string, telefonoCliente: string): Promise<EntradaAmore | null> {
  const { data, error } = await supabase
    .from(TABLA)
    .select("id, tenant_id, telefono_cliente, modo, ultimo_wamid_procesado")
    .eq("tenant_id", tenantId)
    .eq("telefono_cliente", telefonoCliente)
    .maybeSingle();
  if (error) throw error;
  return data ? mapearFila(data as FilaDb) : null;
}

export async function crearEntradaAmore(
  supabase: SupabaseClient,
  params: { tenantId: string; telefonoCliente: string; wamid: string; modo: ModoEntradaAmore },
): Promise<EntradaAmore> {
  const { data, error } = await supabase
    .from(TABLA)
    .insert({ tenant_id: params.tenantId, telefono_cliente: params.telefonoCliente, modo: params.modo, ultimo_wamid_procesado: params.wamid })
    .select("id, tenant_id, telefono_cliente, modo, ultimo_wamid_procesado")
    .single();
  if (error) throw error;
  return mapearFila(data as FilaDb);
}

export async function actualizarEntradaAmore(
  supabase: SupabaseClient,
  id: number,
  cambios: { modo?: ModoEntradaAmore; ultimoWamidProcesado?: string },
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (cambios.modo !== undefined) payload.modo = cambios.modo;
  if (cambios.ultimoWamidProcesado !== undefined) payload.ultimo_wamid_procesado = cambios.ultimoWamidProcesado;
  const { error } = await supabase.from(TABLA).update(payload).eq("id", id);
  if (error) throw error;
}
