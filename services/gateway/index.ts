import { createClient } from "@supabase/supabase-js";
import { crearServidorGateway } from "./server";
import { leerSecreto } from "../shared/secret-manager";

// DuLabs Developer V1 -- Fase 3. Bootstrap del servicio Cloud Run
// dulabs-gateway. Lee los secretos de infraestructura reales de Secret
// Manager al arrancar (no variables de entorno planas) -- sección K del
// documento.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GCP_PROJECT = process.env.GCP_PROJECT ?? "dulabs-developer-v1";
const TOPIC_OUTBOUND = process.env.PUBSUB_TOPIC_OUTBOUND ?? "dulabs-outbound";
const TOPIC_INBOUND = process.env.PUBSUB_TOPIC_INBOUND ?? "dulabs-inbound";

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("[gateway] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  }

  const [metaAppSecret, metaVerifyToken] = await Promise.all([leerSecreto(GCP_PROJECT, "meta-app-secret"), leerSecreto(GCP_PROJECT, "meta-webhook-verify-token")]);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const servidor = crearServidorGateway({
    supabase,
    topicOutbound: TOPIC_OUTBOUND,
    topicInbound: TOPIC_INBOUND,
    metaAppSecret,
    metaVerifyToken,
  });

  const puerto = Number(process.env.PORT ?? 8080);
  servidor.listen(puerto, () => {
    console.log(`[gateway] escuchando en :${puerto}`);
  });
}

main().catch((err) => {
  console.error("[gateway] error fatal al arrancar:", err);
  process.exit(1);
});
