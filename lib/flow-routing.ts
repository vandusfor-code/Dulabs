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

/**
 * Fase 4.A (Trigger Router → Runtime, autorizado) — allowlist de prueba,
 * INDEPENDIENTE de FLOW_TEST_SENDERS/remitentesDePruebaFlow.
 *
 * remitentesDePruebaFlow (arriba) decide Flow vs. LEGACY. Esta decide algo
 * distinto y más angosto: DENTRO de Flow, si se intenta resolver el flowId
 * de una ejecución NUEVA vía lib/flow-triggers (Trigger Router) o si se
 * sigue usando directo cliente.flow_id, sin tocar el Router en absoluto.
 *
 * Mismo patrón exacto que FLOW_TEST_SENDERS: hardcoded en código, NO en
 * Supabase, vacío por defecto. Vacío/ausente para un phone_number_id =
 * Trigger Router deshabilitado para TODO remitente de ese número — el
 * comportamiento de runtime queda idéntico al actual (cliente.flow_id
 * directo, cero consultas nuevas a dulabs_flow_triggers) hasta que se agregue
 * una entrada acá a propósito. Revertir es vaciar este mapa, sin ninguna
 * migración ni cambio de schema.
 */
const TRIGGER_ROUTING_TEST_SENDERS: Record<string, string[]> = {
  // Suite de integración dedicada (lib/flow-runtime-bridge-trigger-routing.test.ts).
  // phone_number_id/remitentes reservados EXCLUSIVAMENTE para esa suite —
  // "test-trigger-routing-suite" nunca coincide con ningún phone_number_id
  // real de Meta (esos son siempre numéricos), así que esta entrada no
  // afecta a NINGÚN tenant real, incluida Daniela. 20 remitentes fijos (la
  // suite necesita conversaciones aisladas por test, sin depender de
  // Date.now() -- el match es EXACTO, no un rango). Agregar acá un número
  // real de prueba cuando el rollout avance más allá de la suite
  // automatizada — nunca el número real de Daniela sin decisión explícita.
  "test-trigger-routing-suite": [
    "573000009001", "573000009002", "573000009003", "573000009004", "573000009005",
    "573000009006", "573000009007", "573000009008", "573000009009", "573000009010",
    "573000009011", "573000009012", "573000009013", "573000009014", "573000009015",
    "573000009016", "573000009017", "573000009018", "573000009019", "573000009020",
  ],
};

/**
 * true si telefonoRemitente está autorizado a que atenderMensajeConFlow
 * intente resolver el flowId de una ejecución NUEVA vía Trigger Router
 * (lib/flow-triggers) para este phone_number_id. Fail-closed: sin entrada
 * configurada (el caso de TODO tenant hoy, incluida Daniela) → false
 * siempre — ver lib/flow-runtime-bridge.ts::resolverFlowIdConTriggerRouting,
 * que en ese caso usa cliente.flow_id exactamente como antes de esta fase.
 */
export function remitenteAutorizadoParaTriggerRouting(
  phoneNumberId: string,
  telefonoRemitente: string,
): boolean {
  const permitidos = TRIGGER_ROUTING_TEST_SENDERS[phoneNumberId];
  return Boolean(permitidos && permitidos.includes(telefonoRemitente));
}
