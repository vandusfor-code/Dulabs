import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { actualizarEstadoConversacion, type EstadoConversacion } from "@/lib/conversacion-estado";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";

export const runtime = "nodejs";

const ESTADOS_VALIDOS: EstadoConversacion[] = ["open", "pending", "closed"];

// Fase 9 (Human Inbox, autorizado) — cambia el estado explícito
// (open/pending/closed) de una conversación. Ver lib/conversacion-estado.ts
// -- tolera la migración 20260929000000 todavía no aplicada (responde 503
// claro en vez de un 500 críptico, sin romper nada más del Inbox).
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
  if (!requireRol(miembro, ["admin", "agente"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  const limiteExcedido = await respuestaSiLimiteTasaExcedido(supabase, {
    recurso: "conversaciones-estado",
    tenantId: miembro.tenantId,
    categoria: "escritura",
  });
  if (limiteExcedido) return limiteExcedido;

  let body: { phone_number_id?: string; telefono_cliente?: string; estado?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, telefono_cliente, estado } = body;
  if (!phone_number_id || !telefono_cliente || !estado) {
    return Response.json({ error: "Faltan 'phone_number_id', 'telefono_cliente' o 'estado'" }, { status: 400 });
  }
  if (!ESTADOS_VALIDOS.includes(estado as EstadoConversacion)) {
    return Response.json({ error: `'estado' debe ser uno de: ${ESTADOS_VALIDOS.join(", ")}` }, { status: 400 });
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const resultado = await actualizarEstadoConversacion(supabase, {
    phoneNumberId: phone_number_id,
    telefonoCliente: telefono_cliente,
    estado: estado as EstadoConversacion,
  });
  if (!resultado.ok) {
    if (resultado.motivo === "migracion_pendiente") {
      return Response.json({ error: "El estado de conversación todavía no está disponible en este entorno" }, { status: 503 });
    }
    return Response.json({ error: resultado.mensaje ?? "Error desconocido" }, { status: 500 });
  }

  // No se registra en dulabs_conversacion_eventos: su constraint de `tipo`
  // (asignado/reasignado/liberado/mensaje_enviado, ver migración
  // 20260718090200) no tiene un valor que represente "cambio de estado" --
  // ampliar esa lista es una decisión de otra fase, no algo que haga falta
  // forzar acá. dulabs_conversacion_estado.updated_at ya deja rastro de
  // cuándo cambió por última vez.
  return Response.json({ success: true, estado });
}
