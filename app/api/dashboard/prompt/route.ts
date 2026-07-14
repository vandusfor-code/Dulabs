import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const MAX_PROMPT_LENGTH = 4000;

// Permite a un negocio editar su propio prompt_sistema (precios, horarios,
// tono). Alcance restringido por id_tenant: nunca toca la fila de otro.
export async function PATCH(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return Response.json({ error: "Falta el token de sesión" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }

  let body: { phone_number_id?: string; prompt_sistema?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { phone_number_id, prompt_sistema } = body;
  if (!phone_number_id || typeof prompt_sistema !== "string") {
    return Response.json(
      { error: "Faltan 'phone_number_id' o 'prompt_sistema'" },
      { status: 400 }
    );
  }
  if (prompt_sistema.length > MAX_PROMPT_LENGTH) {
    return Response.json(
      { error: `El prompt no puede superar ${MAX_PROMPT_LENGTH} caracteres` },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("dulabs_clientes_config")
    .update({ prompt_sistema, updated_at: new Date().toISOString() })
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", userData.user.id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
