// Cifra en el sitio cualquier meta_permanent_token / api_key_ia que todavía
// esté en texto plano en dulabs_clientes_config (de antes de que el código
// empezara a cifrar estos campos — ver lib/crypto.ts).
//
// Seguro de correr más de una vez: cualquier valor que ya empiece con "v1:"
// se salta. No hace falta correrlo antes de desplegar el código nuevo (el
// descifrado tolera texto plano legacy), pero sí hay que correrlo para que
// los tokens existentes queden protegidos de verdad.
//
// Uso:  node scripts/cifrar-tokens-existentes.mjs [ruta-al-archivo-env]
//       (por defecto lee .env.local; debe incluir SUPABASE_URL,
//       SUPABASE_SERVICE_ROLE_KEY y TOKEN_ENCRYPTION_KEY)

import { readFileSync } from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const envFile = process.argv[2] ?? ".env.local";
const env = {};
for (const linea of readFileSync(envFile, "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_][A-Z0-9_]*)=["']?(.*?)["']?\s*$/);
  if (m) env[m[1]] = m[2];
}

const URL_SUPABASE = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const CLAVE_CIFRADO = env.TOKEN_ENCRYPTION_KEY;
if (!URL_SUPABASE || !SERVICE_KEY || !CLAVE_CIFRADO) {
  console.error(`Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TOKEN_ENCRYPTION_KEY en ${envFile}`);
  process.exit(1);
}

const claveBuffer = Buffer.from(CLAVE_CIFRADO, "base64");
if (claveBuffer.length !== 32) {
  console.error("TOKEN_ENCRYPTION_KEY debe decodificar a 32 bytes (AES-256) en base64");
  process.exit(1);
}

function cifrarSecreto(texto) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", claveBuffer, iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${cifrado.toString("base64")}`;
}

function yaCifrado(valor) {
  return typeof valor === "string" && valor.split(":").length === 4 && valor.startsWith("v1:");
}

const supabase = createClient(URL_SUPABASE, SERVICE_KEY, { auth: { persistSession: false } });

const { data: filas, error } = await supabase
  .from("dulabs_clientes_config")
  .select("id, nombre_negocio, meta_permanent_token, api_key_ia");
if (error) {
  console.error("Error leyendo dulabs_clientes_config:", error.message);
  process.exit(1);
}

let actualizados = 0;
let saltados = 0;

for (const fila of filas ?? []) {
  const cambios = {};
  if (fila.meta_permanent_token && !yaCifrado(fila.meta_permanent_token)) {
    cambios.meta_permanent_token = cifrarSecreto(fila.meta_permanent_token);
  }
  if (fila.api_key_ia && !yaCifrado(fila.api_key_ia)) {
    cambios.api_key_ia = cifrarSecreto(fila.api_key_ia);
  }

  if (Object.keys(cambios).length === 0) {
    saltados++;
    continue;
  }

  const { error: updateError } = await supabase.from("dulabs_clientes_config").update(cambios).eq("id", fila.id);
  if (updateError) {
    console.error(`Error cifrando fila de "${fila.nombre_negocio}" (id ${fila.id}):`, updateError.message);
    continue;
  }
  actualizados++;
  console.log(`Cifrado: "${fila.nombre_negocio}" (id ${fila.id}) — ${Object.keys(cambios).join(", ")}`);
}

console.log(`\nListo. ${actualizados} fila(s) cifrada(s), ${saltados} ya estaban cifradas o sin secretos.`);
