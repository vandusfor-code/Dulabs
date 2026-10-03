/**
 * FASE 3B.9A — genera supabase/provisioning/aslc/02_aprovisionar_sin_activar.sql desde lib/agente/aprovisionamiento.ts.
 * No se conecta a ninguna base de datos: solo escribe el archivo (que el dueño revisa y corre). Una prueba verifica que el archivo
 * del repositorio es exactamente la salida de esta función.
 *
 *   npx tsx scripts/generar-aprovisionamiento-aslc.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generarSqlAprovisionamiento, pendientesActualesAslc } from "@/lib/agente/aprovisionamiento";

const destino = join(process.cwd(), "supabase", "provisioning", "aslc", "02_aprovisionar_sin_activar.sql");
writeFileSync(destino, generarSqlAprovisionamiento(), "utf8");
console.log(`escrito: ${destino}`);
console.log("pendientes de la configuración completa:");
for (const p of pendientesActualesAslc()) console.log(`  ${p.categoria}  ${p.campo}`);
