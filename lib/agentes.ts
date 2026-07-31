import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";

export type ConfigAgenteEfectiva = {
  prompt_sistema: string | null;
  base_conocimiento: string | null;
  api_key_ia: string | null;
  nombre_agente: string | null;
};

function configLegado(cliente: Pick<ClienteConfig, "prompt_sistema" | "base_conocimiento" | "api_key_ia" | "nombre_agente">): ConfigAgenteEfectiva {
  return {
    prompt_sistema: cliente.prompt_sistema,
    base_conocimiento: cliente.base_conocimiento,
    api_key_ia: cliente.api_key_ia,
    nombre_agente: cliente.nombre_agente,
  };
}

// Resuelve qué configuración de IA usa realmente un número: si tiene un
// agente asignado (agente_id), la de ESE agente (tabla dulabs_agentes); si
// no, la ruta legada — el prompt/base de conocimiento/api key que siempre
// vivieron directo en la fila del número. Retrocompatible: un número que
// nunca se tocó desde la pantalla de Agentes de IA nueva sigue funcionando
// exactamente igual que antes de este cambio.
export async function resolverConfigAgente(
  supabase: SupabaseClient,
  cliente: Pick<ClienteConfig, "agente_id" | "prompt_sistema" | "base_conocimiento" | "api_key_ia" | "nombre_agente">
): Promise<ConfigAgenteEfectiva> {
  if (!cliente.agente_id) return configLegado(cliente);

  const { data } = await supabase
    .from("dulabs_agentes")
    .select("nombre, prompt_sistema, base_conocimiento, api_key_ia")
    .eq("id", cliente.agente_id)
    .maybeSingle();
  if (!data) return configLegado(cliente); // agente_id huérfano (no debería pasar, on delete set null)

  return {
    prompt_sistema: data.prompt_sistema,
    base_conocimiento: data.base_conocimiento,
    api_key_ia: data.api_key_ia,
    nombre_agente: data.nombre,
  };
}
