import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";
import { leerEstadosConversacion, estadoEfectivo } from "@/lib/conversacion-estado";
import { resolverUltimoMensajePorConversacion } from "@/lib/conversaciones-inbox";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";

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

  const limiteExcedido = await respuestaSiLimiteTasaExcedido(supabase, {
    recurso: "conversaciones-lista",
    tenantId: miembro.tenantId,
    categoria: "lectura",
  });
  if (limiteExcedido) return limiteExcedido;

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio")
    .eq("id_tenant", miembro.tenantId);
  if (negociosError) return Response.json({ error: negociosError.message }, { status: 500 });

  const phoneNumberIds = (negocios ?? []).map((n) => n.phone_number_id);
  if (phoneNumberIds.length === 0) return Response.json({ conversaciones: [] });

  // Fase 10 (Scalability, autorizado) -- hallazgo F10-B: esta lista ya NO
  // se construye recortando los 500 mensajes más recientes de todo el
  // tenant (eso podía hacer desaparecer conversaciones reales pero poco
  // activas bajo tráfico alto y desparejo). Ver lib/conversaciones-inbox.ts.
  let ultimos;
  try {
    ultimos = await resolverUltimoMensajePorConversacion(supabase, phoneNumberIds);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  // Ventana acotada de mensajes recientes SOLO para aproximar el conteo de
  // "no leídos" por conversación (ver más abajo) -- no leído es, por
  // definición, algo cercano en el tiempo, así que un tope razonable acá no
  // pierde información práctica del mismo modo en que perder la conversación
  // completa de la lista sí lo hacía.
  const { data: mensajesRecientes, error } = await supabase
    .from("dulabs_mensajes_log")
    .select("phone_number_id, telefono_cliente, direccion, created_at")
    .in("phone_number_id", phoneNumberIds)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const nombrePorNumero = new Map((negocios ?? []).map((n) => [n.phone_number_id, n.nombre_negocio]));

  const conversaciones = ultimos.map((m) => ({
    phone_number_id: m.phone_number_id,
    telefono_cliente: m.telefono_cliente,
    nombre_negocio: nombrePorNumero.get(m.phone_number_id) ?? m.phone_number_id,
    ultimo_mensaje: m.contenido,
    ultima_direccion: m.direccion,
    ultima_fecha: m.created_at,
  }));

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

  // Fase 9 (Human Inbox, autorizado) — estado explícito (open/pending/closed)
  // + no leídos. Tolera la migración 20260929000000 sin aplicar (ver
  // lib/conversacion-estado.ts): sin tabla, toda conversación cae al
  // default seguro (open, no leída) -- el Inbox YA desplegado nunca se
  // rompe por esto.
  const estadosPorClave = await leerEstadosConversacion(supabase, phoneNumberIds);
  const noLeidosPorClave = new Map<string, number>();
  for (const m of mensajesRecientes ?? []) {
    if (m.direccion !== "entrante") continue;
    const clave = `${m.phone_number_id}:${m.telefono_cliente}`;
    const fila = estadosPorClave.get(clave);
    const leidoHasta = fila?.leido_hasta ?? "1970-01-01T00:00:00.000Z";
    if (m.created_at > leidoHasta) {
      noLeidosPorClave.set(clave, (noLeidosPorClave.get(clave) ?? 0) + 1);
    }
  }

  const filtro = request.nextUrl.searchParams.get("filtro") ?? "todas"; // "mias" | "sin_asignar" | "todas" | "abiertas" | "pendientes" | "cerradas" | "ia" | "humano"
  const etiquetaIdFiltro = request.nextUrl.searchParams.get("etiqueta_id");
  const busqueda = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() || null;
  const limite = Math.min(Number(request.nextUrl.searchParams.get("limite")) || 100, 200);

  let resultado = conversaciones.map((c) => {
    const clave = `${c.phone_number_id}:${c.telefono_cliente}`;
    const miembroIdAsignado = asignacionPorClave.get(clave) ?? null;
    const asignado = miembroIdAsignado ? miembroPorId.get(miembroIdAsignado) : null;
    return {
      ...c,
      pausado: pausadas.has(clave),
      asignado_a: asignado ? { miembro_id: asignado.id, nombre: asignado.nombre || asignado.email } : null,
      etiquetas: etiquetasPorClave.get(clave) ?? [],
      estado: estadoEfectivo(estadosPorClave.get(clave), c.ultima_fecha),
      no_leidos: noLeidosPorClave.get(clave) ?? 0,
    };
  });

  if (filtro === "mias") {
    resultado = resultado.filter((c) => c.asignado_a?.miembro_id === miembro.miembroId);
  } else if (filtro === "sin_asignar") {
    resultado = resultado.filter((c) => !c.asignado_a);
  } else if (filtro === "abiertas") {
    resultado = resultado.filter((c) => c.estado === "open");
  } else if (filtro === "pendientes") {
    resultado = resultado.filter((c) => c.estado === "pending");
  } else if (filtro === "cerradas") {
    resultado = resultado.filter((c) => c.estado === "closed");
  } else if (filtro === "ia") {
    resultado = resultado.filter((c) => !c.pausado);
  } else if (filtro === "humano") {
    resultado = resultado.filter((c) => c.pausado);
  }
  if (etiquetaIdFiltro) {
    const idNum = Number(etiquetaIdFiltro);
    resultado = resultado.filter((c) => c.etiquetas.some((e) => e.id === idNum));
  }
  if (busqueda) {
    resultado = resultado.filter(
      (c) =>
        c.telefono_cliente.includes(busqueda) ||
        c.nombre_negocio.toLowerCase().includes(busqueda) ||
        (c.ultimo_mensaje ?? "").toLowerCase().includes(busqueda),
    );
  }

  // Ya viene ordenado por última actividad descendente (el orden que ya
  // trae resolverUltimoMensajePorConversacion) -- el límite solo evita
  // mandar al browser una lista sin techo en un tenant con muchísima actividad.
  resultado = resultado.slice(0, limite);

  return Response.json({ conversaciones: resultado });
}
