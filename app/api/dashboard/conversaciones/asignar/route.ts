import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Fase 9 (Human Inbox, autorizado) — asignar/reasignar/quitar asignación de
// una conversación de forma EXPLÍCITA desde el Inbox (antes de esta fase
// solo se autoasignaba al responder un mensaje, ver POST /api/dashboard/mensajes).
// Reutiliza dulabs_conversacion_asignaciones/dulabs_conversacion_eventos tal
// cual (Fase F7-adyacente, ya existentes) -- ninguna tabla nueva.
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
    recurso: "conversaciones-asignar",
    tenantId: miembro.tenantId,
    categoria: "escritura",
  });
  if (limiteExcedido) return limiteExcedido;

  let body: { phone_number_id?: string; telefono_cliente?: string; miembro_id?: number | null };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, telefono_cliente } = body;
  if (!phone_number_id || !telefono_cliente) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'telefono_cliente'" }, { status: 400 });
  }
  const miembroIdDestino = body.miembro_id === undefined ? undefined : body.miembro_id;
  if (miembroIdDestino === undefined) {
    return Response.json({ error: "Falta 'miembro_id' (número para asignar, null para quitar la asignación)" }, { status: 400 });
  }

  // Un agente (no-admin) solo puede asignarse A SÍ MISMO o quitarse a sí
  // mismo -- reasignar a otro compañero, o quitarle la conversación a otro,
  // es exclusivo de admin. Evita que "agente" se convierta en un rol con
  // control total sobre las colas de trabajo de sus compañeros.
  if (miembro.rol !== "admin") {
    const esAsignarmeOQuitarme = miembroIdDestino === miembro.miembroId || miembroIdDestino === null;
    if (!esAsignarmeOQuitarme) {
      return Response.json({ error: "Solo un admin puede reasignar a otro miembro del equipo" }, { status: 403 });
    }
  }

  // Ownership real del número -- fail-closed.
  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  // El miembro DESTINO (si no es null) debe pertenecer al MISMO tenant --
  // nunca se puede asignar la conversación de un tenant a un agente de otro.
  if (miembroIdDestino !== null) {
    const { data: miembroDestino, error: miembroDestinoError } = await supabase
      .from("dulabs_miembros_equipo")
      .select("id")
      .eq("id", miembroIdDestino)
      .eq("tenant_id", miembro.tenantId)
      .eq("estado", "activo")
      .maybeSingle();
    if (miembroDestinoError) return Response.json({ error: miembroDestinoError.message }, { status: 500 });
    if (!miembroDestino) return Response.json({ error: "Miembro de equipo no encontrado" }, { status: 404 });
  }

  const { data: asignacionExistente, error: existenteError } = await supabase
    .from("dulabs_conversacion_asignaciones")
    .select("id, miembro_id")
    .eq("phone_number_id", phone_number_id)
    .eq("telefono_cliente", telefono_cliente)
    .maybeSingle();
  if (existenteError) return Response.json({ error: existenteError.message }, { status: 500 });

  if (asignacionExistente) {
    const { error: updateError } = await supabase
      .from("dulabs_conversacion_asignaciones")
      .update({ miembro_id: miembroIdDestino, asignado_por: miembro.miembroId, updated_at: new Date().toISOString() })
      .eq("id", asignacionExistente.id);
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
  } else if (miembroIdDestino !== null) {
    const { error: insertError } = await supabase.from("dulabs_conversacion_asignaciones").insert({
      phone_number_id,
      telefono_cliente,
      miembro_id: miembroIdDestino,
      asignado_por: miembro.miembroId,
    });
    if (insertError) return Response.json({ error: insertError.message }, { status: 500 });
  }
  // miembroIdDestino === null Y no existía asignación -> ya estaba sin
  // asignar, no hay nada que hacer (idempotente).

  await supabase.from("dulabs_conversacion_eventos").insert({
    phone_number_id,
    telefono_cliente,
    tipo: miembroIdDestino === null ? "liberado" : asignacionExistente ? "reasignado" : "asignado",
    miembro_id: miembro.miembroId,
    detalle: { miembro_id_destino: miembroIdDestino },
  });

  return Response.json({ success: true });
}
