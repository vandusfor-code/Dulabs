import { createHmac, timingSafeEqual } from "node:crypto";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// Verificación de la firma del webhook de GitHub (X-Hub-Signature-256 =
// "sha256=<hex hmac>", HMAC-SHA256 del cuerpo CRUDO con el webhook secret).
// Comparación en tiempo constante. Se verifica SIEMPRE sobre el body sin
// re-serializar (un JSON.parse+stringify cambiaría bytes y rompería el HMAC).

/** Firma esperada para un cuerpo crudo, en el formato "sha256=<hex>". */
export function firmaEsperadaGithub(rawBody: string, secret: string): string {
  const hmac = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return `sha256=${hmac}`;
}

/**
 * true solo si la firma del header coincide con el HMAC del cuerpo. Cabecera
 * ausente/malformada => false (fail-closed). Timing-safe.
 */
export function verificarFirmaGithub(rawBody: string, signatureHeader: string | null | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const esperada = firmaEsperadaGithub(rawBody, secret);
  const a = Buffer.from(signatureHeader, "utf8");
  const b = Buffer.from(esperada, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
