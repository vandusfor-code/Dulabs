/**
 * Saldo de mensajes masivos de cortesía por tenant (ver migración
 * 20260901230000_creditos_mensajes_masivos.sql). Independiente del cupo
 * mensual de IA conversacional (mensajes_usados_mes/mes_actual en
 * dulabs_clientes_config, ver lib/plan-limits.ts) -- este es un saldo
 * TOTAL, sin reinicio, exclusivo de envíos de campañas masivas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CreditosMasivos {
  limite: number;
  usados: number;
  disponibles: number;
}

/** null si el tenant todavía no tiene fila (nunca se le asignó cortesía/paquete). */
export async function obtenerCreditosMasivos(
  supabase: SupabaseClient,
  idTenant: string,
): Promise<CreditosMasivos | null> {
  const { data, error } = await supabase
    .from("dulabs_creditos_mensajes_masivos")
    .select("limite, usados")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { limite: data.limite, usados: data.usados, disponibles: Math.max(0, data.limite - data.usados) };
}

/**
 * Reserva atómicamente `cantidad` créditos para el tenant (ver
 * dulabs_consumir_creditos_masivos). true = reservados, la campaña puede
 * proceder por el total reservado; false = saldo insuficiente o el tenant
 * no tiene fila de créditos -- rechazar la campaña COMPLETA, nunca enviar
 * una parte.
 */
export async function consumirCreditosMasivos(
  supabase: SupabaseClient,
  idTenant: string,
  cantidad: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("dulabs_consumir_creditos_masivos", {
    p_tenant: idTenant,
    p_cantidad: cantidad,
  });
  if (error) throw error;
  return data === true;
}

/** Devuelve créditos reservados que no se usaron de verdad (destinatarios fallidos). No-op si cantidad <= 0. */
export async function reembolsarCreditosMasivos(supabase: SupabaseClient, idTenant: string, cantidad: number): Promise<void> {
  if (cantidad <= 0) return;
  const { error } = await supabase.rpc("dulabs_reembolsar_creditos_masivos", { p_tenant: idTenant, p_cantidad: cantidad });
  if (error) throw error;
}

/**
 * Mensaje exacto pedido por el usuario para cuando la campaña completa
 * excede el saldo disponible. Función pura -- fácil de probar sin red.
 */
export function mensajeSaldoInsuficiente(disponibles: number, requeridos: number): string {
  return `Has alcanzado el límite de mensajes disponibles para tu cuenta. Actualmente tienes ${disponibles} mensajes de cortesía disponibles, pero esta campaña requiere ${requeridos}. Reduce la cantidad de destinatarios o adquiere un nuevo paquete de mensajes.`;
}

/** true si el tenant, con el saldo dado, tiene alcance para enviar `requeridos` mensajes. Pura. */
export function alcanzaSaldo(disponibles: number, requeridos: number): boolean {
  return disponibles >= requeridos;
}
