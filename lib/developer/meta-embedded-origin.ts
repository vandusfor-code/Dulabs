// DuLabs Developer V1 -- Fase 10 (autorizado). Validación EXACTA del origin
// de los postMessage de Meta durante el Embedded Signup. Módulo puro (sin
// React/DOM) para poder testearlo directo.
//
// El hook de Business usa `endsWith("facebook.com")`, que es inseguro:
// `https://evilfacebook.com` o `https://www.facebook.com.evil.com` también
// pasarían. Developer usa una ALLOWLIST de origins EXACTOS -- comparación
// por igualdad total (Set.has), nunca endsWith/includes/substring.
//
// Origins legítimos desde los que el SDK de Meta emite WA_EMBEDDED_SIGNUP.
export const ORIGENES_META_PERMITIDOS: ReadonlySet<string> = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
  "https://facebook.com",
]);

/** true SOLO si `origin` es exactamente uno de los origins legítimos de Meta. */
export function esOrigenMetaValido(origin: string): boolean {
  return ORIGENES_META_PERMITIDOS.has(origin);
}
