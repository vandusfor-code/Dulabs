/**
 * AMORE — publica la versión 2 del flow (correcciones de texto por Claim
 * Security encontradas en lib/flows/amore-router.flow.test.ts: "agendar"/
 * "cita" bloqueados en 2 preguntas -- ver comentarios inline en
 * amore-router.flow.ts). Mismo mecanismo que _publicar-solotalento-v2-produccion.mts.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFlowVersion, publishFlowVersion, getFlowById, getFlowVersion } from "@/lib/flow/flow-store";
import { amoreRouterFlow } from "@/lib/flows/amore-router.flow";

const envLocal = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envLocal.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";
const AMORE_FLOW_ID = "6c4b2cd8-3471-480e-9302-40c4b184b456";

async function main() {
  const definition = amoreRouterFlow();
  const version = await createFlowVersion(supabase, { tenantId: TENANT_ID, flowId: AMORE_FLOW_ID, versionNumber: 2, definition });
  await publishFlowVersion(supabase, TENANT_ID, AMORE_FLOW_ID, version.id);

  const flowAfter = await getFlowById(supabase, TENANT_ID, AMORE_FLOW_ID);
  const versionAfter = await getFlowVersion(supabase, TENANT_ID, version.id);

  console.log(
    JSON.stringify(
      {
        flowId: flowAfter?.id,
        status: flowAfter?.status,
        publishedVersionId: flowAfter?.published_version_id,
        versionNumber: versionAfter?.version_number,
        coincide: flowAfter?.published_version_id === version.id,
        nodeCount: definition.nodes.length,
        edgeCount: definition.edges.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("ERROR", err instanceof Error ? err.message : err);
  process.exit(1);
});
