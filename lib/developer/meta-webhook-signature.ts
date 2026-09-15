import { createHmac, timingSafeEqual } from "node:crypto";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección A del documento de
// infraestructura, "Autenticación/verificación de firma (POST)"). Verifica
// la firma que META envía HACIA DuLabs en cada webhook (X-Hub-Signature-256,
// HMAC-SHA256 del cuerpo crudo con el App Secret de la plataforma) --
// deliberadamente separado de lib/developer/webhook-signature.ts, que firma
// en la dirección opuesta (DuLabs hacia el desarrollador) con un esquema
// distinto (timestamp.cuerpo, no solo cuerpo) -- son protocolos distintos,
// no la misma primitiva reusada con los datos cambiados.

const PREFIJO_FIRMA = "sha256=";

/**
 * Verifica X-Hub-Signature-256 sobre el cuerpo CRUDO (antes de parsear JSON)
 * -- comparación en tiempo constante, nunca === directo sobre strings.
 */
export function verificarFirmaMeta(cuerpoCrudo: Buffer | string, firmaHeader: string | null | undefined, appSecret: string): boolean {
  if (!firmaHeader || !firmaHeader.startsWith(PREFIJO_FIRMA)) return false;
  if (!appSecret) return false;

  const esperada = createHmac("sha256", appSecret).update(cuerpoCrudo).digest("hex");
  const recibida = firmaHeader.slice(PREFIJO_FIRMA.length);

  const bufEsperada = Buffer.from(esperada, "hex");
  const bufRecibida = Buffer.from(recibida, "hex");
  if (bufEsperada.length !== bufRecibida.length) return false;
  return timingSafeEqual(bufEsperada, bufRecibida);
}
