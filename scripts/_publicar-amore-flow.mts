/**
 * AMORE — Fase 2 (autorizado). Publica el flow del asistente conversacional
 * y conecta el tenant real de AMORE al runtime (flow_activo=true, flow_id).
 * Mismo mecanismo exacto ya usado para Solotalento (createFlow/createFlowVersion/
 * publishFlowVersion, ver scripts/_publicar-solotalento-v2-produccion.mts).
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFlow, createFlowVersion, publishFlowVersion, getFlowById } from "@/lib/flow/flow-store";
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

async function main() {
  const definition = amoreRouterFlow();

  const flow = await createFlow(supabase, { tenantId: TENANT_ID, slug: "amore-asistente", name: "AMORE — Asistente" });
  const version = await createFlowVersion(supabase, { tenantId: TENANT_ID, flowId: flow.id, versionNumber: 1, definition });
  await publishFlowVersion(supabase, TENANT_ID, flow.id, version.id);

  const { error: cfgErr } = await supabase
    .from("dulabs_clientes_config")
    .update({ flow_activo: true, flow_id: flow.id, updated_at: new Date().toISOString() })
    .eq("id_tenant", TENANT_ID);
  if (cfgErr) throw new Error(`dulabs_clientes_config: ${cfgErr.message}`);

  const flowAfter = await getFlowById(supabase, TENANT_ID, flow.id);

  console.log(
    JSON.stringify(
      {
        flowId: flow.id,
        versionId: version.id,
        status: flowAfter?.status,
        publishedVersionId: flowAfter?.published_version_id,
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
