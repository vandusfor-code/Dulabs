/**
 * R4 — chunker de documentos. PURO y determinista.
 *
 * texto extraído -> bloques (párrafos / filas) -> chunks de ~KNOWLEDGE_LIMITS.
 * chunkTargetChars, sin superar chunkMaxChars. Los párrafos se agrupan hasta el
 * objetivo; un bloque más grande que el máximo se parte por filas, luego por
 * oraciones y, en último caso, por longitud (con solapamiento para no perder el
 * hilo entre cortes). Nunca devuelve un chunk vacío ni con caracteres de
 * control (Postgres rechaza NUL en text).
 */
import { KNOWLEDGE_LIMITS } from "@/lib/business-agent-knowledge/limits";

// Sin literales de control en el código fuente: se construye el patrón en runtime.
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

/** Normaliza saltos de línea y elimina caracteres de control (conserva \n y \t). */
export function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    // Marcadores de página que inserta pdf-parse ("-- 1 of 3 --"): ruido, no contenido.
    .replace(/^-- \d+ of \d+ --$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ChunkOptions {
  targetChars?: number;
  maxChars?: number;
  overlapChars?: number;
}

/**
 * Parte un bloque grande en trozos <= max, prefiriendo filas y oraciones. El
 * solapamiento entre trozos consecutivos usa UNIDADES COMPLETAS (filas/
 * oraciones), nunca un corte de caracteres a mitad de fila o de palabra.
 */
function splitLargeBlock(block: string, max: number, overlap: number): string[] {
  const unidades = block
    .split("\n")
    .flatMap((linea) => (linea.length <= max ? [linea] : linea.split(/(?<=[.!?…])\s+/)))
    .map((u) => u.trim())
    .filter(Boolean);

  const out: string[] = [];
  let actual: string[] = [];
  const largo = (us: string[]) => us.reduce((n, u) => n + u.length + 1, 0);
  const cerrar = () => {
    if (actual.length) out.push(actual.join("\n"));
  };

  for (const unidad of unidades) {
    if (unidad.length > max) {
      // Sin puntuación aprovechable: corte duro con solapamiento de caracteres.
      cerrar();
      actual = [];
      for (let i = 0; i < unidad.length; i += Math.max(1, max - overlap)) {
        out.push(unidad.slice(i, i + max).trim());
        if (i + max >= unidad.length) break;
      }
      continue;
    }
    if (actual.length && largo(actual) + unidad.length > max) {
      cerrar();
      // Solapamiento: las últimas unidades completas (<= overlap chars) abren el siguiente trozo.
      const cola: string[] = [];
      for (let i = actual.length - 1; i >= 0 && largo(cola) + actual[i]!.length <= overlap; i--) cola.unshift(actual[i]!);
      actual = cola;
    }
    actual.push(unidad);
  }
  cerrar();
  return out.filter((c) => c.trim().length > 0);
}

/** Divide `texto` en chunks. El resultado es estable: mismo texto -> mismos chunks. */
export function chunkText(texto: string, options: ChunkOptions = {}): string[] {
  const target = options.targetChars ?? KNOWLEDGE_LIMITS.chunkTargetChars;
  const max = options.maxChars ?? KNOWLEDGE_LIMITS.chunkMaxChars;
  const overlap = options.overlapChars ?? KNOWLEDGE_LIMITS.chunkOverlapChars;

  const limpio = cleanExtractedText(texto);
  if (!limpio) return [];

  const bloques = limpio
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .flatMap((b) => (b.length > max ? splitLargeBlock(b, max, overlap) : [b]));

  const chunks: string[] = [];
  let actual = "";
  for (const bloque of bloques) {
    if (!actual) {
      actual = bloque;
      continue;
    }
    if (actual.length + 2 + bloque.length <= target) {
      actual = `${actual}\n\n${bloque}`;
    } else {
      chunks.push(actual);
      actual = bloque;
    }
  }
  if (actual) chunks.push(actual);
  return chunks.filter((c) => c.trim().length > 0);
}
