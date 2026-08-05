// Registra un número de dulabs en DuMo con su meta_permanent_token descifrado.
// DuMo lo guarda por phone_number_id y lo usa para enviar respuestas.
//
// Uso:
//   node scripts/registrar-numero-dumo.mjs [phone_number_id] [ruta-al-archivo-env]
//
// Requiere en el .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// TOKEN_ENCRYPTION_KEY, DUMO_FORWARD_SECRET

import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const phoneNumberId = process.argv[2] ?? "696346603563682";
const envFile = process.argv[3] ?? ".env.local";
const DUMO_REGISTER_URL = "https://du-mo.vercel.app/api/whatsapp/register-number";

const env = {};
for (const linea of readFileSync(envFile, "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_][A-Z0-9_]*)=["']?(.*?)["']?\s*$/);
  if (m) env[m[1]] = m[2];
}

const URL_SUPABASE = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const CLAVE_CIFRADO = env.TOKEN_ENCRYPTION_KEY;
const DUMO_SECRET = env.DUMO_FORWARD_SECRET;

if (!URL_SUPABASE || !SERVICE_KEY || !CLAVE_CIFRADO || !DUMO_SECRET) {
  console.error(
    `Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY o DUMO_FORWARD_SECRET en ${envFile}`,
  );
  process.exit(1);
}

const claveBuffer = Buffer.from(CLAVE_CIFRADO, "base64");
if (claveBuffer.length !== 32) {
  console.error("TOKEN_ENCRYPTION_KEY debe decodificar a 32 bytes (AES-256) en base64");
  process.exit(1);
}

function descifrarSecreto(valor) {
  const partes = valor.split(":");
  if (partes.length !== 4 || partes[0] !== "v1") return valor;
  const [, ivB64, authTagB64, cifradoB64] = partes;
  const decipher = createDecipheriv("aes-256-gcm", claveBuffer, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(cifradoB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

const sb = createClient(URL_SUPABASE, SERVICE_KEY);
const { data, error } = await sb
  .from("dulabs_clientes_config")
  .select("meta_permanent_token, nombre_negocio, telefono_negocio, whatsapp_business_account_id")
  .eq("phone_number_id", phoneNumberId)
  .maybeSingle();

if (error) {
  console.error("Error Supabase:", error.message);
  process.exit(1);
}
if (!data?.meta_permanent_token) {
  console.error(`Sin meta_permanent_token para phone_number_id ${phoneNumberId}`);
  process.exit(1);
}

const token = descifrarSecreto(data.meta_permanent_token);
const body = {
  phoneNumberId,
  displayPhone: data.telefono_negocio ? `+57 ${data.telefono_negocio}` : "+57 314 812 7388",
  wabaId: data.whatsapp_business_account_id ?? "1399061204706262",
  label: data.nombre_negocio ?? "Dulabs",
  accessToken: token,
};

console.log(`Registrando "${body.label}" (${phoneNumberId}) en DuMo...`);

const res = await fetch(DUMO_REGISTER_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-DuMo-Forward-Secret": DUMO_SECRET,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`DuMo respondió ${res.status}: ${text}`);

if (!res.ok) process.exit(1);

console.log("\nVerifica con:");
console.log(`  curl "https://du-mo.vercel.app/api/system/whatsapp?phoneNumberId=${phoneNumberId}"`);
