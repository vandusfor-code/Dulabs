import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

// DuLabs Developer V1 -- Fase 1 (autorizado, ver docs/DULABS_DEVELOPER_V1_PHASE_1_ARCHITECTURE.md
// sección 2.2). Contrato de API keys: se muestran en claro UNA sola vez al
// crearlas, se almacenan siempre como SHA-256 -- nunca texto plano, nunca
// reversible. Deliberadamente separado de lib/crypto.ts: una API key no se
// "descifra" para volver a mostrarla, se compara por hash -- son primitivas
// distintas (cifrado simétrico reversible vs. hash de un solo sentido).

const PREFIJO = "dl_live_";
// 32 bytes de entropía aleatoria real, suficiente para que adivinar una
// clave por fuerza bruta sea inviable incluso a escala de todo el tráfico
// de la API.
const BYTES_ENTROPIA = 32;

const ALFABETO_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62(buffer: Buffer): string {
  // Conversión directa byte a byte (no aritmética de bignum): suficiente
  // para un identificador de alta entropía, no para codificar un número
  // exacto -- cada byte se mapea a un carácter del alfabeto, dando ~5.95
  // bits de entropía útil por byte de entrada, más que suficiente para 32
  // bytes de origen.
  let resultado = "";
  for (const byte of buffer) {
    resultado += ALFABETO_BASE62[byte % ALFABETO_BASE62.length];
  }
  return resultado;
}

export type ApiKeyGenerada = {
  /** Se muestra al desarrollador UNA sola vez. Nunca se persiste este valor. */
  claveEnClaro: string;
  /** Lo único que se guarda en base de datos. */
  hash: string;
};

/** Genera una API key nueva con el prefijo público dl_live_ y su hash SHA-256 para almacenar. */
export function generarApiKey(): ApiKeyGenerada {
  const claveEnClaro = `${PREFIJO}${base62(randomBytes(BYTES_ENTROPIA))}`;
  return { claveEnClaro, hash: hashearApiKey(claveEnClaro) };
}

/** Hash determinístico de una API key completa (incluido el prefijo) para comparar/almacenar. */
export function hashearApiKey(claveEnClaro: string): string {
  return createHash("sha256").update(claveEnClaro, "utf8").digest("hex");
}

/**
 * Compara una API key recibida en un request contra el hash almacenado, en
 * tiempo constante -- nunca con === directo sobre strings (eso filtraría
 * por timing cuánto del hash coincide). Ambos lados se hashean primero a
 * longitud fija (32 bytes) antes de comparar, así timingSafeEqual nunca
 * lanza por longitudes distintas.
 */
export function verificarApiKey(claveRecibida: string, hashAlmacenado: string): boolean {
  if (!claveRecibida || !hashAlmacenado) return false;
  const hashRecibido = Buffer.from(hashearApiKey(claveRecibida), "hex");
  const hashEsperado = Buffer.from(hashAlmacenado, "hex");
  if (hashRecibido.length !== hashEsperado.length) return false;
  return timingSafeEqual(hashRecibido, hashEsperado);
}

/** true si el string tiene la forma superficial de una API key de Developer (para validar antes de tocar la DB). */
export function tieneFormaDeApiKey(valor: string): boolean {
  return valor.startsWith(PREFIJO) && valor.length > PREFIJO.length + 20;
}
