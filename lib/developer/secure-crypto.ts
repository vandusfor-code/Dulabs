import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// DuLabs Developer V1 -- Fase 1 (autorizado, sección 17 del brief + corrección
// pedida explícitamente sobre la contradicción documentada en
// docs/DULABS_DEVELOPER_V1_PHASE_1_ARCHITECTURE.md sección 8.1).
//
// Contradicción real encontrada: lib/crypto.ts (usado hoy por DuLabs
// Business) tiene un fallback deliberado a texto plano en
// descifrarSecreto() para tolerar datos legado sin migrar -- correcto para
// Business (rompería producción si no lo tuviera), pero es exactamente lo
// OPUESTO de "fail closed" que exige Developer V1. Developer V1 es
// greenfield: no existe ningún dato legado que tolerar, así que no hay
// ninguna razón de negocio para aceptar ese fallback acá.
//
// Esta es una ruta EXPLÍCITAMENTE SEPARADA de lib/crypto.ts -- nunca se
// modificó lib/crypto.ts (seguiría rompiendo Business si perdiera su
// fallback legado). Mismo algoritmo (AES-256-GCM, IV único de 12 bytes,
// formato versionado) pero con reglas de fallo estrictas:
//
//   - Clave no disponible o con formato inválido -> lanza, nunca continúa.
//   - Valor a descifrar mal formado -> lanza, NUNCA se asume "debe ser
//     texto plano" (a diferencia de lib/crypto.ts).
//   - Fallo de autenticación GCM (dato manipulado) -> lanza.
//   - Cero fallback a clave cero / clave por defecto / secreto por defecto:
//     no existe ningún camino de código que produzca un resultado sin
//     haber pasado por una clave real de 32 bytes.
//
// NOTA DE INFRAESTRUCTURA (honesta, no simulada -- instrucción explícita de
// no fingir que hay infraestructura desplegada): en la arquitectura
// aprobada, la clave maestra debe protegerse con Google Cloud KMS
// (envelope encryption -- KMS desenvuelve la clave de datos real). Ese
// wiring contra KMS real requiere una cuenta GCP con KMS provisionado, que
// no está disponible en este entorno y NO se simula acá. Lo que SÍ está
// implementado y probado es la REGLA de negocio ("si la clave no está
// disponible, fail closed, sin excepciones") de forma que
// obtenerClaveMaestra() sea el ÚNICO punto de código a cambiar cuando
// exista una llamada real a KMS -- el resto de este archivo no necesita
// tocarse.

const ALGORITMO = "aes-256-gcm";
const PREFIJO_VERSION = "dev1";

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

function obtenerClaveMaestra(): Buffer {
  // TODO(Fase 3, infraestructura real): reemplazar esta lectura de env var
  // por una llamada real a Google Cloud KMS (Decrypt/desenvolver la DEK).
  // Hasta entonces, DEVELOPER_TOKEN_ENCRYPTION_KEY es el placeholder
  // explícito de "la clave que KMS entregaría" -- deliberadamente una
  // variable de entorno DISTINTA de TOKEN_ENCRYPTION_KEY (la de Business),
  // para que rotar/perder una nunca afecte a la otra.
  const clave = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
  if (!clave) {
    throw new ClaveNoDisponibleError(
      "DEVELOPER_TOKEN_ENCRYPTION_KEY no está configurada. FAIL CLOSED: no existe ningún valor por defecto ni clave cero -- la operación se aborta."
    );
  }
  const buffer = Buffer.from(clave, "base64");
  if (buffer.length !== 32) {
    throw new ClaveNoDisponibleError(
      `DEVELOPER_TOKEN_ENCRYPTION_KEY tiene ${buffer.length} bytes tras decodificar base64; se requieren exactamente 32 (AES-256). FAIL CLOSED.`
    );
  }
  return buffer;
}

/** true si hay una clave maestra válida disponible ahora mismo -- para que un caller decida fallar closed ANTES de intentar cualquier operación (ej. rechazar un request completo en vez de fallar a mitad de una transacción). */
export function claveMaestraDisponible(): boolean {
  try {
    obtenerClaveMaestra();
    return true;
  } catch {
    return false;
  }
}

/** Cifra un secreto de Developer V1 (credencial de IA de terceros del desarrollador, secreto de webhook, etc.). Lanza ClaveNoDisponibleError si la clave falta o es inválida -- nunca cifra con una clave débil/por defecto. */
export function cifrarSecretoDev(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITMO, obtenerClaveMaestra(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIJO_VERSION}:${iv.toString("base64")}:${authTag.toString("base64")}:${cifrado.toString("base64")}`;
}

/**
 * Descifra un valor cifrado con cifrarSecretoDev(). A diferencia de
 * lib/crypto.ts::descifrarSecreto, NUNCA devuelve el valor de entrada tal
 * cual ante un formato inesperado -- eso sería exactamente el fallback a
 * texto plano que está prohibido. Cualquier desviación (formato inválido,
 * clave ausente, autenticación GCM fallida -- dato manipulado) lanza.
 */
export function descifrarSecretoDev(valor: string): string {
  const partes = valor.split(":");
  if (partes.length !== 4 || partes[0] !== PREFIJO_VERSION) {
    throw new DescifradoFallidoError(
      "Valor con formato inválido para Developer V1 (no tiene el prefijo/estructura esperada). FAIL CLOSED: nunca se asume que es texto plano legado -- Developer V1 no tiene datos legados que tolerar."
    );
  }
  const [, ivB64, authTagB64, cifradoB64] = partes;

  const clave = obtenerClaveMaestra(); // lanza ClaveNoDisponibleError si falta -- se propaga tal cual, sin envolver.

  try {
    const decipher = createDecipheriv(ALGORITMO, clave, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const descifrado = Buffer.concat([decipher.update(Buffer.from(cifradoB64, "base64")), decipher.final()]);
    return descifrado.toString("utf8");
  } catch (err) {
    // Incluye el caso de authTag inválido (dato manipulado/corrupto): GCM
    // lanza en decipher.final() cuando la autenticación falla. Se
    // relanza como fallo explícito, NUNCA se devuelve un resultado
    // parcial ni el valor original.
    throw new DescifradoFallidoError(
      `No se pudo descifrar el valor (posible manipulación, corrupción, o clave incorrecta). FAIL CLOSED: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
