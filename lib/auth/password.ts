import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const KEYLEN = 64;

// Login AMORE (autorizado) — hash de contraseñas con scrypt (librería
// estándar de Node, sin dependencia nueva). Formato guardado:
// "scrypt:<saltHex>:<hashHex>" -- el salt viaja junto al hash (no hace
// falta guardarlo aparte) y el prefijo deja espacio para migrar de
// algoritmo en el futuro sin romper hashes ya guardados.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivado = await scrypt(password, salt, KEYLEN);
  return `scrypt:${salt.toString("hex")}:${derivado.toString("hex")}`;
}

// Comparación en tiempo constante (timingSafeEqual) -- nunca compara los
// hashes con === (evitaría filtrar por timing cuánto del hash coincide).
export async function verifyPassword(password: string, hashGuardado: string): Promise<boolean> {
  const partes = hashGuardado.split(":");
  if (partes.length !== 3 || partes[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = partes;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const hashEsperado = Buffer.from(hashHex, "hex");
    const derivado = await scrypt(password, salt, hashEsperado.length);
    return timingSafeEqual(derivado, hashEsperado);
  } catch {
    return false;
  }
}
