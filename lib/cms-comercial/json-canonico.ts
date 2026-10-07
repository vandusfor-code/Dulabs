/**
 * CMS comercial — JSON CANÓNICO (claves ordenadas, sin espacios). PURO y apto para el navegador (no usa módulos de Node): lo comparten el checksum del servidor
 * (checksum.ts) y el editor del Dashboard, que lo usa para saber si el borrador cambió.
 */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor === undefined ? null : valor);
  if (Array.isArray(valor)) return `[${valor.map((v) => jsonCanonico(v)).join(",")}]`;
  const o = valor as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(",")}}`;
}
