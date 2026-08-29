/**
 * Utilidades para interpolación de variables en nodos message (validación publish).
 */

import type { FlowMessageContent } from "@/lib/flow/types";

const VARIABLE_PATTERN = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

function collectFromText(text: string, out: Set<string>): void {
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    out.add(match[1]!);
  }
}

/** Extrae claves {{variable}} de un FlowMessageContent. */
export function extractInterpolatedVariableKeys(content: FlowMessageContent): string[] {
  const keys = new Set<string>();
  if (content.text) collectFromText(content.text, keys);
  for (const part of content.parts ?? []) {
    collectFromText(part, keys);
  }
  return [...keys];
}
