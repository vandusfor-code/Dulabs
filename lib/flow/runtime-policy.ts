/**
 * Política de runtime declarada por el propio flow (FlowDefinition.runtimePolicy).
 *
 * Mecanismo GENÉRICO del motor: ningún negocio se identifica en el código. Un
 * flow sin `runtimePolicy` (todos los publicados antes de esto) obtiene la
 * política vacía y el runtime se comporta exactamente como siempre.
 *
 *   deterministic: el flow responde todo desde su grafo. El bridge no aplica
 *     atajos fuera del grafo (pregunta lateral con IA, atajos de interrupción)
 *     y, si el flow no atiende un mensaje, no cae a la IA legacy.
 *   restart.keywords: mensajes COMPLETOS que reinician la conversación.
 *   restart.afterInactivityHours: una ejecución esperando respuesta con más
 *     horas sin actividad se reinicia al siguiente mensaje (sin esto, "Hola"
 *     una semana después se guardaría como respuesta a la pregunta pendiente).
 *
 * Reiniciar = cerrar SOLO la ejecución activa (estado conversacional); el
 * camino normal del bridge arranca una nueva desde "start". Nunca toca el
 * contacto, el historial ni las pausas; nunca corta un efecto en vuelo
 * (waiting_effect); un reintento de Meta del mismo mensaje no reinicia dos veces.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationKey, FlowOrchestratorStore } from "@/lib/flow/orchestrator-types";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { executionRowToEngineState } from "@/lib/flow/flow-store-types";
import { flowRuntimePolicySchema } from "@/lib/flow/schemas";
import type { FlowRuntimePolicy } from "@/lib/flow/types";

const POLITICA_VACIA: FlowRuntimePolicy = Object.freeze({});

// Una versión publicada es inmutable (flow_version_id): su política puede
// cachearse sin riesgo de quedar desactualizada. Tope defensivo de tamaño.
const CACHE_MAX = 500;
const cachePorVersion = new Map<string, FlowRuntimePolicy>();

/** Política de una definición cruda (definition_json). Inválida o ausente → vacía. */
export function politicaDeDefinicion(definicion: unknown): FlowRuntimePolicy {
  const cruda = (definicion as { runtimePolicy?: unknown } | null)?.runtimePolicy;
  if (cruda === undefined) return POLITICA_VACIA;
  const r = flowRuntimePolicySchema.safeParse(cruda);
  return r.success ? r.data : POLITICA_VACIA;
}

/**
 * Lee la política que aplica a este mensaje: la de la versión de la ejecución
 * activa o, si no hay, la de la versión publicada del flow del número.
 * Nunca lanza: ante cualquier error devuelve la política vacía (= comportamiento de siempre).
 */
export async function leerPoliticaRuntime(params: {
  store: Pick<FlowOrchestratorStore, "getActiveExecution" | "getFlow" | "getFlowVersion">;
  tenantId: string;
  conversation: ConversationKey;
  flowId: string;
}): Promise<{ politica: FlowRuntimePolicy; activa: FlowExecutionRow | null }> {
  let activa: FlowExecutionRow | null = null;
  try {
    activa = await params.store.getActiveExecution(params.tenantId, params.conversation);
    const versionId = activa?.flow_version_id ?? (await params.store.getFlow(params.tenantId, params.flowId))?.published_version_id;
    if (!versionId) return { politica: POLITICA_VACIA, activa };
    const enCache = cachePorVersion.get(versionId);
    if (enCache) return { politica: enCache, activa };
    const version = await params.store.getFlowVersion(params.tenantId, versionId);
    if (!version) return { politica: POLITICA_VACIA, activa };
    const politica = politicaDeDefinicion(version.definition_json);
    if (cachePorVersion.size >= CACHE_MAX) cachePorVersion.clear();
    cachePorVersion.set(versionId, politica);
    return { politica, activa };
  } catch (err) {
    console.warn("[flow/runtime-policy] no se pudo leer la política (se usa la de siempre):", err instanceof Error ? err.message : err);
    return { politica: POLITICA_VACIA, activa };
  }
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

/** true si el mensaje COMPLETO coincide con una palabra de reinicio (sin importar mayúsculas, tildes, emojis ni signos). */
export function esPalabraReinicio(texto: string, keywords: readonly string[] | undefined): boolean {
  if (!keywords?.length) return false;
  const s = normalizar(texto);
  return s.length > 0 && keywords.some((k) => normalizar(k) === s);
}

export type MotivoReinicio = "palabra" | "inactividad";

/** Decisión pura: ¿hay que cerrar la ejecución activa antes de procesar este mensaje? */
export function decidirReinicio(input: {
  politica: FlowRuntimePolicy;
  texto: string;
  buttonId?: string;
  activa: Pick<FlowExecutionRow, "status" | "last_activity_at"> | null;
  ahoraMs: number;
}): MotivoReinicio | null {
  const restart = input.politica.restart;
  if (!restart || !input.activa) return null; // sin ejecución activa, el camino normal ya arranca desde "start"
  if (input.activa.status === "waiting_effect") return null; // nunca cortar un efecto en vuelo (p. ej. una transferencia)
  if (!input.buttonId && esPalabraReinicio(input.texto, restart.keywords)) return "palabra";
  const horas = restart.afterInactivityHours;
  const ultima = Date.parse(input.activa.last_activity_at);
  if (horas && Number.isFinite(ultima) && input.ahoraMs - ultima > horas * 3_600_000) return "inactividad";
  return null;
}

/** true si este wamid ya fue procesado por alguna ejecución del tenant (reintento de Meta). Ante error: true (no reiniciar). */
async function eventoYaRegistrado(supabase: SupabaseClient, tenantId: string, eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const { data, error } = await supabase.from("dulabs_flow_events").select("id").eq("tenant_id", tenantId).eq("event_id", eventId).limit(1);
  if (error) return true;
  return (data ?? []).length > 0;
}

/**
 * Cierra la ejecución activa si la política del flow lo pide. Devuelve el
 * motivo (o null si no hizo nada). Nunca lanza: un fallo deja el camino
 * normal intacto.
 */
export async function reiniciarSiLaPoliticaLoPide(params: {
  supabase: SupabaseClient;
  store: Pick<FlowOrchestratorStore, "saveExecutionState">;
  tenantId: string;
  politica: FlowRuntimePolicy;
  activa: FlowExecutionRow | null;
  texto: string;
  eventId: string;
  buttonId?: string;
  ahoraMs?: number;
}): Promise<MotivoReinicio | null> {
  const motivo = decidirReinicio({
    politica: params.politica,
    texto: params.texto,
    buttonId: params.buttonId,
    activa: params.activa,
    ahoraMs: params.ahoraMs ?? Date.now(),
  });
  if (!motivo || !params.activa) return null;
  try {
    if (await eventoYaRegistrado(params.supabase, params.tenantId, params.eventId)) return null;
    // "completed": la conversación se cerró sin error; el cliente empieza de nuevo.
    await params.store.saveExecutionState(
      params.tenantId,
      params.activa.id,
      { ...executionRowToEngineState(params.activa), status: "completed" },
      params.activa.state_version,
    );
    return motivo;
  } catch (err) {
    // Conflicto de concurrencia u otro error: el camino normal continúa como siempre.
    console.warn("[flow/runtime-policy] no se pudo reiniciar la ejecución:", err instanceof Error ? err.message : err);
    return null;
  }
}
