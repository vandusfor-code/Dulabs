import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITMO = "aes-256-gcm";
const PREFIJO_VERSION = "v1";

function obtenerClave(): Buffer {
  const clave = process.env.TOKEN_ENCRYPTION_KEY;
  if (!clave) {
    throw new Error("Falta TOKEN_ENCRYPTION_KEY en las variables de entorno");
  }
  const buffer = Buffer.from(clave, "base64");
  if (buffer.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY debe decodificar a 32 bytes (AES-256) en base64");
  }
  return buffer;
}

// Cifra un secreto (token de Meta, API key de IA) antes de guardarlo en la
// base de datos — así la base por sí sola (un backup, un dump, o la
// service-role key filtrada) no expone el valor real, hace falta también
// TOKEN_ENCRYPTION_KEY, que vive solo en las variables de entorno del
// servidor. Formato: "v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>" — el
// prefijo de versión permite rotar de algoritmo/clave más adelante sin
// romper los valores ya guardados.
export function cifrarSecreto(texto: string): string {
  const iv = randomBytes(12); // GCM recomienda IV de 12 bytes
  const cipher = createCipheriv(ALGORITMO, obtenerClave(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIJO_VERSION}:${iv.toString("base64")}:${authTag.toString("base64")}:${cifrado.toString("base64")}`;
}

// Descifra un valor cifrado con cifrarSecreto(). Tolera valores legacy sin
// el prefijo "v1:" (texto plano guardado antes de este cambio) y los
// devuelve tal cual — necesario para que el despliegue de este cambio no
// dependa de correr primero el script de backfill (scripts/cifrar-tokens-existentes.mjs).
export function descifrarSecreto(valor: string): string {
  const partes = valor.split(":");
  if (partes.length !== 4 || partes[0] !== PREFIJO_VERSION) {
    return valor; // valor legacy en texto plano
  }
  const [, ivB64, authTagB64, cifradoB64] = partes;
  const decipher = createDecipheriv(ALGORITMO, obtenerClave(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const descifrado = Buffer.concat([decipher.update(Buffer.from(cifradoB64, "base64")), decipher.final()]);
  return descifrado.toString("utf8");
}
