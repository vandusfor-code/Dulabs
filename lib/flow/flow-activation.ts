/**
 * Fase 4 (Self-Service Flow Activation, autorizado) — I/O puro sobre
 * dulabs_clientes_config.flow_activo/flow_id para un phone_number_id
 * concreto. Vive en un archivo propio (no en flow-store.ts) por el mismo
 * motivo que `tieneClienteActivo` en app/api/flows/[id]/route.ts vive local
 * a esa ruta: dulabs_clientes_config no es una tabla del Flow Store (esa
 * posee dulabs_flows/dulabs_flow_versions/dulabs_flow_triggers/executions).
 *
 * Nunca toca trigger_routing_activo ni ninguna otra columna -- eso es
 * explícitamente Fase 3C/Bloque 3, fuera de alcance acá. Nunca acepta
 * tenant_id de un caller: siempre se recibe como parámetro ya resuelto por
 * requireFlowAccess() (derivado del usuario autenticado), y toda esta
 * función además revalida por su cuenta que el phone_number_id pertenezca a
 * ESE tenant antes de escribir nada -- mismo criterio anti-secuestro que
 * app/api/auth/meta-callback/route.ts ya usa para conectar un número.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";

export type ActivarFlowResult = { ok: true; row: ClienteConfig } | { ok: false; reason: "numero_no_encontrado" };

export type DesactivarFlowResult =
  | { ok: true; row: ClienteConfig }
  | { ok: false; reason: "numero_no_encontrado" | "flow_no_activo_en_este_numero" };

/** Código Postgres de violación de CHECK constraint. */
const PG_CHECK_VIOLATION = "23514";

/** Nombre exacto del CHECK de la migración 20260925000000 (Fase 3B/3C). */
const CHECK_TRIGGER_ROUTING_REQUIERE_FLOW_ACTIVO = "dulabs_clientes_config_trigger_routing_requiere_flow_activo";

/**
 * dulabs_clientes_config tiene el CHECK
 * `trigger_routing_activo=false OR (flow_activo=true AND flow_id IS NOT NULL)`
 * (migración 20260925000000). Si algún día un número tiene
 * trigger_routing_activo=true (hoy ninguno lo tiene, confirmado en la
 * prueba controlada de F3C), desactivar su Flow violaría ese CHECK -- se
 * traduce a un error explícito en vez de dejar pasar un 23514 crudo. Se
 * distingue por el NOMBRE del constraint (no solo el código 23514, que
 * también dispara el CHECK preexistente `..._flow_activo_requiere_flow_id`
 * de la migración 20260829120000 -- ver desactivarFlowParaNumero) para no
 * atribuir este mensaje a la causa equivocada.
 */
export class FlowActivationCheckViolationError extends Error {
  constructor() {
    super(
      "No se puede desactivar: el Router SaaS (trigger_routing_activo) sigue activo para este número y requiere un Flow activo. Desactiva primero el Router SaaS.",
    );
    this.name = "FlowActivationCheckViolationError";
  }
}

async function buscarFilaPorNumero(
  supabase: SupabaseClient,
  phoneNumberId: string,
): Promise<{ id_tenant: string; flow_id: string | null; flow_activo: boolean | null } | null> {
  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("id_tenant, flow_id, flow_activo")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Activa `flowId` (ya validado como published_version_id existente por el
 * caller vía getFlowById+status) en `phoneNumberId`. Reemplaza silenciosamente
 * cualquier Flow ya activo en ese número -- la advertencia/confirmación de
 * reemplazo es responsabilidad de la UI, no de esta función.
 */
export async function activarFlowParaNumero(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; phoneNumberId: string },
): Promise<ActivarFlowResult> {
  const fila = await buscarFilaPorNumero(supabase, input.phoneNumberId);
  if (!fila || fila.id_tenant !== input.tenantId) {
    // No distingue "no existe" de "es de otro tenant" -- mismo criterio de
    // no revelar existencia cross-tenant que el resto de /api/flows.
    return { ok: false, reason: "numero_no_encontrado" };
  }

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .update({ flow_activo: true, flow_id: input.flowId, updated_at: new Date().toISOString() })
    .eq("phone_number_id", input.phoneNumberId)
    .eq("id_tenant", input.tenantId)
    .select("*")
    .single();
  if (error) throw error;
  return { ok: true, row: data as ClienteConfig };
}

/**
 * Desactiva (flow_activo=false, flow_id=null) SOLO si `flowId` es el que
 * está activo hoy en ese número -- evita que el botón "Desactivar" de un
 * Flow apague por error la activación de un Flow distinto.
 *
 * flow_id se limpia a null (no se conserva como historial): el CHECK
 * preexistente `dulabs_clientes_config_flow_activo_requiere_flow_id`
 * (migración 20260829120000) exige exactamente
 * `(flow_activo=false AND flow_id IS NULL) OR (flow_activo=true AND flow_id IS NOT NULL)`
 * -- flow_activo=false con un flow_id no nulo es un estado que la propia
 * base de datos rechaza, confirmado con una verificación real contra
 * Supabase durante la implementación. Ninguna otra columna se toca.
 */
export async function desactivarFlowParaNumero(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; phoneNumberId: string },
): Promise<DesactivarFlowResult> {
  const fila = await buscarFilaPorNumero(supabase, input.phoneNumberId);
  if (!fila || fila.id_tenant !== input.tenantId) {
    return { ok: false, reason: "numero_no_encontrado" };
  }
  if (fila.flow_id !== input.flowId) {
    return { ok: false, reason: "flow_no_activo_en_este_numero" };
  }

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .update({ flow_activo: false, flow_id: null, updated_at: new Date().toISOString() })
    .eq("phone_number_id", input.phoneNumberId)
    .eq("id_tenant", input.tenantId)
    .select("*")
    .single();
  if (error) {
    const pgError = error as { code?: string; message?: string };
    if (pgError.code === PG_CHECK_VIOLATION && pgError.message?.includes(CHECK_TRIGGER_ROUTING_REQUIERE_FLOW_ACTIVO)) {
      throw new FlowActivationCheckViolationError();
    }
    throw error;
  }
  return { ok: true, row: data as ClienteConfig };
}
