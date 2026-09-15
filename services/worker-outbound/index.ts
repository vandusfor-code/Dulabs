import { createClient } from "@supabase/supabase-js";
import { crearServidorWorkerOutbound } from "./server";

// DuLabs Developer V1 -- Fase 3. Bootstrap del servicio Cloud Run
// dulabs-outbound-worker. Cloud Run inyecta PORT automáticamente.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_GRAPH_API_BASE_URL = process.env.META_GRAPH_API_BASE_URL ?? "https://graph.facebook.com";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("[worker-outbound] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.");
}

// Protocolo/hostname validado explícitamente (sección 15 del brief de Fase
// 1: nunca facebook.com a secas, siempre https://graph.facebook.com o un
// override explícito para fixtures de test).
const urlGraph = new URL(META_GRAPH_API_BASE_URL);
if (urlGraph.protocol !== "https:" && process.env.NODE_ENV === "production") {
  throw new Error(`[worker-outbound] META_GRAPH_API_BASE_URL debe ser https:// en producción, recibido: ${META_GRAPH_API_BASE_URL}`);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const servidor = crearServidorWorkerOutbound({ supabase, metaGraphApiBaseUrl: META_GRAPH_API_BASE_URL });
const puerto = Number(process.env.PORT ?? 8080);
servidor.listen(puerto, () => {
  console.log(`[worker-outbound] escuchando en :${puerto}`);
});
