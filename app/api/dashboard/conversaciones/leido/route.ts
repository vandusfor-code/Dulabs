import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { marcarConversacionLeida } from "@/lib/conversacion-estado";

export const runtime = "nodejs";

// Fase 9 (Human Inbox, autorizado) — marca una conversación como leída
// (unread vuelve a 0 hasta el próximo mensaje entrante). Ver
// lib/conversacion-estado.ts -- tolera la migración 20260929000000 todavía
// no aplicada (503 claro, nunca rompe el resto del Inbox).
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin", "agente", "lectura"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: { phone_number_id?: string; telefono_cliente?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, telefono_cliente } = body;
  if (!phone_number_id || !telefono_cliente) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'telefono_cliente'" }, { status: 400 });
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const resultado = await marcarConversacionLeida(supabase, { phoneNumberId: phone_number_id, telefonoCliente: telefono_cliente });
  if (!resultado.ok) {
    if (resultado.motivo === "migracion_pendiente") {
      return Response.json({ error: "El estado de lectura todavía no está disponible en este entorno" }, { status: 503 });
    }
    return Response.json({ error: resultado.mensaje ?? "Error desconocido" }, { status: 500 });
  }

  return Response.json({ success: true });
}
