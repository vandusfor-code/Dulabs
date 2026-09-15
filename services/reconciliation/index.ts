import { createClient } from "@supabase/supabase-js";
import { ejecutarReconciliacion } from "./run";

// DuLabs Developer V1 -- Fase 3. Entrypoint del Cloud Run Job
// dulabs-reconciliation. Se ejecuta hasta terminar y sale -- no es un
// servidor HTTP (Cloud Run Jobs no lo requieren).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_GRAPH_API_BASE_URL = process.env.META_GRAPH_API_BASE_URL ?? "https://graph.facebook.com";
const TOPIC_INBOUND = process.env.PUBSUB_TOPIC_INBOUND ?? "dulabs-inbound";
const TOPIC_OUTBOUND = process.env.PUBSUB_TOPIC_OUTBOUND ?? "dulabs-outbound";

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("[reconciliation] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const resumen = await ejecutarReconciliacion({ supabase, metaGraphApiBaseUrl: META_GRAPH_API_BASE_URL, topicInbound: TOPIC_INBOUND, topicOutbound: TOPIC_OUTBOUND });

  console.log(
    JSON.stringify({
      evento: "reconciliation_ejecutada",
      jobsRevisados: resumen.reconciliacionOutbound.length,
      eventosRecuperados: resumen.recoveryInbound.length,
      jobsReintentados: resumen.reintentoOutbound.length,
      detalleOutbound: resumen.reconciliacionOutbound,
      detalleInbound: resumen.recoveryInbound,
      detalleReintento: resumen.reintentoOutbound,
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reconciliation] error fatal:", err);
    process.exit(1);
  });
