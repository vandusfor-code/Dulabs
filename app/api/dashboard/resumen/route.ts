import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const ESTADOS_PENDIENTES = ["pendiente", "PENDING", "IN_APPEAL"];
const TOPE_RESPUESTA_SEG = 3600; // gaps más largos se asumen un hilo nuevo, no una respuesta

type FilaMensaje = {
  phone_number_id: string;
  telefono_cliente: string;
  direccion: string;
  origen: string;
  created_at: string;
};

function agruparPorConversacion(filas: FilaMensaje[]): Map<string, FilaMensaje[]> {
  const grupos = new Map<string, FilaMensaje[]>();
  for (const f of filas) {
    const clave = `${f.phone_number_id}:${f.telefono_cliente}`;
    const lista = grupos.get(clave) ?? [];
    lista.push(f);
    grupos.set(clave, lista);
  }
  for (const lista of grupos.values()) {
    lista.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  return grupos;
}

function tiempoRespuestaPromedioSeg(grupos: Map<string, FilaMensaje[]>): number | null {
  const gaps: number[] = [];
  for (const lista of grupos.values()) {
    for (let i = 0; i < lista.length - 1; i++) {
      const actual = lista[i];
      const siguiente = lista[i + 1];
      if (actual.direccion === "entrante" && siguiente.direccion === "saliente" && siguiente.origen === "ia") {
        const gap = (new Date(siguiente.created_at).getTime() - new Date(actual.created_at).getTime()) / 1000;
        if (gap > 0 && gap <= TOPE_RESPUESTA_SEG) gaps.push(gap);
      }
    }
  }
  if (gaps.length === 0) return null;
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

function conversacionesSinResponder(grupos: Map<string, FilaMensaje[]>): number {
  let total = 0;
  for (const lista of grupos.values()) {
    if (lista[lista.length - 1].direccion === "entrante") total++;
  }
  return total;
}

// Datos reales para el Command Center: conversaciones de las últimas 24h,
// tasa de automatización real (origen ia vs manual), tiempo de respuesta
// promedio real, mejor número por tasa de automatización, actividad
// reciente, plantillas esperando aprobación, campañas de hoy y consumo real
// por categoría de precio de Meta.
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
    .select("phone_number_id, nombre_negocio, nombre_agente")
    .eq("id_tenant", userData.user.id);
  if (negociosError) return Response.json({ error: negociosError.message }, { status: 500 });
  const phoneNumberIds = (negocios ?? []).map((n) => n.phone_number_id);
  const nombrePorNumero = new Map(
    (negocios ?? []).map((n) => [n.phone_number_id, n.nombre_agente || `Asistente de ${n.nombre_negocio}`])
  );

  const ahora = new Date();
  const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  const hace48h = new Date(ahora.getTime() - 48 * 60 * 60 * 1000);
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const inicioHoy = new Date(ahora);
  inicioHoy.setHours(0, 0, 0, 0);

  let conversaciones24h = 0;
  let automatizadas24h = 0;
  let manualesTotal24h = 0;
  let iaTotal24h = 0;
  let sinResponder24h = 0;
  let tiempoRespuestaSeg: number | null = null;
  let mejorAgente: { nombre: string; tasaAutomatizacion: number } | null = null;
  const actividadReciente: { tipo: string; descripcion: string; created_at: string }[] = [];
  const porCategoriaMes = new Map<string, number>();
  let deltaConversacionesPct: number | null = null;
  let deltaAutomatizacionPts: number | null = null;
  let deltaTiempoRespuestaSeg: number | null = null;

  if (phoneNumberIds.length > 0) {
    // 48h para poder comparar "hoy" (últimas 24h) vs "ayer" (24h-48h atrás) con datos reales.
    const { data: mensajes48hRaw, error: mensajesError } = await supabase
      .from("dulabs_mensajes_log")
      .select("phone_number_id, telefono_cliente, direccion, origen, created_at")
      .in("phone_number_id", phoneNumberIds)
      .gte("created_at", hace48h.toISOString())
      .order("created_at", { ascending: false });
    if (mensajesError) return Response.json({ error: mensajesError.message }, { status: 500 });

    const todasFilas = (mensajes48hRaw ?? []) as FilaMensaje[];
    const filas = todasFilas.filter((f) => new Date(f.created_at) >= hace24h);
    const filasAyer = todasFilas.filter((f) => new Date(f.created_at) < hace24h);
    const salientes = filas.filter((f) => f.direccion === "saliente");
    const salientesAyer = filasAyer.filter((f) => f.direccion === "saliente");

    conversaciones24h = salientes.length;
    automatizadas24h = salientes.filter((m) => m.origen === "ia").length;
    iaTotal24h = automatizadas24h;
    manualesTotal24h = salientes.filter((m) => m.origen === "manual").length;

    const conversacionesAyer = salientesAyer.length;
    const automatizadasAyer = salientesAyer.filter((m) => m.origen === "ia").length;
    deltaConversacionesPct = conversacionesAyer > 0 ? (conversaciones24h - conversacionesAyer) / conversacionesAyer : null;
    const tasaHoy = conversaciones24h > 0 ? automatizadas24h / conversaciones24h : 0;
    const tasaAyer = conversacionesAyer > 0 ? automatizadasAyer / conversacionesAyer : null;
    deltaAutomatizacionPts = tasaAyer !== null ? tasaHoy - tasaAyer : null;

    const grupos = agruparPorConversacion(filas);
    sinResponder24h = conversacionesSinResponder(grupos);
    tiempoRespuestaSeg = tiempoRespuestaPromedioSeg(grupos);
    const tiempoRespuestaAyerSeg = tiempoRespuestaPromedioSeg(agruparPorConversacion(filasAyer));
    deltaTiempoRespuestaSeg =
      tiempoRespuestaSeg !== null && tiempoRespuestaAyerSeg !== null ? tiempoRespuestaSeg - tiempoRespuestaAyerSeg : null;

    // Mejor número por tasa de automatización real (solo tiene sentido con >1 número).
    if (phoneNumberIds.length > 1) {
      const porNumero = new Map<string, { ia: number; total: number }>();
      for (const s of salientes) {
        const acc = porNumero.get(s.phone_number_id) ?? { ia: 0, total: 0 };
        acc.total++;
        if (s.origen === "ia") acc.ia++;
        porNumero.set(s.phone_number_id, acc);
      }
      let mejor: { phoneNumberId: string; tasa: number } | null = null;
      for (const [phoneNumberId, { ia, total }] of porNumero) {
        if (total === 0) continue;
        const tasa = ia / total;
        if (!mejor || tasa > mejor.tasa) mejor = { phoneNumberId, tasa };
      }
      if (mejor) {
        mejorAgente = {
          nombre: nombrePorNumero.get(mejor.phoneNumberId) ?? "Tu asistente",
          tasaAutomatizacion: mejor.tasa,
        };
      }
    }

    // Actividad reciente (últimos 8 eventos reales, sin categorizar el motivo).
    const dueño = (userData.user.user_metadata?.nombre as string | undefined) ?? userData.user.email?.split("@")[0] ?? "Tú";
    for (const f of filas.slice(0, 8)) {
      const agente = nombrePorNumero.get(f.phone_number_id) ?? "Tu asistente";
      let descripcion: string;
      if (f.direccion === "entrante") descripcion = "Un cliente escribió";
      else if (f.origen === "ia") descripcion = `${agente} respondió`;
      else if (f.origen === "campaña") descripcion = `${agente} envió una campaña`;
      else descripcion = `${dueño} respondió manualmente`;
      actividadReciente.push({ tipo: f.origen || f.direccion, descripcion, created_at: f.created_at });
    }

    const { data: mensajesMes, error: mesError } = await supabase
      .from("dulabs_mensajes_log")
      .select("pricing_categoria")
      .in("phone_number_id", phoneNumberIds)
      .gte("created_at", inicioMes.toISOString())
      .not("pricing_categoria", "is", null);
    if (mesError) return Response.json({ error: mesError.message }, { status: 500 });

    for (const m of mensajesMes ?? []) {
      const cat = m.pricing_categoria as string;
      porCategoriaMes.set(cat, (porCategoriaMes.get(cat) ?? 0) + 1);
    }
  }

  const { count: plantillasPendientes, error: plantillasError } = await supabase
    .from("dulabs_plantillas")
    .select("id", { count: "exact", head: true })
    .eq("id_tenant", userData.user.id)
    .eq("borrador", false)
    .in("estado", ESTADOS_PENDIENTES);
  if (plantillasError) return Response.json({ error: plantillasError.message }, { status: 500 });

  const { count: campanasHoy, error: campanasError } = await supabase
    .from("dulabs_campanas")
    .select("id", { count: "exact", head: true })
    .eq("id_tenant", userData.user.id)
    .gte("created_at", inicioHoy.toISOString());
  if (campanasError) return Response.json({ error: campanasError.message }, { status: 500 });

  return Response.json({
    conversaciones24h,
    tasaAutomatizacion: conversaciones24h > 0 ? automatizadas24h / conversaciones24h : 0,
    plantillasPendientes: plantillasPendientes ?? 0,
    campanasHoy: campanasHoy ?? 0,
    porCategoriaMes: Array.from(porCategoriaMes, ([categoria, cantidad]) => ({ categoria, cantidad })),
    tiempoRespuestaSeg,
    mejorAgente,
    autopilot: { resueltoPorIA: iaTotal24h, atendidoManual: manualesTotal24h, sinResponder: sinResponder24h },
    actividadReciente,
    deltaConversacionesPct,
    deltaAutomatizacionPts,
    deltaTiempoRespuestaSeg,
  });
}
