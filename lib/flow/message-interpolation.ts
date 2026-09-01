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

/** Sustituye {{clave}} por el valor de variables. Claves ausentes quedan vacías. */
export function interpolateTemplate(text: string, variables: Record<string, unknown>): string {
  return text.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value == null || value === "") return "";
    return String(value);
  });
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
