/**
 * Siembra real (autorizado) de la base de conocimiento de AMORE en
 * dulabs_bot_conocimiento. Requiere que la migración
 * supabase/migrations/20260913000000_dulabs_bot_conocimiento.sql ya esté
 * aplicada.
 *
 * Matching SEGURO por nombre EXACTO contra dulabs_servicios -- nunca
 * aproximado. Si una ficha del seed no encuentra un servicio real con ese
 * nombre exacto, se reporta y se OMITE (nunca se inserta a ciegas; el FK
 * real de la tabla lo rechazaría de todas formas).
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AMORE_CONOCIMIENTO_SEED } from "@/lib/bot-escenarios/seed-conocimiento-amore";

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

// Verificación defensiva explícita (autorizado) -- estos NUNCA deben tener
// ficha, ni siquiera si alguien los agregara por error al seed en el futuro.
const NOMBRES_PROHIBIDOS = ["Secado Rapido", "Secado Rápido", "Base Ruber", "Base Rubber", "Acrilicas", "Acrílicas"];

async function main() {
  const prohibidosEnSeed = AMORE_CONOCIMIENTO_SEED.filter((f) => NOMBRES_PROHIBIDOS.includes(f.nombreServicioReal));
  if (prohibidosEnSeed.length > 0) {
    throw new Error(`El seed contiene nombres prohibidos (no deben tener ficha): ${prohibidosEnSeed.map((f) => f.nombreServicioReal).join(", ")}`);
  }

  const { data: servicios, error } = await supabase
    .from("dulabs_servicios")
    .select("id, nombre")
    .eq("id_tenant", AMORE_TENANT)
    .eq("activo", true);
  if (error) throw error;

  console.log(`Servicios reales activos de AMORE: ${servicios.length}`);
  for (const prohibido of NOMBRES_PROHIBIDOS) {
    const existe = servicios.some((s) => s.nombre === prohibido);
    console.log(`  ¿"${prohibido}" existe en el catálogo real? ${existe ? "SÍ (revisar)" : "No (correcto)"}`);
  }

  const idPorNombre = new Map(servicios.map((s) => [s.nombre, s.id as string]));

  const filas: Array<{ tenant_id: string; servicio_id: string; fuente: string; que_es: string; para_que_sirve: string; limites: string }> = [];
  const omitidas: string[] = [];

  for (const ficha of AMORE_CONOCIMIENTO_SEED) {
    const servicioId = idPorNombre.get(ficha.nombreServicioReal);
    if (!servicioId) {
      omitidas.push(ficha.nombreServicioReal);
      continue;
    }
    filas.push({
      tenant_id: AMORE_TENANT,
      servicio_id: servicioId,
      fuente: ficha.fuente,
      que_es: ficha.queEs,
      para_que_sirve: ficha.paraQueSirve,
      limites: ficha.limites,
    });
  }

  console.log(`\nFichas a sembrar: ${filas.length} de ${AMORE_CONOCIMIENTO_SEED.length} en el seed.`);
  if (omitidas.length > 0) {
    console.log(`Omitidas (no se encontró servicio real con ese nombre exacto): ${omitidas.join(", ")}`);
  }
  const nombresReales = new Set(servicios.map((s) => s.nombre));
  const sinFicha = [...nombresReales].filter((n) => !AMORE_CONOCIMIENTO_SEED.some((f) => f.nombreServicioReal === n));
  if (sinFicha.length > 0) {
    console.log(`Servicios reales SIN ficha de conocimiento (quedarán honestos, sin inventar): ${sinFicha.join(", ")}`);
  }

  if (DRY_RUN) {
    console.log("\nDRY_RUN=1 -- no se escribió nada. Corre con DRY_RUN=0 para sembrar de verdad.");
    return;
  }

  const { error: upsertError } = await supabase.from("dulabs_bot_conocimiento").upsert(filas, { onConflict: "tenant_id,servicio_id" });
  if (upsertError) throw upsertError;
  console.log("Sembrado OK.");
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
