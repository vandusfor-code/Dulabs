/**
 * Publica la nueva versión del flow de AMORE (banco de escenarios,
 * lib/flows/amore-router.flow.ts) -- reemplaza el diseño anterior
 * (cadena de 2-3 llamadas IA por turno, parcheado varias veces por scripts
 * one-off) con el nuevo grafo, mucho más simple, que resuelve la mayoría de
 * los turnos sin ninguna llamada a Claude. Usa el MISMO mecanismo real de
 * publicación que ya usa el Flow Builder (createFlowVersion/publishFlowVersion),
 * validado antes con validateFlowForPublish (Claim Security incluida).
 *
 * REQUIERE que la migración de dulabs_bot_escenarios y el seed de AMORE
 * (_seed-escenarios-amore.mts, DRY_RUN=0) ya hayan corrido -- si no, la
 * primera conversación real fallaría al no encontrar ni siquiera el
 * escenario de fallback.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getFlowById, createFlowVersion, publishFlowVersion, getFlowVersion } from "@/lib/flow/flow-store";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { amoreRouterFlow } from "@/lib/flows/amore-router.flow";

const envLocal = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envLocal.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const AMORE_TENANT = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";
const AMORE_FLOW_ID = "6c4b2cd8-3471-480e-9302-40c4b184b456";
const DRY_RUN = process.env.DRY_RUN !== "0";

async function main() {
  const def = amoreRouterFlow();
  const validacion = validateFlowForPublish(def);
  console.log("VALIDACION:", JSON.stringify(validacion, null, 2));
  if (!validacion.valid) {
    console.error("Definición inválida, no se publica nada.");
    process.exit(1);
  }

  const flow = await getFlowById(supabase, AMORE_TENANT, AMORE_FLOW_ID);
  if (!flow?.published_version_id) throw new Error("AMORE no tiene versión publicada actual (esperado al menos una previa)");
  const actual = await getFlowVersion(supabase, AMORE_TENANT, flow.published_version_id);
  if (!actual) throw new Error("No se encontró la versión publicada actual");

  if (DRY_RUN) {
    console.log(`DRY_RUN=1 -- validación OK. Publicaría v${(actual.version_number as number) + 1}. Corre con DRY_RUN=0 para publicar de verdad.`);
    return;
  }

  const version = await createFlowVersion(supabase, {
    tenantId: AMORE_TENANT,
    flowId: AMORE_FLOW_ID,
    versionNumber: (actual.version_number as number) + 1,
    definition: def,
  });
  await publishFlowVersion(supabase, AMORE_TENANT, AMORE_FLOW_ID, version.id);
  const versionAfter = await getFlowVersion(supabase, AMORE_TENANT, version.id);
  console.log("PUBLICADO:", JSON.stringify({ versionId: version.id, versionNumber: version.version_number, publishedAt: versionAfter?.published_at }, null, 2));
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
