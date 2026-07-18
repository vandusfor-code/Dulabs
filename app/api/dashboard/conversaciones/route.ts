import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";

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
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ error: "No perteneces a ningún equipo activo" }, { status: 403 });

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio")
    .eq("id_tenant", miembro.tenantId);
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

  // Asignación de equipo por conversación.
  const { data: asignaciones } = await supabase
    .from("dulabs_conversacion_asignaciones")
    .select("phone_number_id, telefono_cliente, miembro_id")
    .in("phone_number_id", phoneNumberIds);
  const { data: miembrosTenant } = await supabase
    .from("dulabs_miembros_equipo")
    .select("id, email, nombre")
    .eq("tenant_id", miembro.tenantId);
  const miembroPorId = new Map((miembrosTenant ?? []).map((m) => [m.id, m]));
  const asignacionPorClave = new Map(
    (asignaciones ?? []).map((a) => [`${a.phone_number_id}:${a.telefono_cliente}`, a.miembro_id])
  );

  // Etiquetas por conversación (muchos-a-muchos, a diferencia de la
  // asignación que es 1:1 — se agrupa en un array por clave).
  const { data: etiquetasTenant } = await supabase
    .from("dulabs_etiquetas")
    .select("id, nombre, color")
    .eq("tenant_id", miembro.tenantId);
  const etiquetaPorId = new Map((etiquetasTenant ?? []).map((e) => [e.id, e]));
  const { data: conversacionEtiquetas } = await supabase
    .from("dulabs_conversacion_etiquetas")
    .select("phone_number_id, telefono_cliente, etiqueta_id")
    .in("phone_number_id", phoneNumberIds);
  const etiquetasPorClave = new Map<string, { id: number; nombre: string; color: string }[]>();
  for (const ce of conversacionEtiquetas ?? []) {
    const etiqueta = etiquetaPorId.get(ce.etiqueta_id);
    if (!etiqueta) continue;
    const clave = `${ce.phone_number_id}:${ce.telefono_cliente}`;
    const lista = etiquetasPorClave.get(clave) ?? [];
    lista.push(etiqueta);
    etiquetasPorClave.set(clave, lista);
  }

  const filtro = request.nextUrl.searchParams.get("filtro") ?? "todas"; // "mias" | "sin_asignar" | "todas"
  const etiquetaIdFiltro = request.nextUrl.searchParams.get("etiqueta_id");

  let resultado = conversaciones.map((c) => {
    const clave = `${c.phone_number_id}:${c.telefono_cliente}`;
    const miembroIdAsignado = asignacionPorClave.get(clave) ?? null;
    const asignado = miembroIdAsignado ? miembroPorId.get(miembroIdAsignado) : null;
    return {
      ...c,
      pausado: pausadas.has(clave),
      asignado_a: asignado ? { miembro_id: asignado.id, nombre: asignado.nombre || asignado.email } : null,
      etiquetas: etiquetasPorClave.get(clave) ?? [],
    };
  });

  if (filtro === "mias") {
    resultado = resultado.filter((c) => c.asignado_a?.miembro_id === miembro.miembroId);
  } else if (filtro === "sin_asignar") {
    resultado = resultado.filter((c) => !c.asignado_a);
  }
  if (etiquetaIdFiltro) {
    const idNum = Number(etiquetaIdFiltro);
    resultado = resultado.filter((c) => c.etiquetas.some((e) => e.id === idNum));
  }

  return Response.json({ conversaciones: resultado });
}
