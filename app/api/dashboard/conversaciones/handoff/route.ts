import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { activarPausaChat, liberarPausaChat } from "@/lib/pausas-chat";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Fase 9 (Human Inbox, autorizado) — handoff EXPLÍCITO desde el Inbox web,
// distinto de los dos mecanismos que ya existían antes de esta fase (el eco
// de coexistencia cuando el dueño responde desde su celular, y el action
// node "transferir_soporte" que el propio Flow puede disparar): acá un
// agente puede tomar/devolver una conversación con un click, sin necesitar
// mandar un WhatsApp real desde su teléfono ni depender de que el Flow lo
// decida. Reutiliza EXACTAMENTE la misma tabla (dulabs_pausas_chat) que ya
// consulta atenderMensaje (app/webhook-dulabs/route.ts) antes de dejar
// responder a la IA -- cero mecanismo paralelo.
//
// "tomar": 30 días de pausa (D-2592000000 ms) -- deliberadamente MUCHO más
// larga que las 24h del eco/transferir_soporte, porque acá la decisión es
// explícita y humana (un agente la tomó a propósito), no un traspaso
// temporal con expiración esperada. "Devolver a IA" la libera antes,
// explícitamente, sin depender de que expire sola.
const DURACION_TOMAR_MS = 30 * 24 * 60 * 60 * 1000;

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
    recurso: "conversaciones-handoff",
    tenantId: miembro.tenantId,
    categoria: "escritura",
  });
  if (limiteExcedido) return limiteExcedido;

  let body: { phone_number_id?: string; telefono_cliente?: string; accion?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, telefono_cliente, accion } = body;
  if (!phone_number_id || !telefono_cliente) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'telefono_cliente'" }, { status: 400 });
  }
  if (accion !== "tomar" && accion !== "devolver_a_ia") {
    return Response.json({ error: "'accion' debe ser 'tomar' o 'devolver_a_ia'" }, { status: 400 });
  }

  // Ownership real -- fail-closed, nunca toca la pausa de un número que no
  // pertenezca al tenant del que hace la petición (mismo patrón que
  // app/api/dashboard/mensajes/route.ts).
  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  if (accion === "tomar") {
    const resultado = await activarPausaChat(supabase, phone_number_id, telefono_cliente, DURACION_TOMAR_MS);
    if (!resultado.ok) return Response.json({ error: "No se pudo tomar la conversación" }, { status: 500 });

    // Autoasignación al agente que la toma, mismo criterio que el
    // autoasignado-al-responder de app/api/dashboard/mensajes/route.ts --
    // nunca le quita la conversación a otro compañero que ya la tuviera.
    const { data: asignacionExistente } = await supabase
      .from("dulabs_conversacion_asignaciones")
      .select("id, miembro_id")
      .eq("phone_number_id", phone_number_id)
      .eq("telefono_cliente", telefono_cliente)
      .maybeSingle();
    if (!asignacionExistente) {
      // Fase 10 (Concurrencia, autorizado) -- hallazgo: dos agentes pueden
      // tocar "Tomar" casi al mismo tiempo sobre la misma conversación sin
      // asignación previa; ambos leen asignacionExistente=null y ambos
      // intentan este INSERT. El UNIQUE (phone_number_id, telefono_cliente)
      // de la tabla ya lo resuelve de forma determinista (gana el primero),
      // pero antes de esta fase el error de esa carrera se ignoraba en
      // silencio -- el agente que perdía la carrera igual recibía
      // {success:true}, dando a entender que la conversación quedó suya
      // cuando en realidad la tiene su compañero. La pausa de IA queda
      // activa de cualquier forma (activarPausaChat es idempotente), así
      // que lo único que corregimos es no mentir sobre quién quedó asignado.
      const { error: insertError } = await supabase.from("dulabs_conversacion_asignaciones").insert({
        phone_number_id,
        telefono_cliente,
        miembro_id: miembro.miembroId,
        asignado_por: miembro.miembroId,
      });
      if (insertError && insertError.code !== "23505") {
        return Response.json({ error: "No se pudo asignar la conversación" }, { status: 500 });
      }
    } else if (!asignacionExistente.miembro_id) {
      await supabase
        .from("dulabs_conversacion_asignaciones")
        .update({ miembro_id: miembro.miembroId, asignado_por: miembro.miembroId, updated_at: new Date().toISOString() })
        .eq("id", asignacionExistente.id);
    }

    await supabase.from("dulabs_conversacion_eventos").insert({
      phone_number_id,
      telefono_cliente,
      tipo: "asignado",
      miembro_id: miembro.miembroId,
      detalle: { motivo: "handoff_tomado" },
    });

    return Response.json({ success: true, modo: "human" });
  }

  // accion === "devolver_a_ia"
  const resultado = await liberarPausaChat(supabase, phone_number_id, telefono_cliente);
  if (!resultado.ok) return Response.json({ error: "No se pudo devolver la conversación a la IA" }, { status: 500 });

  await supabase.from("dulabs_conversacion_eventos").insert({
    phone_number_id,
    telefono_cliente,
    tipo: "liberado",
    miembro_id: miembro.miembroId,
    detalle: { motivo: "devuelto_a_ia" },
  });

  return Response.json({ success: true, modo: "ai" });
}
