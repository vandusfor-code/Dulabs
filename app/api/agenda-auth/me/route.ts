import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extraerTokenCookie, resolverSesion } from "@/lib/auth/session";
import { especialistaPorId } from "@/lib/especialistas";

export const runtime = "nodejs";

// Login AMORE (autorizado) — "quién soy" a partir de la cookie de sesión,
// sin necesitar el token de agenda en la URL. Es lo que permite que rutas
// como /admin/amore existan sin exponer el token del especialista en el
// navegador -- resuelve la sesión real y devuelve el token internamente
// necesario para llamar al resto de las APIs (/api/agenda/[token]/*), que
// no cambian en nada.
export async function GET(request: NextRequest) {
  const tokenCrudo = extraerTokenCookie(request.headers.get("cookie"));
  if (!tokenCrudo) return Response.json({ error: "No autenticado" }, { status: 401 });

  const supabase = supabaseAdmin();
  const sesion = await resolverSesion(supabase, tokenCrudo);
  if (!sesion) return Response.json({ error: "Tu sesión expiró, inicia sesión de nuevo" }, { status: 401 });

  if (!sesion.especialistaId) {
    return Response.json({ error: "Esta cuenta no tiene un panel asociado todavía" }, { status: 409 });
  }
  const especialista = await especialistaPorId(supabase, sesion.especialistaId);
  if (!especialista) return Response.json({ error: "El perfil asociado a esta cuenta ya no existe" }, { status: 409 });

  return Response.json({
    token: especialista.token,
    rol: sesion.rol,
    nombre: sesion.nombre,
    username: sesion.username,
  });
}
