import { timingSafeEqual, createHash } from "node:crypto";

// Mismo patrón que app/api/diagnostics/token-status/route.ts en el repo de
// Next -- comparación en tiempo constante sobre hashes de longitud fija,
// para que ni la longitud ni el contenido del secreto se filtren por timing.
export function claveValida(recibida: string | null, esperada: string | undefined): boolean {
  if (!recibida || !esperada) return false;
  const a = createHash("sha256").update(recibida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

export function extraerBearer(authHeader: string | undefined | null): string | null {
  if (!authHeader) return null;
  const match = /^Bearer (.+)$/.exec(authHeader);
  return match ? match[1] : null;
}
