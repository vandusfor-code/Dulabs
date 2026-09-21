import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";
import { agruparErroresPorCampana, type FilaMensajeFallido } from "@/lib/campanas-errores";

export const runtime = "nodejs";

type FilaMensaje = {
  campana_id: number | null;
  estado_entrega: string;
  respondido: boolean;
  created_at: string;
};

function tasaOCero(numerador: number, denominador: number): number {
  return denominador > 0 ? numerador / denominador : 0;
}

function inicioSemana(fecha: Date): Date {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dia = d.getDay();
  const diff = (dia + 6) % 7; // lunes como inicio de semana
  d.setDate(d.getDate() - diff);
  return d;
}

// Métricas reales de campañas: nada de tasas inventadas — todo sale de
// dulabs_mensajes_log/dulabs_campanas, alimentados por los webhooks de
// estado de Meta (ver app/webhook-dulabs/route.ts).
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

  const { data: campanas, error: campanasError } = await supabase
    .from("dulabs_campanas")
    .select("id, nombre, plantilla_id, destinatarios_total, created_at, dulabs_plantillas(nombre, cuerpo)")
    .eq("id_tenant", miembro.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (campanasError) return Response.json({ error: campanasError.message }, { status: 500 });

  const idsCampanas = (campanas ?? []).map((c) => c.id);
  if (idsCampanas.length === 0) {
    return Response.json({ kpis: kpisVacios(), tendencia: tendenciaVacia(), campanas: [] });
  }

  // FASE F12 (Debt Zero, autorizado) — corrige el hallazgo real de F11
  // ("consulta sin límite conocida"): esta ruta traía TODO el historial de
  // dulabs_mensajes_log de hasta 50 campañas sin ningún filtro de fecha ni
  // tope, cuando la tendencia/KPIs de abajo solo necesitan las últimas 7
  // semanas (6 de tendencia + 1 extra para el delta semana-vs-semana
  // anterior). Con eso acotado, un tenant con meses/años de campañas ya no
  // hace crecer esta consulta indefinidamente con el tiempo -- el volumen
  // que sí queda (hasta 50 campañas recientes × su propio tope de
  // destinatarios por plan) es el que se usa para el funnel por campaña,
  // acotado por `LIMITE_DEFENSIVO_FUNNEL` como respaldo explícito.
  const ahora = new Date();
  const inicioEstaSemana = inicioSemana(ahora);
  const inicioSemanaPasada = new Date(inicioEstaSemana);
  inicioSemanaPasada.setDate(inicioSemanaPasada.getDate() - 7);
  const inicioVentanaTendencia = new Date(inicioEstaSemana);
  inicioVentanaTendencia.setDate(inicioVentanaTendencia.getDate() - 5 * 7);

  const { data: mensajesTendencia, error: tendenciaError } = await supabase
    .from("dulabs_mensajes_log")
    .select("campana_id, estado_entrega, respondido, created_at")
    .in("campana_id", idsCampanas)
    .gte("created_at", inicioVentanaTendencia.toISOString());
  if (tendenciaError) return Response.json({ error: tendenciaError.message }, { status: 500 });

  // Respaldo defensivo explícito para el funnel por campaña (destinatarios
  // ya está topado por plan al crear la campaña, y campañas ya está topado
  // a 50 arriba -- este LIMIT es defensa en profundidad, no la protección
  // real contra crecimiento).
  const LIMITE_DEFENSIVO_FUNNEL = 200_000;
  const { data: mensajesFunnel, error: funnelError } = await supabase
    .from("dulabs_mensajes_log")
    .select("campana_id, estado_entrega, respondido, created_at")
    .in("campana_id", idsCampanas)
    .order("created_at", { ascending: false })
    .limit(LIMITE_DEFENSIVO_FUNNEL);
  if (funnelError) return Response.json({ error: funnelError.message }, { status: 500 });

  // Causa real de cada destinatario que no recibió el mensaje (código y detalle tal cual los reportó Meta). Consulta APARTE y acotada
  // a los fallidos: no se ensanchan las columnas de la consulta grande del funnel (cuida el egreso de Supabase). La página lee
  // `erroresDetalle` de la campaña seleccionada; sin este campo se rompía al cargar para cualquier negocio con campañas enviadas.
  const LIMITE_FILAS_ERRORES = 5_000;
  const { data: mensajesFallidos, error: fallidosError } = await supabase
    .from("dulabs_mensajes_log")
    .select("campana_id, telefono_cliente, wamid, error_codigo, error_detalle")
    .in("campana_id", idsCampanas)
    .eq("estado_entrega", "fallido")
    .order("created_at", { ascending: false })
    .limit(LIMITE_FILAS_ERRORES);
  if (fallidosError) return Response.json({ error: fallidosError.message }, { status: 500 });
  const erroresPorCampana = agruparErroresPorCampana((mensajesFallidos ?? []) as FilaMensajeFallido[]);

  const filasTendencia = (mensajesTendencia ?? []) as FilaMensaje[];
  const filas = (mensajesFunnel ?? []) as FilaMensaje[];

  // --- KPIs globales + variación semana vs semana anterior --------------
  const enRango = (f: FilaMensaje, desde: Date, hasta: Date) => {
    const t = new Date(f.created_at).getTime();
    return t >= desde.getTime() && t < hasta.getTime();
  };

  const estaSemana = filasTendencia.filter((f) => enRango(f, inicioEstaSemana, ahora));
  const semanaPasada = filasTendencia.filter((f) => enRango(f, inicioSemanaPasada, inicioEstaSemana));

  const resumen = (grupo: FilaMensaje[]) => {
    const enviados = grupo.length;
    const entregados = grupo.filter((f) => f.estado_entrega === "entregado" || f.estado_entrega === "leido").length;
    const leidos = grupo.filter((f) => f.estado_entrega === "leido").length;
    const respondidos = grupo.filter((f) => f.respondido).length;
    return {
      enviados,
      tasaEntrega: tasaOCero(entregados, enviados),
      tasaLectura: tasaOCero(leidos, enviados),
      tasaRespuesta: tasaOCero(respondidos, enviados),
    };
  };

  // KPIs globales ("mensajesEnviados" total, tasas totales): igual que
  // antes, sobre TODO el historial disponible (acotado por
  // LIMITE_DEFENSIVO_FUNNEL) -- solo la tendencia semanal y su delta usan
  // la ventana de 7 semanas, que es lo único para lo que el diseño de este
  // endpoint necesita esa ventana.
  const totalActual = resumen(filas);
  const rActual = resumen(estaSemana);
  const rAnterior = resumen(semanaPasada);
  // Enviados: variación relativa (crecimiento %). Tasas: diferencia en puntos
  // porcentuales. Ambas son null si no hubo envíos la semana anterior (sin
  // línea base real con la que comparar).
  const deltaPct = (actual: number, anterior: number) => (anterior > 0 ? (actual - anterior) / anterior : null);
  const deltaPuntos = (actual: number, anterior: number, huboAnterior: boolean) =>
    huboAnterior ? actual - anterior : null;

  const kpis = {
    mensajesEnviados: totalActual.enviados,
    tasaEntrega: totalActual.tasaEntrega,
    tasaLectura: totalActual.tasaLectura,
    tasaRespuesta: totalActual.tasaRespuesta,
    deltaEnviadosPct: deltaPct(rActual.enviados, rAnterior.enviados),
    deltaTasaEntregaPts: deltaPuntos(rActual.tasaEntrega, rAnterior.tasaEntrega, rAnterior.enviados > 0),
    deltaTasaLecturaPts: deltaPuntos(rActual.tasaLectura, rAnterior.tasaLectura, rAnterior.enviados > 0),
    deltaTasaRespuestaPts: deltaPuntos(rActual.tasaRespuesta, rAnterior.tasaRespuesta, rAnterior.enviados > 0),
  };

  // --- Tendencia semanal (últimas 6 semanas) -----------------------------
  const semanas: { inicio: Date; enviados: number; entregados: number; leidos: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const inicio = new Date(inicioEstaSemana);
    inicio.setDate(inicio.getDate() - i * 7);
    semanas.push({ inicio, enviados: 0, entregados: 0, leidos: 0 });
  }
  for (const f of filasTendencia) {
    const t = new Date(f.created_at).getTime();
    const semana = [...semanas].reverse().find((s) => t >= s.inicio.getTime());
    if (!semana) continue;
    semana.enviados++;
    if (f.estado_entrega === "entregado" || f.estado_entrega === "leido") semana.entregados++;
    if (f.estado_entrega === "leido") semana.leidos++;
  }
  const tendencia = semanas.map((s, i) => ({
    label: `S${i + 1}`,
    entregados: s.entregados,
    leidos: s.leidos,
  }));

  // --- Lista de campañas con su propio resumen ---------------------------
  const porCampana = new Map<number, FilaMensaje[]>();
  for (const f of filas) {
    if (f.campana_id === null) continue;
    const lista = porCampana.get(f.campana_id) ?? [];
    lista.push(f);
    porCampana.set(f.campana_id, lista);
  }

  const listaCampanas = (campanas ?? []).map((c) => {
    const grupo = porCampana.get(c.id) ?? [];
    const enviados = grupo.length;
    const entregados = grupo.filter((f) => f.estado_entrega === "entregado" || f.estado_entrega === "leido").length;
    const leidos = grupo.filter((f) => f.estado_entrega === "leido").length;
    const respondidos = grupo.filter((f) => f.respondido).length;
    const fallidos = grupo.filter((f) => f.estado_entrega === "fallido").length;
    const plantilla = Array.isArray(c.dulabs_plantillas) ? c.dulabs_plantillas[0] : c.dulabs_plantillas;
    return {
      id: c.id,
      nombre: c.nombre,
      plantilla: plantilla?.nombre ?? c.nombre,
      destinatarios_total: c.destinatarios_total,
      created_at: c.created_at,
      estado: enviados > 0 && enviados === fallidos ? "fallido" : "completado",
      funnel: { sent: enviados, delivered: entregados, read: leidos, replied: respondidos },
      erroresDetalle: erroresPorCampana.get(c.id) ?? [],
    };
  });

  return Response.json({ kpis, tendencia, campanas: listaCampanas });
}

function kpisVacios() {
  return {
    mensajesEnviados: 0,
    tasaEntrega: 0,
    tasaLectura: 0,
    tasaRespuesta: 0,
    deltaEnviadosPct: null,
    deltaTasaEntregaPts: null,
    deltaTasaLecturaPts: null,
    deltaTasaRespuestaPts: null,
  };
}

function tendenciaVacia() {
  return Array.from({ length: 6 }, (_, i) => ({ label: `S${i + 1}`, entregados: 0, leidos: 0 }));
}
