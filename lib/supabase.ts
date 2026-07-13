import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ClienteConfig = {
  id: string;
  id_tenant: string;
  nombre_negocio: string;
  whatsapp_business_account_id: string;
  phone_number_id: string;
  telefono_negocio: string;
  prompt_sistema: string | null;
  api_key_ia: string | null;
  meta_permanent_token: string | null;
  estado_pausa: boolean;
  pausado_hasta: string | null;
  created_at: string;
  updated_at: string;
};

export type PausaChat = {
  id: number;
  phone_number_id: string;
  telefono_cliente: string;
  pausado_hasta: string;
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
