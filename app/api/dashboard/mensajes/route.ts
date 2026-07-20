import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { enviarTexto, dentroVentana24h } from "@/lib/whatsapp";
import { descifrarSecreto } from "@/lib/crypto";

export const runtime = "nodejs";

// Historial reciente de mensajes de todos los números del tenant, para la
// vista de actividad del dashboard. Solo se muestran los números propios
// (se filtra primero qué phone_number_id pertenecen a este id_tenant).
export async function GET(request: NextRequest) {
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
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 });

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio")
    .eq("id_tenant", miembro.tenantId);
  if (negociosError) {
    return Response.json({ error: negociosError.message }, { status: 500 });
  }

  const phoneNumberIds = (negocios ?? []).map((n) => n.phone_number_id);
  if (phoneNumberIds.length === 0) {
    return Response.json({ mensajes: [] });
  }

  // Filtro opcional a un solo hilo (vista de conversación en el inbox).
  const telefonoCliente = request.nextUrl.searchParams.get("telefono_cliente");
  const phoneNumberIdFiltro = request.nextUrl.searchParams.get("phone_number_id");

  let query = supabase
    .from("dulabs_mensajes_log")
    .select("phone_number_id, telefono_cliente, direccion, contenido, created_at")
    .in("phone_number_id", phoneNumberIds);

  if (telefonoCliente && phoneNumberIdFiltro) {
    query = query
      .eq("telefono_cliente", telefonoCliente)
      .eq("phone_number_id", phoneNumberIdFiltro)
      .order("created_at", { ascending: true })
      .limit(200);
  } else {
    query = query.order("created_at", { ascending: false }).limit(100);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const nombrePorNumero = new Map((negocios ?? []).map((n) => [n.phone_number_id, n.nombre_negocio]));
  const mensajes = (data ?? []).map((m) => ({
    ...m,
    nombre_negocio: nombrePorNumero.get(m.phone_number_id) ?? m.phone_number_id,
  }));

  return Response.json({ mensajes });
}

const MAX_TEXTO = 4096; // límite de texto libre de WhatsApp

// Responder desde el Inbox web (rol admin o agente). Solo funciona dentro de
// la ventana de servicio al cliente de 24h; fuera de ella hay que usar una
// plantilla aprobada (Plantillas y campañas). Autoasigna la conversación si
// estaba sin asignar, sin quitarle nunca la asignación a otro compañero.
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
    return Response.json({ error: "No tienes permiso para enviar mensajes" }, { status: 403 });
  }

  let body: { phone_number_id?: string; telefono_cliente?: string; texto?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, telefono_cliente } = body;
  const texto = body.texto?.trim();
  if (!phone_number_id || !telefono_cliente || !texto) {
    return Response.json({ error: "Faltan 'phone_number_id', 'telefono_cliente' o 'texto'" }, { status: 400 });
  }
  if (texto.length > MAX_TEXTO) {
    return Response.json({ error: `El mensaje no puede superar ${MAX_TEXTO} caracteres` }, { status: 400 });
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("*")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const dentroVentana = await dentroVentana24h(supabase, phone_number_id, telefono_cliente);
  if (!dentroVentana) {
    return Response.json(
      {
        error: "Han pasado más de 24h desde el último mensaje del cliente. Usa una plantilla aprobada.",
        fuera_de_ventana: true,
      },
      { status: 409 }
    );
  }

  const metaToken = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
  if (!metaToken) return Response.json({ error: "Sin token de Meta para este número" }, { status: 500 });

  let wamid: string | null = null;
  try {
    ({ wamid } = await enviarTexto({ phoneNumberId: phone_number_id, token: metaToken, para: telefono_cliente, texto }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  await supabase.from("dulabs_mensajes_log").insert({
    phone_number_id,
    telefono_cliente,
    direccion: "saliente",
    contenido: texto,
    origen: "agente",
    wamid,
  });

  const mesHoy = new Date().toISOString().slice(0, 7);
  const nuevoUsados = cliente.mes_actual === mesHoy ? cliente.mensajes_usados_mes + 1 : 1;
  await supabase
    .from("dulabs_clientes_config")
    .update({ mensajes_usados_mes: nuevoUsados, mes_actual: mesHoy })
    .eq("id", cliente.id);

  // Autoasignación: solo rellena si la conversación está SIN asignar; nunca
  // le quita la conversación a otro miembro del equipo.
  const { data: asignacionExistente } = await supabase
    .from("dulabs_conversacion_asignaciones")
    .select("id, miembro_id")
    .eq("phone_number_id", phone_number_id)
    .eq("telefono_cliente", telefono_cliente)
    .maybeSingle();

  if (!asignacionExistente) {
    await supabase.from("dulabs_conversacion_asignaciones").insert({
      phone_number_id,
      telefono_cliente,
      miembro_id: miembro.miembroId,
      asignado_por: miembro.miembroId,
    });
    await supabase.from("dulabs_conversacion_eventos").insert({
      phone_number_id,
      telefono_cliente,
      tipo: "asignado",
      miembro_id: miembro.miembroId,
    });
  } else if (!asignacionExistente.miembro_id) {
    await supabase
      .from("dulabs_conversacion_asignaciones")
      .update({ miembro_id: miembro.miembroId, asignado_por: miembro.miembroId, updated_at: new Date().toISOString() })
      .eq("id", asignacionExistente.id);
    await supabase.from("dulabs_conversacion_eventos").insert({
      phone_number_id,
      telefono_cliente,
      tipo: "asignado",
      miembro_id: miembro.miembroId,
    });
  }

  await supabase.from("dulabs_conversacion_eventos").insert({
    phone_number_id,
    telefono_cliente,
    tipo: "mensaje_enviado",
    miembro_id: miembro.miembroId,
    detalle: { wamid, longitud: texto.length },
  });

  return Response.json({ success: true, wamid });
}
