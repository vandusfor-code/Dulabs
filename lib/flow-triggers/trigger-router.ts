/**
 * Fase 3 (Event Routing, autorizado) — Router determinista:
 *
 *   candidateTriggers (ya con su tenant + flowStatus, ver RoutableTrigger)
 *     → filtrar activos (tenant correcto + enabled + Flow published)
 *     → matchTrigger (¿coincide con el evento?)
 *     → ordenar por prioridad
 *     → desempatar por especificidad del tipo de trigger
 *     → desempate final determinista (id, nunca el orden del array)
 *     → ganador
 *
 * Pura: no toca Supabase, no ejecuta el Flow -- solo devuelve
 * FlowSelectionResult. flow-store.ts es quien arma el array de
 * RoutableTrigger (join real) y quien, más adelante, un futuro Flow Engine
 * usará para decidir qué ejecutar.
 */

import { matchTrigger } from "@/lib/flow-triggers/match-trigger";
import type { FlowSelectionResult, IncomingEvent, RoutableTrigger, TriggerType } from "@/lib/flow-triggers/types";

/**
 * Especificidad por tipo de trigger -- desempate cuando dos triggers
 * elegibles tienen la MISMA prioridad numérica. Un match por keyword EXACTA
 * es la configuración más deliberada que puede hacer una clienta (gana);
 * "user_message" es el catch-all más amplio posible (pierde contra
 * cualquier otro tipo que también haya coincidido). "manual" nunca llega
 * hasta acá (matchTrigger ya lo excluye), pero se documenta en 0 por
 * completitud. Constante EXPLÍCITA a propósito -- nunca "orden de llegada".
 */
const TYPE_SPECIFICITY: Record<TriggerType, number> = {
  keyword: 100,
  message_starts_with: 80,
  message_contains: 60,
  event: 50,
  conversation_started: 40,
  user_message: 10,
  manual: 0,
};

/**
 * Filtra los triggers que PUEDEN ganar un routing, en el ORDEN de
 * protecciones pedido: tenant correcto (defensa en profundidad -- el caller
 * ya debería haber scoped esto, pero el Router nunca confía ciegamente),
 * habilitado, y Flow con versión PUBLICADA (esto excluye Draft Y Archived
 * con un solo check, porque `dulabs_flows.status` solo puede ser UNA de las
 * tres -- nunca "published" para un Flow archivado o todavía en borrador).
 */
function esCandidatoElegible(trigger: RoutableTrigger, event: IncomingEvent): boolean {
  if (trigger.tenantId !== event.tenantId) return false;
  if (!trigger.enabled) return false;
  if (trigger.flowStatus !== "published") return false;
  return matchTrigger(trigger, event);
}

function compararCandidatos(a: RoutableTrigger, b: RoutableTrigger): number {
  if (b.priority !== a.priority) return b.priority - a.priority; // mayor prioridad gana
  const specA = TYPE_SPECIFICITY[a.type];
  const specB = TYPE_SPECIFICITY[b.type];
  if (specB !== specA) return specB - specA; // mayor especificidad gana
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // desempate final determinista, nunca el orden de llegada
}

/**
 * Resuelve, de forma determinista, qué Flow debe activarse para un evento
 * entrante -- o `matched:false` si ninguno aplica. NUNCA ejecuta el Flow.
 */
export function resolveFlowSelection(candidates: readonly RoutableTrigger[], event: IncomingEvent): FlowSelectionResult {
  if (candidates.length === 0) return { matched: false, reason: "no_candidates" };

  const elegibles = candidates.filter((t) => esCandidatoElegible(t, event));
  if (elegibles.length === 0) return { matched: false, reason: "no_trigger_matched" };

  const ganador = [...elegibles].sort(compararCandidatos)[0];
  return {
    matched: true,
    flowId: ganador.flowId,
    triggerId: ganador.id,
    triggerType: ganador.type,
    priority: ganador.priority,
    reason: "matched",
  };
}
