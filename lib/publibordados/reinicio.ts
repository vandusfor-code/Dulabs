/**
 * PUBLI BORDADOS — reinicio del Flow (autorizado, exclusivo de este número).
 *
 * Dos casos, ambos deterministas y sin IA:
 *   1. El cliente escribe "reiniciar", "menú"/"menu" o "inicio" (el mensaje
 *      completo, no una palabra dentro de una frase).
 *   2. La conversación lleva más de 24 h sin actividad y el cliente vuelve a
 *      escribir: sin esto, "Hola" una semana después se guardaría como
 *      respuesta a la pregunta pendiente (por ejemplo, como su nombre).
 *
 * Solo se cierra la ejecución ACTIVA del Flow (estado conversacional). No
 * toca el contacto (dulabs_clientes_conocidos / módulo Clientes), el
 * historial de mensajes ni las pausas: el siguiente paso del bridge, al no
 * encontrar ejecución activa, arranca una nueva desde "start" con el camino
 * normal (mismo patrón que el reinicio de Solo Talento).
 *
 * Nunca interrumpe un efecto en vuelo (waiting_effect: la transferencia a
 * asesora en curso). Un reintento de Meta del MISMO mensaje nunca reinicia
 * dos veces: si ese wamid ya quedó registrado como evento de alguna
 * ejecución, se deja pasar al camino normal, que lo descarta como duplicado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlowOrchestratorStore } from "@/lib/flow/orchestrator-types";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { executionRowToEngineState } from "@/lib/flow/flow-store-types";

/** Número de WhatsApp (phone_number_id de Meta) de Publi Bordados. */
export const PUBLIBORDADOS_PHONE_NUMBER_ID = "1337486632773969";

export const PUBLIBORDADOS_INACTIVIDAD_MS = 24 * 60 * 60 * 1000;

const PALABRAS_REINICIO = new Set(["reiniciar", "menu", "inicio"]);

export function esNumeroPublibordados(phoneNumberId: string): boolean {
  return phoneNumberId === PUBLIBORDADOS_PHONE_NUMBER_ID;
}

/**
 * Si el Flow no pudo atender un mensaje (error técnico ya registrado como
 * fallo), el webhook normalmente cae a la IA "legacy" del número, que es
 * generativa. Publi Bordados es 100 % determinista: nunca se cae a IA.
 */
export function permiteFallbackALegacy(phoneNumberId: string): boolean {
  return !esNumeroPublibordados(phoneNumberId);
}

/** true si el mensaje COMPLETO es una palabra de reinicio (sin importar mayúsculas, tildes, emojis ni signos). */
export function esPalabraReinicio(texto: string): boolean {
  const s = texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
  return PALABRAS_REINICIO.has(s);
}

export type MotivoReinicio = "palabra" | "inactividad";

/** Decisión pura: ¿hay que cerrar la ejecución activa antes de procesar este mensaje? */
export function decidirReinicio(input: {
  texto: string;
  buttonId?: string;
  activa: Pick<FlowExecutionRow, "status" | "last_activity_at"> | null;
  ahoraMs: number;
}): MotivoReinicio | null {
  if (!input.activa) return null; // sin ejecución activa el camino normal ya arranca desde "start"
  if (input.activa.status === "waiting_effect") return null; // nunca cortar una transferencia en curso
  if (!input.buttonId && esPalabraReinicio(input.texto)) return "palabra";
  const ultima = Date.parse(input.activa.last_activity_at);
  if (Number.isFinite(ultima) && input.ahoraMs - ultima > PUBLIBORDADOS_INACTIVIDAD_MS) return "inactividad";
  return null;
}

/** true si este wamid ya fue procesado por alguna ejecución del tenant (reintento de Meta). */
async function eventoYaRegistrado(supabase: SupabaseClient, tenantId: string, wamid: string): Promise<boolean> {
  if (!wamid) return false;
  const { data, error } = await supabase
    .from("dulabs_flow_events")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("event_id", wamid)
    .limit(1);
  // Ante un error no se reinicia (fail-safe: el camino normal sigue como siempre).
  if (error) return true;
  return (data ?? []).length > 0;
}

/**
 * Cierra la ejecución activa si corresponde reiniciar. Devuelve el motivo
 * (o null si no hizo nada). Nunca lanza: un fallo deja el camino normal
 * intacto.
 */
export async function reiniciarFlowPublibordadosSiCorresponde(params: {
  supabase: SupabaseClient;
  store: Pick<FlowOrchestratorStore, "getActiveExecution" | "saveExecutionState">;
  tenantId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  texto: string;
  wamid: string;
  buttonId?: string;
  ahoraMs?: number;
}): Promise<MotivoReinicio | null> {
  if (!esNumeroPublibordados(params.phoneNumberId)) return null;
  try {
    const activa = await params.store.getActiveExecution(params.tenantId, {
      phoneNumberId: params.phoneNumberId,
      telefonoCliente: params.telefonoCliente,
    });
    const motivo = decidirReinicio({
      texto: params.texto,
      buttonId: params.buttonId,
      activa,
      ahoraMs: params.ahoraMs ?? Date.now(),
    });
    if (!activa || !motivo) return null;
    if (await eventoYaRegistrado(params.supabase, params.tenantId, params.wamid)) return null;

    // "completed": la conversación se cerró sin error; el cliente empieza de nuevo.
    await params.store.saveExecutionState(
      params.tenantId,
      activa.id,
      { ...executionRowToEngineState(activa), status: "completed" },
      activa.state_version,
    );
    return motivo;
  } catch (err) {
    // Conflicto de concurrencia u otro error: el camino normal continúa como siempre.
    console.warn("[publibordados] no se pudo reiniciar el flow:", err instanceof Error ? err.message : err);
    return null;
  }
}
