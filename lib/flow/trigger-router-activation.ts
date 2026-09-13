/**
 * FASE F8.2 (Trigger Router SaaS — Self-Service Activation, autorizado) —
 * archivo hermano de lib/flow/flow-activation.ts (F4), que NUNCA se
 * modifica. Escribe EXCLUSIVAMENTE dulabs_clientes_config.trigger_routing_activo
 * para un phone_number_id que ya tiene ESTE Flow activo (flow_activo=true,
 * flow_id coincidente vía F4) -- nunca toca flow_activo/flow_id.
 *
 * El runtime que YA consume esta columna
 * (lib/flow-trigger-router-activacion.ts::resolverActivacionTriggerRouter,
 * conectado desde Fase 3C a lib/flow-runtime-bridge.ts) no se modifica --
 * este archivo es únicamente el camino de escritura self-service que
 * faltaba (ver reporte de audit F8.2).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ActivarTriggerRouterResult =
  | { ok: true; triggerRoutingActivo: true }
  | {
      ok: false;
      reason: "numero_no_encontrado" | "flow_no_activo_en_este_numero" | "estado_cambio_durante_la_operacion";
    };

export type DesactivarTriggerRouterResult =
  | { ok: true; triggerRoutingActivo: false }
  | { ok: false; reason: "numero_no_encontrado" };

interface FilaTriggerRouter {
  id_tenant: string;
  flow_id: string | null;
  flow_activo: boolean | null;
}

async function buscarFilaPorNumero(
  supabase: SupabaseClient,
  phoneNumberId: string,
): Promise<FilaTriggerRouter | null> {
  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("id_tenant, flow_id, flow_activo")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Activa el Trigger Router SaaS para `phoneNumberId`, exigiendo que ESE
 * mismo Flow (`flowId`) ya esté activo en ese número (flow_activo=true,
 * flow_id=flowId, vía F4) -- nunca se activa "para" un Flow distinto del
 * configurado.
 *
 * UPDATE condicionado (no SELECT-then-UPDATE ingenuo): las mismas
 * condiciones ya revalidadas arriba se repiten como filtro del propio
 * UPDATE, así que si el estado cambió entre la lectura y la escritura (ej.
 * otro admin desactivando el Flow un instante antes), el UPDATE afecta 0
 * filas en vez de activar el Router sobre un estado inválido -- se detecta
 * con `.select().maybeSingle()` devolviendo `null`. El CHECK real de
 * Postgres (`dulabs_clientes_config_trigger_routing_requiere_flow_activo`)
 * queda como última barrera, nunca como la única.
 */
export async function activarTriggerRouterParaNumero(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; phoneNumberId: string },
): Promise<ActivarTriggerRouterResult> {
  const fila = await buscarFilaPorNumero(supabase, input.phoneNumberId);
  // No distingue "no existe" de "es de otro tenant" -- mismo criterio
  // anti-enumeración cross-tenant que ya usa lib/flow/flow-activation.ts.
  if (!fila || fila.id_tenant !== input.tenantId) {
    return { ok: false, reason: "numero_no_encontrado" };
  }
  if (fila.flow_id !== input.flowId || fila.flow_activo !== true) {
    return { ok: false, reason: "flow_no_activo_en_este_numero" };
  }

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .update({ trigger_routing_activo: true, updated_at: new Date().toISOString() })
    .eq("phone_number_id", input.phoneNumberId)
    .eq("id_tenant", input.tenantId)
    .eq("flow_activo", true)
    .eq("flow_id", input.flowId)
    .select("phone_number_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { ok: false, reason: "estado_cambio_durante_la_operacion" };
  }
  return { ok: true, triggerRoutingActivo: true };
}

/**
 * Desactiva el Trigger Router SaaS para `phoneNumberId` -- nunca toca
 * flow_activo/flow_id. Al quedar `false`, el runtime ya existente
 * (resolverActivacionTriggerRouter) simplemente deja de autorizar el Router
 * para este número en la próxima conversación nueva; el Flow activado por
 * F4 sigue funcionando exactamente igual (comportamiento legacy:
 * cliente.flow_id directo).
 */
export async function desactivarTriggerRouterParaNumero(
  supabase: SupabaseClient,
  input: { tenantId: string; phoneNumberId: string },
): Promise<DesactivarTriggerRouterResult> {
  const fila = await buscarFilaPorNumero(supabase, input.phoneNumberId);
  if (!fila || fila.id_tenant !== input.tenantId) {
    return { ok: false, reason: "numero_no_encontrado" };
  }

  const { error } = await supabase
    .from("dulabs_clientes_config")
    .update({ trigger_routing_activo: false, updated_at: new Date().toISOString() })
    .eq("phone_number_id", input.phoneNumberId)
    .eq("id_tenant", input.tenantId);
  if (error) throw error;
  return { ok: true, triggerRoutingActivo: false };
}
