/**
 * AMORE — Fase 3 (autorizado). Prerequisito técnico encontrado al construir
 * el portal: planDelTenant() devuelve "sin_plan" sin ninguna fila en
 * dulabs_suscripciones, y TODAS las rutas del portal (bootstrap/especialistas/
 * disponibilidad/reservar) devuelven vacío/"no disponible" en ese caso -- el
 * portal no podría funcionar en absoluto sin esto. Mismo plan/estado que se
 * usó para Solotalento al onboarding (plan "start", estado "activa").
 * Ajustar plan/precio real es una decisión de negocio del cliente, no
 * asumida acá más allá de lo mínimo para que el portal funcione.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envLocal = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envLocal.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";

async function main() {
  const { data: existente } = await supabase.from("dulabs_suscripciones").select("id").eq("id_tenant", TENANT_ID).maybeSingle();
  if (existente) {
    console.log(JSON.stringify({ ok: true, nota: "ya existía una suscripción, no se creó otra", id: existente.id }));
    return;
  }
  const enUnAnio = new Date();
  enUnAnio.setFullYear(enUnAnio.getFullYear() + 1);
  const { data, error } = await supabase
    .from("dulabs_suscripciones")
    .insert({
      id_tenant: TENANT_ID,
      plan: "start",
      estado: "activa",
      precio_cop: 0,
      fecha_proximo_cobro: enUnAnio.toISOString().slice(0, 10),
      cortesia: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  console.log(JSON.stringify({ ok: true, id: data.id }));
}

main().catch((err) => {
  console.error("ERROR", err instanceof Error ? err.message : err);
  process.exit(1);
});
