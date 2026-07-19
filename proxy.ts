import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Rate limiting best-effort en memoria para los endpoints realmente públicos
// (webhooks de Meta/Wompi, crons, diagnostics) — no toca rutas del
// dashboard, que ya están protegidas por sesión de Supabase.
//
// Ojo: esto es POR INSTANCIA de función serverless, no distribuido — en
// Vercel cada instancia caliente tiene su propia memoria. Frena a alguien
// mandando ráfagas desde una sola conexión/instancia, pero no detiene un
// ataque distribuido a gran escala (para eso hace falta Vercel Firewall o
// un limitador con Redis/Upstash compartido entre instancias).
type LimiteConfig = { limite: number; ventanaMs: number };

const LIMITES: { prefijo: string; config: LimiteConfig }[] = [
  // Webhooks reales de Meta/Wompi: volumen más alto esperado en producción.
  { prefijo: "/webhook-dulabs", config: { limite: 120, ventanaMs: 60_000 } },
  { prefijo: "/api/wompi/webhook", config: { limite: 60, ventanaMs: 60_000 } },
  // Crons (Vercel) y diagnostics: casi nadie más debería tocarlos nunca.
  { prefijo: "/api/cron", config: { limite: 10, ventanaMs: 60_000 } },
  { prefijo: "/api/wompi/cobro-mensual", config: { limite: 10, ventanaMs: 60_000 } },
  { prefijo: "/api/diagnostics", config: { limite: 10, ventanaMs: 60_000 } },
];

const contadores = new Map<string, { cuenta: number; expira: number }>();

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const regla = LIMITES.find((r) => pathname === r.prefijo || pathname.startsWith(r.prefijo + "/"));
  if (!regla) return NextResponse.next();

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "desconocido";
  const clave = `${ip}:${regla.prefijo}`;
  const ahora = Date.now();

  const actual = contadores.get(clave);
  if (!actual || actual.expira < ahora) {
    contadores.set(clave, { cuenta: 1, expira: ahora + regla.config.ventanaMs });
  } else {
    actual.cuenta++;
    if (actual.cuenta > regla.config.limite) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }
  }

  // Limpieza ocasional para que el mapa no crezca indefinidamente en una
  // instancia de larga vida.
  if (contadores.size > 5000) {
    for (const [k, v] of contadores) {
      if (v.expira < ahora) contadores.delete(k);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/webhook-dulabs", "/api/wompi/:path*", "/api/cron/:path*", "/api/diagnostics/:path*"],
};
