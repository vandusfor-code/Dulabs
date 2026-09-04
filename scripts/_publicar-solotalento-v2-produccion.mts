/**
 * Publica la versión 2 del flow REAL de producción de SOLOTALENTO SAS
 * (tenant/flow reales, NO el flow de laboratorio que usa
 * _publicar-solotalento-v2.mts) -- único cambio de contenido: el nuevo
 * saludo inicial pedido por la cliente (SOLOTALENTO_WELCOME_1). Mismo
 * mecanismo de bajo nivel ya usado para publicar la versión 1
 * (createFlowVersion/publishFlowVersion, ver lib/flow/flow-store.ts).
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFlowVersion, publishFlowVersion, getFlowById, getFlowVersion } from "@/lib/flow/flow-store";
import { solotalentoFlow } from "@/lib/flows/solotalento.flow";

const envLocal = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envLocal.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const TENANT_ID = "11ccf0a3-726b-4d4b-9f7d-2deb8441d6a9";
const SOLOTALENTO_FLOW_ID = "cd2d7ce7-b30a-4ec8-be0b-dce1e713822f";

async function main() {
  const definition = solotalentoFlow();

  const version = await createFlowVersion(supabase, {
    tenantId: TENANT_ID,
    flowId: SOLOTALENTO_FLOW_ID,
    versionNumber: 2,
    definition,
  });

  await publishFlowVersion(supabase, TENANT_ID, SOLOTALENTO_FLOW_ID, version.id);

  const flowAfter = await getFlowById(supabase, TENANT_ID, SOLOTALENTO_FLOW_ID);
  const versionAfter = await getFlowVersion(supabase, TENANT_ID, version.id);

  console.log(
    JSON.stringify(
      {
        flow: {
          id: flowAfter?.id,
          status: flowAfter?.status,
          published_version_id: flowAfter?.published_version_id,
        },
        nuevaVersion: {
          id: version.id,
          version_number: version.version_number,
        },
        versionPublicadaConfirmada: {
          id: versionAfter?.id,
          published_at: versionAfter?.published_at,
        },
        coincideConPublishedVersionId: flowAfter?.published_version_id === version.id,
        nodeCount: definition.nodes.length,
        edgeCount: definition.edges.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
