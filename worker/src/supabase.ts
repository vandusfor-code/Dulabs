import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cliente: SupabaseClient | null = null;

// Mismo rol que lib/supabase.ts::supabaseAdmin() en el repo de Next, pero
// standalone -- el worker es un proyecto Node separado (no importa nada del
// repo de Next) para poder desplegarse en su propia plataforma.
export function supabaseWorker(): SupabaseClient {
  if (!cliente) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno del worker");
    }
    cliente = createClient(url, key, { auth: { persistSession: false } });
  }
  return cliente;
}
