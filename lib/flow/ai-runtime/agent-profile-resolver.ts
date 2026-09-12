/**
 * Fase 6 (IA configurable, autorizado) — resuelve un perfil de
 * dulabs_agentes CON AISLAMIENTO TENANT EXPLÍCITO.
 *
 * Deliberadamente NO reutiliza lib/agentes.ts::resolverConfigAgente() (esa
 * función nunca se modifica, sigue sirviendo solo al bot legado): esa
 * función recibe un `ClienteConfig.agente_id` que YA llegó pre-validado por
 * su propio caller y nunca vuelve a comprobar `id_tenant` -- correcto para
 * su uso (agente_id vive en la MISMA fila que id_tenant), pero insuficiente
 * para el Flow Engine, donde `agentId` llega como texto libre dentro de la
 * config de un nodo `ai` que un tenant podría, en teoría, intentar apuntar
 * al agente de OTRO tenant. Este resolver es nuevo, exclusivo del Flow
 * Engine, y siempre verifica `id_tenant` explícitamente antes de devolver
 * nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { descifrarSecreto } from "@/lib/crypto";

export interface AgentProfile {
  id: string;
  nombre: string;
  promptSistema: string | null;
  baseConocimiento: string | null;
  baseConocimientoNombreArchivo: string | null;
  /** Descifrada -- NUNCA serializar/exponer fuera del boundary del executor (mismo criterio que EffectExecutionContext.credentials en F5). */
  apiKey: string | null;
}

export type ResolveAgentProfileResult =
  | { ok: true; profile: AgentProfile }
  | { ok: false; reason: "agent_not_found" | "agent_tenant_mismatch" };

export async function resolveAgentProfileForTenant(
  supabase: SupabaseClient,
  input: { tenantId: string; agentId: string },
): Promise<ResolveAgentProfileResult> {
  const { data, error } = await supabase
    .from("dulabs_agentes")
    .select("id, id_tenant, nombre, prompt_sistema, base_conocimiento, base_conocimiento_nombre_archivo, api_key_ia")
    .eq("id", input.agentId)
    .maybeSingle();
  if (error) throw error;

  if (!data) return { ok: false, reason: "agent_not_found" };
  if (String(data.id_tenant) !== input.tenantId) return { ok: false, reason: "agent_tenant_mismatch" };

  return {
    ok: true,
    profile: {
      id: String(data.id),
      nombre: data.nombre,
      promptSistema: data.prompt_sistema,
      baseConocimiento: data.base_conocimiento,
      baseConocimientoNombreArchivo: data.base_conocimiento_nombre_archivo,
      // dulabs_agentes.api_key_ia ya está cifrado con lib/crypto.ts (mismo
      // mecanismo que meta_permanent_token y las credenciales de F5,
      // confirmado antes de implementar esto) -- se descifra acá, dentro
      // del boundary server-side, igual que ya hacen lib/agentes.ts,
      // lib/ia.ts, asistente-daniela-ia.ts, etc. para el bot legado.
      apiKey: data.api_key_ia ? descifrarSecreto(data.api_key_ia) : null,
    },
  };
}

/** Adapta resolveAgentProfileForTenant al hook ya existente ClaudeExecutorDeps/GeminiExecutorDeps.assertAgentOwnedByTenant. */
export function createAssertAgentOwnedByTenant(
  supabase: SupabaseClient,
): (tenantId: string, agentId: string) => Promise<boolean> {
  return async (tenantId, agentId) => (await resolveAgentProfileForTenant(supabase, { tenantId, agentId })).ok;
}

/**
 * Combina prompt_sistema (agente) + instruction (nodo) + base_conocimiento
 * en un solo bloque TRUSTED -- nunca mezcla con contenido de usuario
 * (UNTRUSTED). Las SYSTEM_RULES inmutables del núcleo (ver
 * claude-prompt-builder.ts) se anteponen SIEMPRE por fuera de este texto,
 * nunca dentro de lo que esta función produce, así que ninguna
 * configuración de tenant/agente puede sobreescribirlas.
 */
export function mergeAgentInstructions(profile: AgentProfile | null, nodeInstruction: string): string {
  if (!profile) return nodeInstruction;
  const base = [profile.promptSistema?.trim(), nodeInstruction.trim()].filter(Boolean).join("\n\n");
  if (!profile.baseConocimiento?.trim()) return base;
  return `${base}\n\n=== CONOCIMIENTO DISPONIBLE (${profile.nombre}) ===\n${profile.baseConocimiento.trim()}`;
}
