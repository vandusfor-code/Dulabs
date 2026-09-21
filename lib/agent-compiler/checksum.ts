// DuLabs Business — Agent Compiler. Determinismo/checksum compartido.
//
// Único sistema de checksum del Compiler (Spec/IR/FlowDefinition lo reutilizan
// todos): serialización canónica (claves ordenadas, sin depender del orden de
// inserción) + SHA-256. Sin fecha/azar/estado global — mismo input produce
// siempre el mismo checksum.

import { createHash } from "node:crypto";

/**
 * Serialización canónica con la MISMA semántica que JSON: una propiedad con valor `undefined` NO existe (se omite), y un
 * `undefined` dentro de un arreglo es `null`.
 *
 * Importa porque el checksum del FlowDefinition se calcula al compilar (objeto en memoria, con propiedades `undefined`) y el
 * resolvedor de producción lo RECALCULA sobre el JSON que guarda Postgres (jsonb), donde esas propiedades ya no existen. Antes,
 * `undefined` se serializaba como `"k":null`: el checksum guardado nunca coincidía con el recalculado y TODO agente publicado
 * quedaba en "checksum_mismatch" (no se servía por el runtime del Business Agent).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function checksumOf(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
