/**
 * FASE 3B.9A / 3B.9D — genera los SQL de supabase/provisioning/aslc/ desde lib/agente/aprovisionamiento.ts (02) y lib/agente/activacion-aslc.ts
 * (03, 05, 06, 07, 08, 09, 10, 11 y 12). No se conecta a ninguna base de datos: solo escribe los archivos (que el dueño revisa y corre). Una prueba verifica
 * que cada archivo del repositorio es exactamente la salida de su función. Los textos del negocio (el aviso obligatorio, la respuesta tras el "sí", la
 * ubicación y la respuesta a quien desconfía) se leen de textos-aprobados.json: el código no trae ninguno (los mensajes de aceptado / rechazado / cancelado
 * son opcionales ahí: sin ellos rige la propuesta de TEXTOS_ASLC). El aviso se verifica byte a byte (SHA-256) antes de escribir nada.
 *
 *   npx tsx scripts/generar-aprovisionamiento-aslc.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generarSqlAprovisionamiento, pendientesActualesAslc } from "@/lib/agente/aprovisionamiento";
import { archivosDeActivacion, verificarTextosAprobados, type TextosAprobadosAslc } from "@/lib/agente/activacion-aslc";

const carpeta = join(process.cwd(), "supabase", "provisioning", "aslc");

const json = JSON.parse(readFileSync(join(carpeta, "textos-aprobados.json"), "utf8")) as Partial<Record<keyof TextosAprobadosAslc, unknown>>;
const textos = {
  aviso: json.aviso,
  tras_aviso_confirma: json.tras_aviso_confirma,
  ubicacion: json.ubicacion,
  desconfianza: json.desconfianza,
  aceptado: json.aceptado,
  rechazado: json.rechazado,
  cancelado: json.cancelado,
} as TextosAprobadosAslc;
verificarTextosAprobados(textos);

const archivos: Record<string, string> = { "02_aprovisionar_sin_activar.sql": generarSqlAprovisionamiento(), ...archivosDeActivacion(textos) };
for (const [nombre, sql] of Object.entries(archivos)) {
  writeFileSync(join(carpeta, nombre), sql, "utf8");
  console.log(`escrito: ${join(carpeta, nombre)}`);
}
console.log("pendientes de la configuración completa base (sin las decisiones adoptadas):");
for (const p of pendientesActualesAslc()) console.log(`  ${p.categoria}  ${p.campo}`);
