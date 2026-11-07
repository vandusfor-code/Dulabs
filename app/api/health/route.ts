/**
 * GET|POST /api/health — salud para el alojamiento (Render/Cloud Run) y para los pings de mantenimiento (QStash hace POST).
 *   /api/health            vida: el proceso responde. Sin dependencias: contesta aunque Supabase esté caído.
 *   /api/health?deep=1     además sondea Supabase Auth (con la llave pública) y contesta 503 si NO está disponible: así el inicio de sesión no aparenta funcionar sin servicio.
 * Nunca devuelve URLs, llaves ni el cuerpo de lo que contestó Supabase (ver lib/salud.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { sondearAuthConCache } from "@/lib/salud";

export const runtime = "nodejs";

const SIN_CACHE = { "Cache-Control": "no-store" };

async function responder(request: NextRequest): Promise<NextResponse> {
  const base = { ok: true, servicio: "dulabs", uptime_s: Math.round(process.uptime()) };
  if (request.nextUrl.searchParams.get("deep") !== "1") return NextResponse.json(base, { headers: SIN_CACHE });
  const auth = await sondearAuthConCache({ url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL, llave: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY });
  // «lento» no es una caída: se deja pasar para no sacar de servicio una instancia sana por una respuesta tardía.
  const sirve = auth.estado === "ok" || auth.estado === "lento";
  return NextResponse.json({ ...base, ok: sirve, auth }, { status: sirve ? 200 : 503, headers: SIN_CACHE });
}

export const GET = responder;
export const POST = responder;
