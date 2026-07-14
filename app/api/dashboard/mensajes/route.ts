import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

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

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio")
    .eq("id_tenant", userData.user.id);
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
