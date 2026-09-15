import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyManagementServiceClient } from "@google-cloud/kms";

// DuLabs Developer V1 -- Fase 1 (autorizado, sección 17 del brief), extendido
// en Fase 3 (autorizado, sección J del documento de infraestructura) con
// envelope encryption real contra Google Cloud KMS. Misma interfaz pública
// desde Fase 1 (cifrarSecretoDev/descifrarSecretoDev) -- se extiende, no se
// duplica, tal como exige el diseño.
//
// Selección de mecanismo, por entorno, nunca por elección del caller:
//   - KMS_KEY_NAME configurada (Cloud Run real, Fase 3) -> envelope
//     encryption real: una DEK aleatoria por operación, cifrada localmente
//     con AES-256-GCM, la propia DEK envuelta/desenvuelta vía KMS. Formato
//     `dev2:`. Esto es la ÚNICA ruta en producción -- KMS_KEY_NAME solo se
//     configura en los servicios de Cloud Run reales, nunca en local/CI.
//   - DEVELOPER_TOKEN_ENCRYPTION_KEY configurada (local/CI, sin acceso a
//     GCP) -> el mecanismo de Fase 1 sin cambios: AES-256-GCM con una clave
//     estática de entorno. Formato `dev1:`. Reservado EXCLUSIVAMENTE para
//     entornos sin GCP -- nunca la ruta válida en producción.
//   - Ninguna de las dos -> ClaveNoDisponibleError. FAIL CLOSED, sin
//     excepciones, exactamente igual que en Fase 1.
//
// Contradicción original que este archivo resuelve (sección 8.1 del
// documento de Fase 1): lib/crypto.ts (Business) tiene un fallback
// deliberado a texto plano para datos legado -- correcto para Business,
// prohibido acá. Developer V1 es greenfield (confirmado de nuevo en Fase 3:
// 0 filas reales en las tablas de secretos al momento del cutover a KMS),
// así que no hay ninguna razón de negocio para tolerar ese fallback.

const ALGORITMO = "aes-256-gcm";
const PREFIJO_DEV1 = "dev1";
const PREFIJO_DEV2 = "dev2";
const LONGITUD_IV = 12;
const LONGITUD_DEK = 32;

export class ClaveNoDisponibleError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ClaveNoDisponibleError";
  }
}

export class DescifradoFallidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DescifradoFallidoError";
  }
}

function obtenerClaveMaestraEstatica(): Buffer {
  const clave = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
  if (!clave) {
    throw new ClaveNoDisponibleError(
      "DEVELOPER_TOKEN_ENCRYPTION_KEY no está configurada. FAIL CLOSED: no existe ningún valor por defecto ni clave cero -- la operación se aborta."
    );
  }
  const buffer = Buffer.from(clave, "base64");
  if (buffer.length !== LONGITUD_DEK) {
    throw new ClaveNoDisponibleError(
      `DEVELOPER_TOKEN_ENCRYPTION_KEY tiene ${buffer.length} bytes tras decodificar base64; se requieren exactamente 32 (AES-256). FAIL CLOSED.`
    );
  }
  return buffer;
}

let clienteKms: KeyManagementServiceClient | null = null;
async function obtenerClienteKms(): Promise<KeyManagementServiceClient> {
  if (!clienteKms) {
    const { KeyManagementServiceClient } = await import("@google-cloud/kms");
    clienteKms = new KeyManagementServiceClient();
  }
  return clienteKms;
}

function nombreClaveKms(): string {
  const nombre = process.env.KMS_KEY_NAME;
  if (!nombre) {
    throw new ClaveNoDisponibleError("KMS_KEY_NAME no está configurada. FAIL CLOSED: sin ruta a KMS, la operación se aborta -- nunca se cae a una clave estática en producción.");
  }
  return nombre;
}

/** true si HAY algún mecanismo de cifrado disponible ahora mismo (KMS real o clave estática de entorno) -- para que un caller decida fallar closed antes de intentar cualquier operación. */
export function claveMaestraDisponible(): boolean {
  return Boolean(process.env.KMS_KEY_NAME) || Boolean(process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY);
}

