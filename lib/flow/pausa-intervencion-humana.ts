/**
 * Pausa por INTERVENCIÓN HUMANA según la política declarada por el flow
 * (FlowDefinition.runtimePolicy.humanTakeover) — mecanismo GENÉRICO: ningún negocio se
 * identifica aquí. Lo usan los dos canales humanos: el eco de coexistencia (la asesora responde
 * desde el celular, app/webhook-dulabs/route.ts) y el envío desde el Inbox
 * (app/api/dashboard/mensajes/route.ts).
 *
 * Si el flow que atiende la conversación declara `humanTakeover.renewHours`, cada mensaje humano
 * deja la pausa en "ahora + renewHours" SIN ACORTAR nunca una pausa vigente más larga
 * (activarPausaPorRespuestaHumana → extenderPausaChat). Si no la declara (todos los demás flows)
 * o la conversación no la atiende un flow, devuelve false y el llamador sigue EXACTAMENTE con su
 * comportamiento de siempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { debeUsarFlowParaRemitente } from "@/lib/flow-routing";
import { createSupabaseFlowOrchestratorStore } from "@/lib/flow/flow-orchestrator-store-supabase";
import type { FlowOrchestratorStore } from "@/lib/flow/orchestrator-types";
import { leerPoliticaRuntime } from "@/lib/flow/runtime-policy";
import { activarPausaPorRespuestaHumana } from "@/lib/pausas-chat";
import type { ClienteConfig } from "@/lib/supabase";

const HORA_MS = 60 * 60 * 1000;

type NumeroConFlow = Pick<ClienteConfig, "id_tenant" | "phone_number_id" | "flow_activo" | "flow_id">;

/** Duración (ms) que la política del flow de esta conversación pide tras un mensaje humano; null = sin política. */
export async function duracionPausaPorIntervencionHumana(params: {
  supabase: SupabaseClient;
  cliente: NumeroConFlow;
  telefonoCliente: string;
  store?: Pick<FlowOrchestratorStore, "getActiveExecution" | "getFlow" | "getFlowVersion">;
}): Promise<number | null> {
  const { cliente } = params;
  // Solo si la conversación la atiende un flow (mismo criterio que el webhook: flow activo y,
  // si hay allowlist de prueba, remitente autorizado).
  if (!cliente.flow_id || !debeUsarFlowParaRemitente(cliente, params.telefonoCliente)) return null;
  const { politica } = await leerPoliticaRuntime({
    store: params.store ?? createSupabaseFlowOrchestratorStore(params.supabase),
    tenantId: cliente.id_tenant,
    conversation: { phoneNumberId: cliente.phone_number_id, telefonoCliente: params.telefonoCliente },
    flowId: cliente.flow_id,
  });
  const horas = politica.humanTakeover?.renewHours;
  return horas && horas > 0 ? horas * HORA_MS : null;
}

/**
 * Aplica la política si existe. true = la pausa quedó renovada por la política (el llamador no
 * hace nada más); false = sin política (o no se pudo escribir): el llamador sigue con lo de siempre.
 */
export async function renovarPausaPorIntervencionHumana(params: {
  supabase: SupabaseClient;
  cliente: NumeroConFlow;
  telefonoCliente: string;
  store?: Pick<FlowOrchestratorStore, "getActiveExecution" | "getFlow" | "getFlowVersion">;
}): Promise<boolean> {
  let duracionMs: number | null;
  try {
    duracionMs = await duracionPausaPorIntervencionHumana(params);
  } catch (err) {
    console.error("[pausa-intervencion-humana] no se pudo leer la política:", err instanceof Error ? err.message : err);
    return false;
  }
  if (!duracionMs) return false;
  const r = await activarPausaPorRespuestaHumana(params.supabase, params.cliente.phone_number_id, params.telefonoCliente, duracionMs);
  if (r.ok) {
    console.log(
      `[pausa-intervencion-humana] pausa renovada por intervención humana tenant=${params.cliente.id_tenant} phone=${params.cliente.phone_number_id} hasta=${r.pausadoHasta}`,
    );
  }
  return r.ok;
}
