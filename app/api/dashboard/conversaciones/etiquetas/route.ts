import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol, type Miembro } from "@/lib/team";

export const runtime = "nodejs";

async function autenticar(
  request: NextRequest
): Promise<{ error: Response } | { supabase: ReturnType<typeof supabaseAdmin>; miembro: Miembro }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { error: Response.json({ error: "Falta el token de sesión" }, { status: 401 }) };
  const supabase = supabaseAdmin();
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) return { error: Response.json({ error: "Sesión inválida" }, { status: 401 }) };
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin", "agente"])) {
    return { error: Response.json({ error: "No tienes permiso para etiquetar conversaciones" }, { status: 403 }) };
  }
  return { supabase, miembro };
}

type Body = { phone_number_id?: string; telefono_cliente?: string; etiqueta_id?: number };

// Aplica una etiqueta a una conversación (par phone_number_id + telefono_cliente).
// El unique constraint de la tabla evita duplicados si ya estaba aplicada.
export async function POST(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, telefono_cliente, etiqueta_id } = body;
  if (!phone_number_id || !telefono_cliente || !etiqueta_id) {
    return Response.json({ error: "Faltan 'phone_number_id', 'telefono_cliente' o 'etiqueta_id'" }, { status: 400 });
  }

  // La etiqueta debe pertenecer al tenant del miembro (evita aplicar una
  // etiqueta ajena a través del id).
  const { data: etiqueta } = await supabase
    .from("dulabs_etiquetas")
    .select("id")
    .eq("id", etiqueta_id)
    .eq("tenant_id", miembro.tenantId)
    .maybeSingle();
  if (!etiqueta) return Response.json({ error: "Etiqueta no encontrada" }, { status: 404 });

  const { error } = await supabase
    .from("dulabs_conversacion_etiquetas")
    .insert({
      phone_number_id,
      telefono_cliente,
      etiqueta_id,
      asignado_por: miembro.miembroId,
    })
    .select("id")
    .maybeSingle();
  // El unique constraint (phone_number_id, telefono_cliente, etiqueta_id)
  // hace que reintentar aplicar la misma etiqueta sea un no-op, no un error.
  if (error && error.code !== "23505") {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

// Quita una etiqueta de una conversación.
export async function DELETE(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase } = ctx;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, telefono_cliente, etiqueta_id } = body;
  if (!phone_number_id || !telefono_cliente || !etiqueta_id) {
    return Response.json({ error: "Faltan 'phone_number_id', 'telefono_cliente' o 'etiqueta_id'" }, { status: 400 });
  }

  const { error } = await supabase
    .from("dulabs_conversacion_etiquetas")
    .delete()
    .eq("phone_number_id", phone_number_id)
    .eq("telefono_cliente", telefono_cliente)
    .eq("etiqueta_id", etiqueta_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
