/**
 * TOPES DE COSTO Y ABUSO del agente (Bloque 14).
 *
 * El consumo se lee de las trazas persistentes (dulabs_agente_consumo sobre
 * dulabs_agente_trazas): no hay contadores aparte que se desincronicen. Solo cuentan los turnos
 * que llamaron al modelo.
 *
 *   ritmo por minuto del cliente   -> "throttle": ni modelo ni respuesta a ese mensaje
 *   turnos del día del cliente     -> "handoff": pasa a una asesora (mensaje fijo, sin modelo)
 *   tokens del día del negocio     -> "handoff": idem
 *
 * Si el consumo no se puede leer (sin migración, error), se sigue normal y se registra en la
 * traza: los topes protegen el costo, no deben frenar ventas por una falla de lectura.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentLimitsConfig } from "@/lib/agente/config";

export interface UsageSnapshot {
  contactMinute: number;
  contactDay: number;
  tenantTokensDay: number;
}

export interface UsageReader {
  /** null = no se pudo medir (se sigue normal). */
  read(input: { tenantId: string; phoneNumberId: string; contactRef: string }): Promise<UsageSnapshot | null>;
}

export type LimitDecision = { action: "allow" } | { action: "throttle"; reason: "contact_minute" } | { action: "handoff"; reason: "contact_day" | "tenant_tokens_day" };

export function decideLimits(usage: UsageSnapshot | null, limits: AgentLimitsConfig): LimitDecision {
  if (!usage) return { action: "allow" };
  if (usage.tenantTokensDay >= limits.tokens_por_dia_negocio) return { action: "handoff", reason: "tenant_tokens_day" };
  if (usage.contactDay >= limits.turnos_por_dia_cliente) return { action: "handoff", reason: "contact_day" };
  if (usage.contactMinute >= limits.turnos_por_minuto_cliente) return { action: "throttle", reason: "contact_minute" };
  return { action: "allow" };
}

export function createSupabaseUsageReader(supabase: SupabaseClient): UsageReader {
  return {
    async read({ tenantId, phoneNumberId, contactRef }) {
      try {
        const { data, error } = await supabase.rpc("dulabs_agente_consumo", { p_tenant: tenantId, p_pn: phoneNumberId, p_contact_ref: contactRef });
        if (error) return null;
        const row = (Array.isArray(data) ? data[0] : data) as { turnos_minuto_cliente: number; turnos_dia_cliente: number; tokens_dia_negocio: number | string } | undefined;
        if (!row) return null;
        return { contactMinute: Number(row.turnos_minuto_cliente) || 0, contactDay: Number(row.turnos_dia_cliente) || 0, tenantTokensDay: Number(row.tokens_dia_negocio) || 0 };
      } catch {
        return null;
      }
    },
  };
}
