// Tabla antes/después (p50 ms, consultas y KB de la BD) a partir de los JSON de bench.ts.
// Uso: node scripts/perf/comparar.mjs 2k-antes.json 2k-despues.json 10k-antes.json 10k-despues.json
import { readFileSync } from "node:fs";
const [a2, d2, a10, d10] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const idx = (xs) => Object.fromEntries(xs.map((x) => [x.operacion.replace(/ \(hay \d+\)/, ""), x]));
const [A2, D2, A10, D10] = [a2, d2, a10, d10].map(idx);
console.log("| Operación | 2.000 antes | 2.000 después | 10.000 antes | 10.000 después | consultas (10k) | KB BD (10k) |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const k of Object.keys(A10)) {
  const f = (x) => (x ? (x.nota && x.p50 === 0 ? `máx ${x.max}` : x.p50) : "");
  const c = (x, y) => (x && y && (x.consultas || y.consultas) ? `${x.consultas} → ${y.consultas}` : "");
  const b = (x, y) => (x && y && (x.kb_bd || y.kb_bd) ? `${x.kb_bd} → ${y.kb_bd}` : "");
  console.log(`| ${k} | ${f(A2[k])} | ${f(D2[k])} | ${f(A10[k])} | ${f(D10[k])} | ${c(A10[k], D10[k])} | ${b(A10[k], D10[k])} |`);
}
console.log("\nConcurrencia (después, 10.000):");
for (const x of d10) if (x.nota && x.operacion.startsWith("concurrente")) console.log(`- ${x.operacion}: ${x.nota}`);
console.log("\nConcurrencia (antes, 10.000):");
for (const x of a10) if (x.nota && x.operacion.startsWith("concurrente")) console.log(`- ${x.operacion}: ${x.nota}`);
