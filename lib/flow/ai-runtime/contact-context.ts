/**
 * FASE F7.3 (Contacto + Tags + IA, autorizado) — carga del contexto de
 * contacto (custom_fields + tags) para un nodo AI, compartida entre
 * ClaudeExecutor y GeminiExecutor (composition, mismo patrón exacto que
 * `loadConversationHistory`: un solo punto que hace I/O, inyectado como dep
 * e invocado igual desde ambos executors -- ningún proveedor duplica esta
 * lógica).
 *
 * Seguridad: el contacto SIEMPRE se deriva de `ConversationKey`
 * (phone_number_id + telefono_cliente), que en todo el Flow Engine viene de
 * `request.conversation` -- resuelto por el motor a partir del evento
 * entrante real, NUNCA de un argumento propuesto por la IA. Este módulo no
 * acepta ni tenantId ni contactId sueltos por diseño: solo lee lo que ya
 * resolvió la ejecución.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationKey } from "@/lib/flow/orchestrator-types";
import type { AiNodeConfig } from "@/lib/flow/types";
import { leerContactoActual } from "@/lib/clientes-conocidos";
import { listarEtiquetasDeConversacion } from "@/lib/etiquetas";

export interface AiContactContext {
  customFields: Record<string, unknown>;
  tags: string[];
}

export type LoadAiContactContext = (conversation: ConversationKey) => Promise<AiContactContext>;

/** true si el nodo pidió explícitamente datos de contacto y/o tags como contexto. */
export function shouldLoadContactContext(ai: AiNodeConfig): boolean {
  return Boolean(ai.contextConfig?.includeContactFields || ai.contextConfig?.includeContactTags);
}

/**
 * Filtra el contexto ya cargado según lo que el nodo pidió -- así, por
 * ejemplo, un nodo con `includeContactTags: true` pero sin
 * `includeContactFields` nunca expone custom_fields en el prompt aunque la
 * carga haya traído ambos.
 */
export function applyContactContextFlags(
  ai: AiNodeConfig,
  loaded: AiContactContext,
): AiContactContext {
  return {
    customFields: ai.contextConfig?.includeContactFields ? loaded.customFields : {},
    tags: ai.contextConfig?.includeContactTags ? loaded.tags : [],
  };
}

/** Implementación real -- inyectada por el AI Provider Router (tiene supabase). */
export function createSupabaseAiContactContextLoader(supabase: SupabaseClient): LoadAiContactContext {
  return async (conversation: ConversationKey): Promise<AiContactContext> => {
    const [contacto, tags] = await Promise.all([
      leerContactoActual(supabase, conversation),
      listarEtiquetasDeConversacion(supabase, conversation),
    ]);
    return { customFields: contacto.customFields, tags };
  };
}
