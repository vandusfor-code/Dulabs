#!/usr/bin/env node
// FASE F12 (Debt Zero, autorizado) — reemplaza la lista gigante de archivos
// que package.json's "test:flow" pasaba como argumentos de línea de
// comandos. Hallazgo real: esa lista ya superaba el límite práctico de
// línea de comandos de Windows (cmd.exe, ~8191 caracteres -- el límite real
// de CreateProcess de Windows es ~32.767, pero `npx` invoca a través de un
// shim de cmd.exe que reintroduce ese límite menor), así que `npm run
// test:flow` fallaba en arrancar ("La línea de comandos es demasiado
// larga") apenas se agregaba cualquier archivo más.
//
// Solución: la lista curada de archivos vive en scripts/test-flow-manifest.txt
// (una ruta por línea, editable/diffable de verdad -- agregar un test nuevo
// es agregar una línea ahí, nunca tocar este script ni package.json). Este
// script lee ese manifiesto y lanza `tsx`'s propio CLI directamente vía
// child_process.spawn con un ARREGLO de argumentos (nunca una cadena de
// shell) -- eso evita por completo el shim de cmd.exe de npx, así que el
// límite real que aplica vuelve a ser el de CreateProcess (~32.767
// caracteres), muy por encima de lo que esta lista necesita.
//
// A propósito NO es un glob automático sobre **/*.test.ts: worker/src/**
// (ej. whatsapp-qr/manager.test.ts) NUNCA debe correr acá -- ya causó un
// incidente real contra AMORE (misma Supabase que producción). Un glob
// global lo incluiría por accidente en cuanto alguien lo agregara sin
// darse cuenta. La lista manual explícita es la protección real.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifiestoPath = path.join(raizRepo, "scripts", "test-flow-manifest.txt");

const lineas = readFileSync(manifiestoPath, "utf8").split("\n");
const archivos = lineas
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

if (archivos.length === 0) {
  console.error(`[run-test-flow] el manifiesto ${manifiestoPath} no tiene ningún archivo -- abortando.`);
  process.exit(1);
}

const faltantes = archivos.filter((f) => !existsSync(path.join(raizRepo, f)));
if (faltantes.length > 0) {
  console.error("[run-test-flow] estos archivos del manifiesto ya no existen en el repo:");
  for (const f of faltantes) console.error(`  - ${f}`);
  process.exit(1);
}

const tsxCli = require.resolve("tsx/cli");
// FASE F12 -- --test-concurrency limita cuántos archivos corren en paralelo
// de verdad (node:test por defecto usa un valor alto basado en CPUs).
// Hallazgo real de esta oleada: con concurrencia sin acotar, exactamente 1
// test (uno distinto cada vez) de los ~15 archivos que hacen integración
// real contra Supabase fallaba por timing bajo carga completa, aunque
// siempre pasaba limpio en aislado -- contención real de red/conexiones
// concurrentes, no un bug de lógica. Un tope moderado reduce esa
// contención sin alargar la suite de forma notable (la mayoría de los
// ~3500 tests son puros, sin I/O).
const resultado = spawnSync(process.execPath, [tsxCli, "--test", "--test-concurrency=4", ...archivos], {
  cwd: raizRepo,
  stdio: "inherit",
  // shell:false (default) es lo que evita el shim de cmd.exe de npx --
  // CreateProcess recibe el argv como arreglo real, no como una cadena que
  // haya que volver a parsear.
});

process.exit(resultado.status ?? 1);
