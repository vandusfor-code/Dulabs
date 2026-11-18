#!/usr/bin/env node
// VALIDAR EL AGENTE DE LA JOYERÍA SIN GASTAR UN PESO — un solo comando.
//
//   npm run validar:agente              todo (pruebas del agente y sus piezas + 4 evaluaciones simuladas): ~10 min
//   npm run validar:agente -- --rapido  sin las pruebas con Postgres embebido (las de los SQL de aprovisionamiento): ~2 min
//   npm run validar:agente -- --detalle muestra la salida completa de cada paso (por defecto, solo el resumen y lo que falló)
//
// Qué corre (NADA toca Gemini, Meta ni Supabase: proveedor simulado, almacenes en memoria, negocio ficticio):
//   1. Las pruebas del manifiesto (scripts/test-flow-manifest.txt) del agente y de todo lo que toca: el runtime, el proveedor de IA, el catálogo, el CMS comercial, el webhook y el piloto.
//   2. Las 4 evaluaciones SIMULADAS: comercial y lenguaje, con el modelo «cooperativo» (hace lo correcto: todo debe dar PASS) y «adversario» (se equivoca a propósito: ninguna equivocación
//      puede llegar al cliente: 0 FAIL, lo que la protección frena aparece como BLOCKED-SAFE).
// Con todo en verde, el agente está listo hasta donde se puede saber SIN el modelo real: lo que queda es la prueba con Gemini real (docs/AGENTE_JOYERIA.md, «Con saldo»), que sí consume crédito
// y por eso tiene su propio tope de gasto (--estimar, --presupuesto-tokens).
//
// Nunca lee .env ni variables de claves: las evaluaciones simuladas no las usan. Sale con 0 solo si TODO pasó.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Set(process.argv.slice(2));
const RAPIDO = args.has("--rapido");
const DETALLE = args.has("--detalle");
const tsxCli = require.resolve("tsx/cli");

/** Lo que cuenta como «el agente y lo que toca»: las mismas carpetas que el diseño del agente (lib/agente/README.md). */
const PREFIJOS = ["lib/agente/", "lib/ia-proveedores/", "lib/cms-comercial/", "lib/catalogo/", "app/webhook-dulabs/", "scripts/piloto/", "scripts/eval/"];

const manifiesto = readFileSync(path.join(raiz, "scripts", "test-flow-manifest.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const faltantes = manifiesto.filter((f) => !existsSync(path.join(raiz, f)));
if (faltantes.length > 0) {
  console.error("[validar-agente] estos archivos del manifiesto ya no existen:\n  - " + faltantes.join("\n  - "));
  process.exit(1);
}
const pruebas = manifiesto.filter((f) => PREFIJOS.some((p) => f.startsWith(p)) && !(RAPIDO && f.includes(".pglite.")));

const carpetaLogs = path.join(tmpdir(), `validar-agente-${Date.now()}`);
mkdirSync(carpetaLogs, { recursive: true });

/** @type {Array<{nombre: string, ok: boolean, segundos: number, resumen: string, log: string}>} */
const resultados = [];

function correr(nombre, argv, resumir) {
  const t0 = Date.now();
  console.log(`\n▶ ${nombre}`);
  const r = spawnSync(process.execPath, [tsxCli, ...argv], { cwd: raiz, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0" } });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const log = path.join(carpetaLogs, `${resultados.length + 1}-${nombre.replace(/[^a-z0-9]+/gi, "_")}.log`);
  writeFileSync(log, salida);
  if (DETALLE) process.stdout.write(salida);
  const ok = r.status === 0;
  const segundos = Math.round((Date.now() - t0) / 1000);
  const resumen = resumir(salida);
  console.log(`${ok ? "✔" : "✖"} ${nombre} — ${resumen} (${segundos} s)`);
  if (!ok && !DETALLE) console.log(salida.split("\n").filter(Boolean).slice(-25).join("\n"));
  resultados.push({ nombre, ok, segundos, resumen, log });
}

const linea = (salida, re) => salida.split("\n").find((l) => re.test(l))?.trim() ?? "";
const cuenta = (salida, clave) => salida.match(new RegExp(`^ℹ ${clave} (\\d+)`, "m"))?.[1] ?? "?";

correr(`Pruebas (${pruebas.length} archivos${RAPIDO ? ", sin Postgres embebido" : ""})`, ["--test", "--test-concurrency=4", ...pruebas], (s) => `${cuenta(s, "pass")} de ${cuenta(s, "tests")} pasan, ${cuenta(s, "fail")} fallan`);

for (const [script, etiqueta] of [
  ["gemini-comercial", "Evaluación comercial"],
  ["gemini-lenguaje", "Evaluación de lenguaje"],
]) {
  for (const modo of ["cooperativo", "adversario"]) {
    correr(`${etiqueta} · modelo ${modo}`, [`scripts/eval/${script}.ts`, `--${modo}`], (s) => linea(s, /^Modo /).replace(/^Modo \w+: /, "") || "sin resumen");
  }
}

console.log("\n──────────────── Resumen ────────────────");
for (const r of resultados) console.log(`${r.ok ? "✔" : "✖"} ${r.nombre} · ${r.resumen} · ${r.segundos} s`);
const todoOk = resultados.every((r) => r.ok);
console.log(
  todoOk
    ? "\n✔ TODO EN VERDE. El agente está listo hasta donde se puede saber sin el modelo real.\n  Siguiente: la prueba con Gemini real, cuando haya saldo → docs/AGENTE_JOYERIA.md («Con saldo»). Antes de gastar:  npx tsx scripts/eval/gemini-comercial.ts --real 2 --estimar"
    : "\n✖ HAY FALLAS. Los registros completos están en " + carpetaLogs + " (o repite con --detalle).",
);
process.exit(todoOk ? 0 : 1);
