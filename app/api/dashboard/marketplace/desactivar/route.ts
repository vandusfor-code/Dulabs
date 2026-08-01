import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";

export const runtime = "nodejs";

// Desactiva el agente del Marketplace activo en un número y devuelve el
// número a su agente propio. Acción reversible y no destructiva: la config
// propia del cliente nunca se tocó (sigue en dulabs_clientes_config /
// dulabs_agentes), solo se estaba "sombreando" — al poner
// marketplace_activacion_id en null vuelve a usarse sola. La activación
// queda como 'cancelada' (historial), no se borra la fila.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: { phone_number_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const phoneNumberId = body.phone_number_id;
  if (!phoneNumberId) return Response.json({ error: "Falta 'phone_number_id'" }, { status: 400 });

  const { data: cliente } = await supabase
    .from("dulabs_clientes_config")
    .select("id, marketplace_activacion_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });
  if (!cliente.marketplace_activacion_id) {
    return Response.json({ error: "Este número no tiene un agente del marketplace activo" }, { status: 400 });
  }

  // Primero se apaga en el número (así el webhook deja de usar el agente
  // comprado de inmediato), luego se marca la activación como cancelada.
  const { error: updateError } = await supabase
    .from("dulabs_clientes_config")
    .update({ marketplace_activacion_id: null })
    .eq("id", cliente.id);
  if (updateError) {
    return Response.json({ error: `No se pudo desactivar: ${updateError.message}` }, { status: 503 });
  }

  const { error: cancelError } = await supabase
    .from("dulabs_marketplace_activaciones")
    .update({ estado: "cancelada", updated_at: new Date().toISOString() })
    .eq("id", cliente.marketplace_activacion_id)
    .eq("id_tenant", miembro.tenantId);
  if (cancelError) {
    return Response.json({ error: `No se pudo desactivar: ${cancelError.message}` }, { status: 503 });
  }

  return Response.json({ success: true });
}
