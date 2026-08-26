import type { SupabaseClient } from "@supabase/supabase-js";

export type ConfigBot = {
  id: number;
  phone_number_id: string;
  token: string;
  respuestas: Record<string, unknown>;
  updated_at: string;
};

export async function configBotPorToken(supabase: SupabaseClient, token: string): Promise<ConfigBot | null> {
  const { data } = await supabase.from("dulabs_config_bot").select("*").eq("token", token).maybeSingle();
  return (data as ConfigBot) ?? null;
}

export async function guardarRespuestasConfigBot(
  supabase: SupabaseClient,
  token: string,
  respuestas: Record<string, unknown>
): Promise<ConfigBot | null> {
  const { data } = await supabase
    .from("dulabs_config_bot")
    .update({ respuestas, updated_at: new Date().toISOString() })
    .eq("token", token)
    .select("*")
    .maybeSingle();
  return (data as ConfigBot) ?? null;
}
