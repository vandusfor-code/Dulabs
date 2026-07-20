import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const LIMITE_INTENTOS = 3;
const VENTANA_MS = 15 * 60 * 1000; // 15 minutos

// Login server-side (en vez del cliente llamando a Supabase directo) para
// poder contar y bloquear intentos fallidos de verdad — un contador solo en
// el navegador se resetea con solo recargar la página.
export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) {
    return Response.json({ error: "Faltan 'email' o 'password'" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const desde = new Date(Date.now() - VENTANA_MS).toISOString();

  const { count } = await supabase
    .from("dulabs_intentos_login_fallidos")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", desde);

  if ((count ?? 0) >= LIMITE_INTENTOS) {
    return Response.json(
      { error: "Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.", bloqueado: true },
      { status: 429 }
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    await supabase.from("dulabs_intentos_login_fallidos").insert({ email });
    const intentosRestantes = Math.max(0, LIMITE_INTENTOS - ((count ?? 0) + 1));
    return Response.json(
      { error: error?.message ?? "Credenciales inválidas", intentosRestantes },
      { status: 401 }
    );
  }

  // Login correcto: limpia el historial de intentos fallidos de este correo.
  await supabase.from("dulabs_intentos_login_fallidos").delete().eq("email", email);

  return Response.json({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
}
