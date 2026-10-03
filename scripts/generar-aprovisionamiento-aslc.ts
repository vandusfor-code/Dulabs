/**
 * FASE 3B.9A / 3B.9D — genera los SQL de supabase/provisioning/aslc/ desde lib/agente/aprovisionamiento.ts (02) y lib/agente/activacion-aslc.ts
 * (03, 05, 06, 07, 08 y 09). No se conecta a ninguna base de datos: solo escribe los archivos (que el dueño revisa y corre). Una prueba verifica que
 * cada archivo del repositorio es exactamente la salida de su función. El aviso obligatorio se lee de textos-aprobados.json y se verifica byte a byte
 * (SHA-256) antes de escribir nada.
 *
 *   npx tsx scripts/generar-aprovisionamiento-aslc.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generarSqlAprovisionamiento, pendientesActualesAslc } from "@/lib/agente/aprovisionamiento";
import { archivosDeActivacion, verificarAviso } from "@/lib/agente/activacion-aslc";

const carpeta = join(process.cwd(), "supabase", "provisioning", "aslc");

const aviso = (JSON.parse(readFileSync(join(carpeta, "textos-aprobados.json"), "utf8")) as { aviso: string }).aviso;
verificarAviso(aviso);

const archivos: Record<string, string> = { "02_aprovisionar_sin_activar.sql": generarSqlAprovisionamiento(), ...archivosDeActivacion(aviso) };
for (const [nombre, sql] of Object.entries(archivos)) {
  writeFileSync(join(carpeta, nombre), sql, "utf8");
  console.log(`escrito: ${join(carpeta, nombre)}`);
}
console.log("pendientes de la configuración completa base (sin las decisiones adoptadas):");
for (const p of pendientesActualesAslc()) console.log(`  ${p.categoria}  ${p.campo}`);
