import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";
import { resolverPeriodo } from "@/lib/analytics/periodo";
import { resolverUltimoMensajePorConversacion } from "@/lib/conversaciones-inbox";
import { leerEstadosConversacion, estadoEfectivo } from "@/lib/conversacion-estado";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Fase 10 (Analytics, autorizado) -- conteos agregados de conversaciones
// (qué significa "abierta"/"pendiente"/"cerrada"/"IA"/"humano" se define UNA
// sola vez, en lib/conversacion-estado.ts y lib/pausas-chat.ts, y se
// reutiliza tal cual aquí y en el Inbox -- nunca una segunda definición que
// se pueda desincronizar). No devuelve la lista de conversaciones (eso ya
// lo sirve GET /api/dashboard/conversaciones), solo sus conteos.
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
    recurso: "analytics-conversaciones",
    tenantId: miembro.tenantId,
    categoria: "lectura",
  });
  if (limiteExcedido) return limiteExcedido;

  const resultadoPeriodo = resolverPeriodo(request.nextUrl.searchParams);
  if (!resultadoPeriodo.ok) return Response.json({ error: resultadoPeriodo.error }, { status: 400 });
  const { desde, hasta } = resultadoPeriodo.periodo;

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("id_tenant", miembro.tenantId);
  if (negociosError) return Response.json({ error: negociosError.message }, { status: 500 });
  const phoneNumberIds = (negocios ?? []).map((n) => n.phone_number_id);

  if (phoneNumberIds.length === 0) {
    return Response.json({
      periodo: { desde: desde.toISOString(), hasta: hasta.toISOString() },
      total: 0,
      nuevas: 0,
      porEstado: { open: 0, pending: 0, closed: 0 },
      porModo: { ia: 0, humano: 0 },
      asignacion: { asignadas: 0, sinAsignar: 0 },
      noLeidas: 0,
    });
  }

  let ultimos;
  try {
    ultimos = await resolverUltimoMensajePorConversacion(supabase, phoneNumberIds);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  const estadosPorClave = await leerEstadosConversacion(supabase, phoneNumberIds);

  const { data: pausas } = await supabase
    .from("dulabs_pausas_chat")
    .select("phone_number_id, telefono_cliente, pausado_hasta")
    .in("phone_number_id", phoneNumberIds);
  const ahora = Date.now();
  const pausadas = new Set(
    (pausas ?? [])
      .filter((p) => new Date(p.pausado_hasta).getTime() > ahora)
      .map((p) => `${p.phone_number_id}:${p.telefono_cliente}`),
  );

  const { data: asignaciones } = await supabase
    .from("dulabs_conversacion_asignaciones")
    .select("phone_number_id, telefono_cliente, miembro_id")
    .in("phone_number_id", phoneNumberIds);
  const asignadasSet = new Set(
    (asignaciones ?? [])
      .filter((a) => a.miembro_id !== null)
      .map((a) => `${a.phone_number_id}:${a.telefono_cliente}`),
  );

  const porEstado = { open: 0, pending: 0, closed: 0 };
  let asignadas = 0;
  let humano = 0;
  let noLeidas = 0;

  for (const m of ultimos) {
    const clave = `${m.phone_number_id}:${m.telefono_cliente}`;
    const estado = estadoEfectivo(estadosPorClave.get(clave), m.created_at);
    porEstado[estado]++;
    if (pausadas.has(clave)) humano++;
    if (asignadasSet.has(clave)) asignadas++;
    const leidoHasta = estadosPorClave.get(clave)?.leido_hasta ?? "1970-01-01T00:00:00.000Z";
    if (m.direccion === "entrante" && m.created_at > leidoHasta) noLeidas++;
  }

  // Tolerante a que la migración de F10 no esté aplicada todavía (mismo
  // criterio que resolverUltimoMensajePorConversacion): sin la función RPC,
  // "nuevas" viaja en null en vez de romper el resto del endpoint.
  let nuevas: number | null = null;
  const { data: nuevasData, error: nuevasError } = await supabase.rpc("dulabs_conversaciones_nuevas_contar", {
    p_phone_number_ids: phoneNumberIds,
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
  });
  if (nuevasError) {
    console.error(
      "[analytics/conversaciones] RPC dulabs_conversaciones_nuevas_contar no disponible (¿falta aplicar la migración de F10?):",
      nuevasError.message,
    );
  } else {
    nuevas = typeof nuevasData === "number" ? nuevasData : Number(nuevasData);
  }

  return Response.json({
    periodo: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    total: ultimos.length,
    nuevas,
    porEstado,
    porModo: { ia: ultimos.length - humano, humano },
    asignacion: { asignadas, sinAsignar: ultimos.length - asignadas },
    noLeidas,
  });
}
