/**
 * Siembra real (autorizado) del banco de escenarios de AMORE en
 * dulabs_bot_escenarios. Requiere que la migración
 * supabase/migrations/20260912000000_dulabs_bot_escenarios.sql ya esté
 * aplicada. Upsert por (tenant_id, codigo) -- correr este script de nuevo
 * (tras editar seed-amore.ts) actualiza las filas existentes sin duplicar.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";

const envLocal = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envLocal.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const AMORE_TENANT = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";
const DRY_RUN = process.env.DRY_RUN !== "0";

async function main() {
  const filas = AMORE_ESCENARIOS_SEED.map((e) => ({
    tenant_id: AMORE_TENANT,
    codigo: e.codigo,
    nombre: e.nombre,
    modo: e.modo,
    prioridad: e.prioridad,
    activo: e.activo,
    variantes: e.variantes,
    respuestas: e.respuestas,
    config: e.config,
  }));

  console.log(`${filas.length} escenarios a sembrar para AMORE (${AMORE_TENANT}).`);
  if (DRY_RUN) {
    console.log("DRY_RUN=1 -- no se escribió nada. Corre con DRY_RUN=0 para sembrar de verdad.");
    console.log(filas.map((f) => `${f.prioridad.toString().padStart(4, " ")}  ${f.codigo}  (${f.modo})`).join("\n"));
    return;
  }

  const { error } = await supabase.from("dulabs_bot_escenarios").upsert(filas, { onConflict: "tenant_id,codigo" });
  if (error) throw error;
  console.log("Sembrado OK.");
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
