import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { Receiver } from "@upstash/qstash";

// Acepta DOS disparadores válidos, para poder alternar sin romper nada:
//  - QStash (github.com/upstash/qstash): firma criptográfica en el header
//    `upstash-signature`, verificada contra las signing keys de la cuenta.
//    Preciso y no depende del plan de Vercel (a diferencia de sus crons
//    nativos, limitados a 1 disparo/día en el plan Hobby).
//  - El cron nativo de Vercel (o una prueba manual con curl): el mismo
//    `Authorization: Bearer $CRON_SECRET` que ya usan los demás crons.
export async function solicitudAutorizadaCron(request: NextRequest, cuerpo: string): Promise<boolean> {
  const firmaQstash = request.headers.get("upstash-signature");
  if (firmaQstash) {
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
    if (!currentSigningKey || !nextSigningKey) {
      console.error("[cron-auth] llegó upstash-signature pero faltan QSTASH_CURRENT_SIGNING_KEY/QSTASH_NEXT_SIGNING_KEY");
      return false;
    }
    try {
      const receiver = new Receiver({ currentSigningKey, nextSigningKey });
      return await receiver.verify({ signature: firmaQstash, body: cuerpo });
    } catch (err) {
      console.error("[cron-auth] firma de QStash inválida:", err instanceof Error ? err.message : err);
      return false;
    }
  }

  return bearerCronValido(request.headers.get("authorization"), process.env.CRON_SECRET);
}

/**
 * Bloque 18 -- antes: `auth === \`Bearer ${CRON_SECRET}\`` aceptaba "Bearer undefined" si la
 * variable faltaba. Ahora sin secreto NADA pasa, y la comparación es en tiempo
 * constante (hash de ambos lados: mismo largo siempre).
 */
export function bearerCronValido(authorization: string | null, secreto: string | undefined): boolean {
  if (!secreto || !authorization?.startsWith("Bearer ")) return false;
  const a = createHash("sha256").update(authorization.slice(7)).digest();
  const b = createHash("sha256").update(secreto).digest();
  return timingSafeEqual(a, b);
}