async function cifrarConKms(texto: string): Promise<string> {
  const nombreClave = nombreClaveKms();
  const dek = randomBytes(LONGITUD_DEK);
  const iv = randomBytes(LONGITUD_IV);
  const cipher = createCipheriv(ALGORITMO, dek, iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  let dekEnvuelta: Buffer;
  try {
    const cliente = await obtenerClienteKms();
    const [respuesta] = await cliente.encrypt({ name: nombreClave, plaintext: dek });
    if (!respuesta.ciphertext) throw new Error("KMS no devolvió el ciphertext de la DEK envuelta");
    dekEnvuelta = Buffer.from(respuesta.ciphertext as Uint8Array);
  } catch (err) {
    // FAIL CLOSED: si KMS no responde o falla, nunca se cae a una clave
    // estática ni se persiste nada -- se propaga el error tal cual.
    throw new ClaveNoDisponibleError(`No se pudo envolver la DEK vía KMS. FAIL CLOSED: ${err instanceof Error ? err.message : String(err)}`);
  }

  return `${PREFIJO_DEV2}:${dekEnvuelta.toString("base64")}:${iv.toString("base64")}:${authTag.toString("base64")}:${cifrado.toString("base64")}`;
}

async function descifrarConKms(partes: string[]): Promise<string> {
  const [, dekEnvueltaB64, ivB64, authTagB64, cifradoB64] = partes;
  const nombreClave = nombreClaveKms();

  let dek: Buffer;
  try {
    const cliente = await obtenerClienteKms();
    const [respuesta] = await cliente.decrypt({ name: nombreClave, ciphertext: Buffer.from(dekEnvueltaB64, "base64") });
    if (!respuesta.plaintext) throw new Error("KMS no devolvió el plaintext de la DEK");
    dek = Buffer.from(respuesta.plaintext as Uint8Array);
  } catch (err) {
    throw new ClaveNoDisponibleError(`No se pudo desenvolver la DEK vía KMS. FAIL CLOSED: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const decipher = createDecipheriv(ALGORITMO, dek, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const descifrado = Buffer.concat([decipher.update(Buffer.from(cifradoB64, "base64")), decipher.final()]);
    return descifrado.toString("utf8");
  } catch (err) {
    throw new DescifradoFallidoError(
      `No se pudo descifrar el valor (posible manipulación, corrupción, o DEK incorrecta). FAIL CLOSED: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Cifra un secreto de Developer V1 (token de Meta, secreto de webhook,
 * etc.). Usa KMS real si `KMS_KEY_NAME` está configurada (producción);
 * si no, la clave estática de entorno (local/CI únicamente). Lanza
 * ClaveNoDisponibleError si ninguna está disponible o la operación de KMS
 * falla -- nunca cifra con una clave débil/por defecto, nunca cae a texto
 * plano.
 */
export async function cifrarSecretoDev(texto: string): Promise<string> {
  if (process.env.KMS_KEY_NAME) return cifrarConKms(texto);

  const iv = randomBytes(LONGITUD_IV);
  const cipher = createCipheriv(ALGORITMO, obtenerClaveMaestraEstatica(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIJO_DEV1}:${iv.toString("base64")}:${authTag.toString("base64")}:${cifrado.toString("base64")}`;
}

/**
 * Descifra un valor cifrado con cifrarSecretoDev() -- reconoce el formato
 * por el prefijo (`dev1:` estático, `dev2:` KMS), no por si `KMS_KEY_NAME`
 * está configurada ahora mismo (así un valor `dev2:` sigue siendo
 * descifrable si el entorno que lo escribió y el que lo lee son ambos
 * Cloud Run real). A diferencia de lib/crypto.ts::descifrarSecreto, NUNCA
 * devuelve el valor de entrada tal cual ante un formato inesperado.
 */
export async function descifrarSecretoDev(valor: string): Promise<string> {
  const partes = valor.split(":");
  const prefijo = partes[0];

  if (prefijo === PREFIJO_DEV2 && partes.length === 5) {
    return descifrarConKms(partes);
  }

  if (prefijo === PREFIJO_DEV1 && partes.length === 4) {
    const [, ivB64, authTagB64, cifradoB64] = partes;
    const clave = obtenerClaveMaestraEstatica(); // lanza ClaveNoDisponibleError si falta -- se propaga tal cual.
    try {
      const decipher = createDecipheriv(ALGORITMO, clave, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
      const descifrado = Buffer.concat([decipher.update(Buffer.from(cifradoB64, "base64")), decipher.final()]);
      return descifrado.toString("utf8");
    } catch (err) {
      throw new DescifradoFallidoError(
        `No se pudo descifrar el valor (posible manipulación, corrupción, o clave incorrecta). FAIL CLOSED: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new DescifradoFallidoError(
    "Valor con formato inválido para Developer V1 (no tiene el prefijo/estructura esperada -- ni dev1: ni dev2:). FAIL CLOSED: nunca se asume que es texto plano legado -- Developer V1 no tiene datos legados que tolerar."
  );
}
