import { createClient } from "@supabase/supabase-js";
import { crearServidorWorkerInbound } from "./server";

// DuLabs Developer V1 -- Fase 3. Bootstrap del servicio Cloud Run
// dulabs-inbound-worker.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("[worker-inbound] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const servidor = crearServidorWorkerInbound({ supabase });
const puerto = Number(process.env.PORT ?? 8080);
servidor.listen(puerto, () => {
  console.log(`[worker-inbound] escuchando en :${puerto}`);
});
