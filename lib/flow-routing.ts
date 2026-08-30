import type { ClienteConfig } from "@/lib/supabase";
import { remitentesDePruebaFlow } from "@/lib/flow-test-senders";

/**
 * Fase 0 — Migración Daniela → Flow.
 *
 * ÚNICA función que decide LEGACY vs FLOW para un mensaje entrante. A
 * propósito NO mira nada más que estas dos columnas explícitas
 * (flow_activo, flow_id) -- ninguna heurística ("¿tiene especialistas?",
 * "¿tiene marketplace_activacion_id?", "¿tiene agente_id?"), porque
 * cualquiera de esas señales ya significa algo distinto en LEGACY y
 * activaría Flow por accidente para un tenant que nunca lo pidió.
 *
 * Default: flow_activo=false (o columna inexistente antes de aplicar la
 * migración 20260829120000) => SIEMPRE legacy, para TODO tenant existente,
 * sin excepción.
 */
export function debeUsarFlow(
  cliente: Pick<ClienteConfig, "flow_activo" | "flow_id">,
): cliente is { flow_activo: true; flow_id: string } {
  return cliente.flow_activo === true && typeof cliente.flow_id === "string" && cliente.flow_id.length > 0;
}

/**
 * Fase 0 — gate de prueba por remitente (autorizado explícitamente).
 *
 * Compone sobre debeUsarFlow SIN modificarla: además de flow_activo/flow_id,
 * exige que telefonoRemitente esté en la lista de prueba de este
 * phone_number_id (lib/flow-test-senders.ts), SI existe una configurada.
 * Sin lista para ese número, se comporta idéntico a debeUsarFlow (el
 * comportamiento real una vez ya no haga falta restringir por remitente).
 *
 * Fail-closed: remitente no listado -> false -> LEGACY. flow_activo=false
 * -> false sin siquiera mirar la lista. Nunca al revés: esta función no
 * puede hacer que un remitente entre a Flow si debeUsarFlow ya dijo que no.
 */
export function debeUsarFlowParaRemitente(
  cliente: Pick<ClienteConfig, "flow_activo" | "flow_id" | "phone_number_id">,
  telefonoRemitente: string,
): boolean {
  if (!debeUsarFlow(cliente)) return false;
  const permitidos = remitentesDePruebaFlow(cliente.phone_number_id);
  if (!permitidos) return true;
  return permitidos.includes(telefonoRemitente);
}
