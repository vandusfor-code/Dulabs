import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyPassword } from "@/lib/auth/password";
import { crearSesion, construirSetCookie } from "@/lib/auth/session";
import { especialistaPorId } from "@/lib/especialistas";

export const runtime = "nodejs";

type Body = { username?: string; password?: string };

type UsuarioFila = {
  id: number;
  id_tenant: string;
  especialista_id: number | null;
  password_hash: string;
  nombre: string;
  rol: "administrador" | "colaboradora";
  activo: boolean;
};

// Login AMORE (autorizado) — login real por username/password, DISTINTO del
// login de Supabase Auth que ya usa /api/auth/login (dashboard interno de
// DuLabs, email+password) -- namespace separado a propósito para no
// mezclar ambos sistemas. El username es único GLOBALMENTE (ver la
// migración), así que esta ruta no necesita conocer el tenant de antemano:
// lo resuelve a partir de la cuenta encontrada. Nunca revela si el username
// existe o no en el mensaje de error (mismo mensaje genérico para "no
// existe" y "contraseña incorrecta").
export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) {
    return Response.json({ error: "Usuario y contraseña son obligatorios" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data: usuario } = await supabase
    .from("dulabs_usuarios")
    .select("id, id_tenant, especialista_id, password_hash, nombre, rol, activo")
    .eq("username", username)
    .maybeSingle<UsuarioFila>();

  const CREDENCIALES_INVALIDAS = { error: "Usuario o contraseña incorrectos" } as const;
  if (!usuario) return Response.json(CREDENCIALES_INVALIDAS, { status: 401 });
  if (!usuario.activo) return Response.json({ error: "Esta cuenta está desactivada" }, { status: 403 });

  const valido = await verifyPassword(password, usuario.password_hash);
  if (!valido) return Response.json(CREDENCIALES_INVALIDAS, { status: 401 });

  if (!usuario.especialista_id) {
    // Ninguna cuenta real hoy queda en este caso (las 4 iniciales tienen
    // especialista) -- se deja el mensaje honesto en vez de inventar un
    // destino, para el día que exista una administradora pura sin perfil
    // de especialista.
    return Response.json(
      { error: "Esta cuenta no tiene un panel asociado todavía. Contacta al administrador del sistema." },
      { status: 409 }
    );
  }
  const especialista = await especialistaPorId(supabase, usuario.especialista_id);
  if (!especialista) {
    return Response.json({ error: "El perfil asociado a esta cuenta ya no existe" }, { status: 409 });
  }

  const tokenSesion = await crearSesion(supabase, usuario.id);

  return new Response(
    JSON.stringify({ ok: true, nombre: usuario.nombre, rol: usuario.rol, token: especialista.token }),
    { status: 200, headers: { "Content-Type": "application/json", "Set-Cookie": construirSetCookie(tokenSesion) } }
  );
}
