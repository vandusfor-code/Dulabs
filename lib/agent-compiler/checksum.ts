// DuLabs Business — Agent Compiler. Determinismo/checksum compartido.
//
// Único sistema de checksum del Compiler (Spec/IR/FlowDefinition lo reutilizan
// todos): serialización canónica (claves ordenadas, sin depender del orden de
// inserción) + SHA-256. Sin fecha/azar/estado global — mismo input produce
// siempre el mismo checksum.

import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function checksumOf(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
