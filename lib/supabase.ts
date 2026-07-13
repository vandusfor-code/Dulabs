import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ClienteConfig = {
  id: string;
  nombre_negocio: string;
  waba_id: string;
  phone_number_id: string;
  telefono_negocio: string;
  prompt_ia: string | null;
  api_key_ia: string | null;
  estado_pausa: boolean;
  pausado_hasta: string | null;
  created_at: string;
};

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno"
      );
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
