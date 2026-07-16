import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { desuscribirWaba } from "@/lib/meta-numero";

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

  let body: { phone_number_id?: string; nombre_negocio?: string; nombre_agente?: string; ia_pausada?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { phone_number_id, ia_pausada } = body;
  const nombreNegocio = body.nombre_negocio?.trim();
  const nombreAgente = body.nombre_agente?.trim();
  if (!phone_number_id || (!nombreNegocio && !nombreAgente && ia_pausada === undefined)) {
    return Response.json(
      { error: "Falta 'phone_number_id' y al menos 'nombre_negocio', 'nombre_agente' o 'ia_pausada'" },
      { status: 400 }
    );
  }
  if ((nombreNegocio && nombreNegocio.length > MAX_NOMBRE_LENGTH) || (nombreAgente && nombreAgente.length > MAX_NOMBRE_LENGTH)) {
    return Response.json({ error: `El nombre no puede superar ${MAX_NOMBRE_LENGTH} caracteres` }, { status: 400 });
  }

  const cambios: Record<string, string | boolean> = { updated_at: new Date().toISOString() };
  if (nombreNegocio) cambios.nombre_negocio = nombreNegocio;
  if (nombreAgente) cambios.nombre_agente = nombreAgente;
  if (ia_pausada !== undefined) cambios.ia_pausada = ia_pausada;

  const { error } = await supabase
    .from("dulabs_clientes_config")
    .update(cambios)
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", userData.user.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}

// Autoservicio de eliminación de datos (política de eliminación de datos de
// WhatsApp): desconecta el número de Meta y borra de forma permanente todos
// los mensajes, campañas y datos de configuración asociados a esa línea.
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }

  let body: { phone_number_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { phone_number_id } = body;
  if (!phone_number_id) {
    return Response.json({ error: "Falta 'phone_number_id'" }, { status: 400 });
  }

  const { data: negocio, error: negocioError } = await supabase
    .from("dulabs_clientes_config")
    .select("whatsapp_business_account_id, meta_permanent_token")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", userData.user.id)
    .maybeSingle();

  if (negocioError) return Response.json({ error: negocioError.message }, { status: 500 });
  if (!negocio) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const metaToken = negocio.meta_permanent_token || process.env.META_ACCESS_TOKEN;
  if (metaToken) {
    await desuscribirWaba({ wabaId: negocio.whatsapp_business_account_id, token: metaToken });
  }

  const { error: mensajesError } = await supabase
    .from("dulabs_mensajes_log")
    .delete()
    .eq("phone_number_id", phone_number_id);
  if (mensajesError) return Response.json({ error: mensajesError.message }, { status: 500 });

  const { error: campanasError } = await supabase
    .from("dulabs_campanas")
    .delete()
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", userData.user.id);
  if (campanasError) return Response.json({ error: campanasError.message }, { status: 500 });

  const { error: configError } = await supabase
    .from("dulabs_clientes_config")
    .delete()
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", userData.user.id);
  if (configError) return Response.json({ error: configError.message }, { status: 500 });

  return Response.json({ success: true });
}
