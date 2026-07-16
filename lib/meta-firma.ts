import { createHmac, createHash, timingSafeEqual } from "node:crypto";

// Verifica la cabecera X-Hub-Signature-256 de Meta: es el HMAC-SHA256 del body
// CRUDO (los bytes exactos que envió Meta) con el App Secret de la app. Debe
// calcularse sobre el texto sin re-serializar — por eso el handler lee
// request.text() antes de hacer JSON.parse.
//
// Falla cerrado (devuelve false, nunca lanza) ante cualquier duda: sin secreto
// configurado, sin cabecera, formato inválido, o longitudes distintas.
export function verificarFirmaMeta(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.error("[meta-firma] META_APP_SECRET no configurado; se rechaza el webhook por seguridad.");
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const recibidaHex = signatureHeader.slice("sha256=".length);
  const esperadaHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  const recibida = Buffer.from(recibidaHex, "hex");
  const esperada = Buffer.from(esperadaHex, "hex");

  // timingSafeEqual LANZA una excepción si los buffers difieren en longitud
  // (una firma corta/malformada haría reventar el handler). Validamos el largo
  // primero y tratamos cualquier diferencia como firma inválida.
  if (recibida.length !== esperada.length) return false;
  return timingSafeEqual(recibida, esperada);
}

// Comparación en tiempo constante del verify_token del handshake GET, para no
// filtrar el token por timing. Hashea ambos lados a 32 bytes fijos, así que
// timingSafeEqual nunca ve longitudes distintas (no lanza).
export function compararVerifyToken(recibido: string | null, esperado: string | undefined): boolean {
  if (!recibido || !esperado) return false;
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}
