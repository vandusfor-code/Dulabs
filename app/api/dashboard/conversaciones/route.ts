import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Agrupa el historial de mensajes en "conversaciones" (una por cliente final
// por número), para alimentar la lista izquierda del inbox del dashboard.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio")
    .eq("id_tenant", userData.user.id);
  if (negociosError) return Response.json({ error: negociosError.message }, { status: 500 });

  const phoneNumberIds = (negocios ?? []).map((n) => n.phone_number_id);
  if (phoneNumberIds.length === 0) return Response.json({ conversaciones: [] });

  const { data: mensajes, error } = await supabase
    .from("dulabs_mensajes_log")
    .select("phone_number_id, telefono_cliente, direccion, contenido, created_at")
    .in("phone_number_id", phoneNumberIds)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const nombrePorNumero = new Map((negocios ?? []).map((n) => [n.phone_number_id, n.nombre_negocio]));

  // Nos quedamos con el mensaje más reciente por (phone_number_id, telefono_cliente).
  const vistos = new Set<string>();
  const conversaciones = [];
  for (const m of mensajes ?? []) {
    const clave = `${m.phone_number_id}:${m.telefono_cliente}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    conversaciones.push({
      phone_number_id: m.phone_number_id,
      telefono_cliente: m.telefono_cliente,
      nombre_negocio: nombrePorNumero.get(m.phone_number_id) ?? m.phone_number_id,
      ultimo_mensaje: m.contenido,
      ultima_direccion: m.direccion,
      ultima_fecha: m.created_at,
    });
  }

  // Estado de pausa humana por conversación.
  const { data: pausas } = await supabase
    .from("dulabs_pausas_chat")
    .select("phone_number_id, telefono_cliente, pausado_hasta")
    .in("phone_number_id", phoneNumberIds);
  const ahora = Date.now();
  const pausadas = new Set(
    (pausas ?? [])
      .filter((p) => new Date(p.pausado_hasta).getTime() > ahora)
      .map((p) => `${p.phone_number_id}:${p.telefono_cliente}`)
  );

  const resultado = conversaciones.map((c) => ({
    ...c,
    pausado: pausadas.has(`${c.phone_number_id}:${c.telefono_cliente}`),
  }));

  return Response.json({ conversaciones: resultado });
}
