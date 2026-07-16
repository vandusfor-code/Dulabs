import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const MAX_NOMBRE_LENGTH = 60;

// Permite renombrar un número conectado (ej. "Peluquería de Prueba" → "Panadería")
// y/o ponerle nombre propio a su agente de IA (ej. "Ava"). El nombre que
// llega de Meta al conectar es solo un valor inicial editable.
export async function PATCH(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }

  let body: { phone_number_id?: string; nombre_negocio?: string; nombre_agente?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { phone_number_id } = body;
  const nombreNegocio = body.nombre_negocio?.trim();
  const nombreAgente = body.nombre_agente?.trim();
  if (!phone_number_id || (!nombreNegocio && !nombreAgente)) {
    return Response.json(
      { error: "Falta 'phone_number_id' y al menos 'nombre_negocio' o 'nombre_agente'" },
      { status: 400 }
    );
  }
  if ((nombreNegocio && nombreNegocio.length > MAX_NOMBRE_LENGTH) || (nombreAgente && nombreAgente.length > MAX_NOMBRE_LENGTH)) {
    return Response.json({ error: `El nombre no puede superar ${MAX_NOMBRE_LENGTH} caracteres` }, { status: 400 });
  }

  const cambios: Record<string, string> = { updated_at: new Date().toISOString() };
  if (nombreNegocio) cambios.nombre_negocio = nombreNegocio;
  if (nombreAgente) cambios.nombre_agente = nombreAgente;

  const { error } = await supabase
    .from("dulabs_clientes_config")
    .update(cambios)
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", userData.user.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
