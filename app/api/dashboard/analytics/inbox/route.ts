import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";
import { resolverPeriodo } from "@/lib/analytics/periodo";

export const runtime = "nodejs";

const TOPE_FILAS = 5000;

type FilaEvento = {
  tipo: string;
  miembro_id: number | null;
  detalle: { motivo?: string } | null;
  created_at: string;
};

// Fase 10 (Analytics, autorizado) -- métricas del Human Inbox (F9),
// reutilizando dulabs_conversacion_eventos tal cual: esa tabla ya se creó
// en la Fase 1 de asignaciones (20260718090200) con el comentario explícito
// "pensada para reportes de desempeño de equipo más adelante" -- este
// endpoint es exactamente ese "más adelante". Cero tabla nueva.
//
// Los conteos de estado de conversación (open/pending/closed, IA/humano,
// asignadas/sin asignar) NO viven acá -- ya los sirve
// GET /api/dashboard/analytics/conversaciones, para no definir "conversación
// abierta" dos veces en dos endpoints distintos que se puedan desincronizar.
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

  const resultadoPeriodo = resolverPeriodo(request.nextUrl.searchParams);
  if (!resultadoPeriodo.ok) return Response.json({ error: resultadoPeriodo.error }, { status: 400 });
  const { desde, hasta } = resultadoPeriodo.periodo;

  const { data: negocios, error: negociosError } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id")
    .eq("id_tenant", miembro.tenantId);
  if (negociosError) return Response.json({ error: negociosError.message }, { status: 500 });
  const phoneNumberIds = (negocios ?? []).map((n) => n.phone_number_id);

  const basePeriodo = { desde: desde.toISOString(), hasta: hasta.toISOString() };
  if (phoneNumberIds.length === 0) {
    return Response.json({
      periodo: basePeriodo,
      handoffs: { aHumano: 0, aIA: 0 },
      porAgente: [],
    });
  }

  const { data: miembrosTenant } = await supabase
    .from("dulabs_miembros_equipo")
    .select("id, email, nombre")
    .eq("tenant_id", miembro.tenantId);
  const miembroPorId = new Map((miembrosTenant ?? []).map((m) => [m.id, m]));

  const { data: eventos, error: eventosError } = await supabase
    .from("dulabs_conversacion_eventos")
    .select("tipo, miembro_id, detalle, created_at")
    .in("phone_number_id", phoneNumberIds)
    .gte("created_at", desde.toISOString())
    .lte("created_at", hasta.toISOString())
    .limit(TOPE_FILAS);
  if (eventosError) return Response.json({ error: eventosError.message }, { status: 500 });

  const filas = (eventos ?? []) as FilaEvento[];

  let handoffsAHumano = 0;
  let handoffsAIA = 0;
  const porAgente = new Map<number, { asignaciones: number; mensajesEnviados: number }>();

  for (const e of filas) {
    if (e.tipo === "asignado" && e.detalle?.motivo === "handoff_tomado") handoffsAHumano++;
    if (e.tipo === "liberado" && e.detalle?.motivo === "devuelto_a_ia") handoffsAIA++;

    if (e.miembro_id === null) continue;
    const acc = porAgente.get(e.miembro_id) ?? { asignaciones: 0, mensajesEnviados: 0 };
    if (e.tipo === "asignado" || e.tipo === "reasignado") acc.asignaciones++;
    if (e.tipo === "mensaje_enviado") acc.mensajesEnviados++;
    porAgente.set(e.miembro_id, acc);
  }

  // Snapshot ACTUAL (no acotado por período -- "cuántas tiene hoy cada
  // agente" es un estado, no un evento) de conversaciones activas por
  // agente, para no obligar al dashboard a otra llamada.
  const { data: asignacionesActuales } = await supabase
    .from("dulabs_conversacion_asignaciones")
    .select("miembro_id")
    .in("phone_number_id", phoneNumberIds)
    .not("miembro_id", "is", null);
  const conversacionesActualesPorAgente = new Map<number, number>();
  for (const a of asignacionesActuales ?? []) {
    if (a.miembro_id === null) continue;
    conversacionesActualesPorAgente.set(a.miembro_id, (conversacionesActualesPorAgente.get(a.miembro_id) ?? 0) + 1);
  }

  const idsAgentes = new Set([...porAgente.keys(), ...conversacionesActualesPorAgente.keys()]);
  const resultadoPorAgente = [...idsAgentes].map((miembroId) => {
    const m = miembroPorId.get(miembroId);
    const actividad = porAgente.get(miembroId) ?? { asignaciones: 0, mensajesEnviados: 0 };
    return {
      miembroId,
      nombre: m?.nombre || m?.email || `Miembro ${miembroId}`,
      asignacionesEnPeriodo: actividad.asignaciones,
      mensajesEnviadosEnPeriodo: actividad.mensajesEnviados,
      conversacionesActuales: conversacionesActualesPorAgente.get(miembroId) ?? 0,
    };
  });
  resultadoPorAgente.sort((a, b) => b.mensajesEnviadosEnPeriodo - a.mensajesEnviadosEnPeriodo);

  return Response.json({
    periodo: basePeriodo,
    handoffs: { aHumano: handoffsAHumano, aIA: handoffsAIA },
    porAgente: resultadoPorAgente,
  });
}
