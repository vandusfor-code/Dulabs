import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extraerTokenCookie, revocarSesion, construirClearCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

// Login AMORE (autorizado) — revoca la sesión de verdad en
// dulabs_usuarios_sesiones (no solo borra la cookie): si alguien capturó el
// valor de la cookie antes de este logout, deja de servirle igual.
export async function POST(request: NextRequest) {
  const tokenCrudo = extraerTokenCookie(request.headers.get("cookie"));
  if (tokenCrudo) {
    const supabase = supabaseAdmin();
    await revocarSesion(supabase, tokenCrudo);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": construirClearCookie() },
  });
}
