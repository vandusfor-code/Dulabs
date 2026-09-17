import { timingSafeEqual, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { validarConfigCriptograficaDeRelease } from "@/lib/config/release-crypto-config";

export const runtime = "nodejs";

// Diagnóstico READ-ONLY de la disponibilidad del cifrado de Developer V1 en
// runtime (autorizado -- verificación del incidente de Fase 10). Reporta SOLO
// si hay clave maestra disponible y con qué MECANISMO (kms/static/none) --
// NUNCA el valor de ninguna clave. Es la comprobación exacta que hace el guard
// de /api/developer/whatsapp/connect (claveMaestraDisponible), así que
// `developer_crypto_ready: true` garantiza que ese endpoint YA no responde
// `encryption_unavailable`.
//
// Protegido por DIAGNOSTICS_SECRET (el mismo secreto de diagnóstico que ya usa
// Business en /api/diagnostics/token-status; si no está configurado, 403
// siempre). Comparación en tiempo constante sobre hashes de longitud fija.

function claveValida(recibida: string | null, esperada: string | undefined): boolean {
  if (!recibida || !esperada) return false;
  const a = createHash("sha256").update(recibida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  // Fase 16 (hardening): se acepta el secreto por Authorization: Bearer
  // (preferido -- no queda en logs/referrer) o, por compatibilidad, ?key=.
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const clave = bearer || request.nextUrl.searchParams.get("key");
  if (!claveValida(clave, process.env.DIAGNOSTICS_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }

  const r = validarConfigCriptograficaDeRelease({ productos: ["developer"] });
  const dev = r.estados[0]!;
  return Response.json({
    entorno: r.entorno,
    developer_crypto_ready: dev.ok,
    mecanismo: dev.mecanismo, // "kms" | "static" | "none" -- nunca el valor
    variables_aceptadas: dev.variablesAceptadas,
  });
}
