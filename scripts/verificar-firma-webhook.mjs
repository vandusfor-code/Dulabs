// Prueba unitaria de la verificación de firma del webhook (lib/meta-firma.ts).
//
// No necesita el App Secret REAL de Meta: firma un payload de ejemplo con el
// secreto que tenga configurado (o uno de prueba) y comprueba que la MISMA
// función que usa el webhook en producción acepta la firma correcta y rechaza
// todo lo demás — incluida una firma de longitud distinta, que sin el
// length-check haría lanzar timingSafeEqual.
//
// Uso:
//   node scripts/verificar-firma-webhook.mjs
//       → usa un META_APP_SECRET de prueba (suficiente: firma y verifica con el mismo)
//   node scripts/verificar-firma-webhook.mjs .env.prueba-firma
//       → carga META_APP_SECRET real de ese archivo, para probar con el valor de producción

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { verificarFirmaMeta } from "../lib/meta-firma.ts";

const envFile = process.argv[2];
if (envFile) {
  for (const linea of readFileSync(envFile, "utf8").split("\n")) {
    const m = linea.match(/^([A-Z_][A-Z0-9_]*)=["']?(.*?)["']?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!process.env.META_APP_SECRET) {
  process.env.META_APP_SECRET = "app-secret-de-prueba-local";
  console.log("(usando META_APP_SECRET de prueba — la firma se valida contra sí misma)\n");
}
const secret = process.env.META_APP_SECRET;

const payload = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "123", changes: [{ field: "messages", value: {} }] }],
});
const firmar = (cuerpo, clave = secret) =>
  "sha256=" + createHmac("sha256", clave).update(cuerpo, "utf8").digest("hex");

const firmaValida = firmar(payload);

const casos = [
  ["firma válida ACEPTA", verificarFirmaMeta(payload, firmaValida) === true],
  ["body manipulado RECHAZA", verificarFirmaMeta(payload + " ", firmaValida) === false],
  ["sin cabecera RECHAZA", verificarFirmaMeta(payload, null) === false],
  ["cabecera vacía RECHAZA", verificarFirmaMeta(payload, "") === false],
  ["sin prefijo sha256= RECHAZA", verificarFirmaMeta(payload, firmaValida.slice(7)) === false],
  ["firma más CORTA no lanza y RECHAZA", verificarFirmaMeta(payload, "sha256=abcd") === false],
  ["hex inválido no lanza y RECHAZA", verificarFirmaMeta(payload, "sha256=zzzz") === false],
  ["firma de OTRO secreto RECHAZA", verificarFirmaMeta(payload, firmar(payload, "otro-secreto")) === false],
];

let fallos = 0;
for (const [nombre, ok] of casos) {
  if (!ok) fallos++;
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${nombre}`);
}

console.log(`\n${fallos === 0 ? "✅" : "❌"} ${casos.length - fallos}/${casos.length} pruebas pasaron`);
process.exit(fallos === 0 ? 0 : 1);
