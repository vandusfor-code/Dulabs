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

/**
 * Fase 8A.4 (autorizado) — misma tabla, misma fila, distinta llave: acá el
 * caller (el asistente de IA, ver lib/asistente-daniela-ia.ts) ya conoce el
 * `phone_number_id` real del tenant resuelto por el webhook -- nunca el
 * token del link, que es solo la autenticación de la página humana. `
 * phone_number_id` es `unique` en el esquema (20260826230000_config_bot.sql),
 * así que esta lectura ya es un aislamiento por tenant correcto sin
 * necesitar una tabla ni una columna nueva.
 */
export async function configBotPorPhoneNumberId(supabase: SupabaseClient, phoneNumberId: string): Promise<ConfigBot | null> {
  const { data } = await supabase.from("dulabs_config_bot").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
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
