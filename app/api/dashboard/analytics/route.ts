import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";

export const runtime = "nodejs";

const DIAS_VENTANA = 30;

// Analytics real, sin métricas de negocio inventadas (nada de "revenue" ni
// "converted" — Du Labs no rastrea ventas). Todo sale de dulabs_mensajes_log
// y dulabs_plantillas de los últimos 30 días.
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
    .select("phone_number_id")
    .eq("id_tenant", miembro.tenantId);
  if (negociosError) return Response.json({ error: negociosError.message }, { status: 500 });
  const phoneNumberIds = (negocios ?? []).map((n) => n.phone_number_id);

  const funnel = { enviados: 0, entregados: 0, leidos: 0, respondidos: 0 };
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const canales = new Map<string, number>();

  if (phoneNumberIds.length > 0) {
    const desde = new Date(Date.now() - DIAS_VENTANA * 24 * 60 * 60 * 1000);

    const { data: mensajes, error: mensajesError } = await supabase
      .from("dulabs_mensajes_log")
      .select("direccion, origen, estado_entrega, respondido, created_at")
      .in("phone_number_id", phoneNumberIds)
      .gte("created_at", desde.toISOString());
    if (mensajesError) return Response.json({ error: mensajesError.message }, { status: 500 });

    for (const m of mensajes ?? []) {
      if (m.direccion === "saliente") {
        funnel.enviados++;
        if (m.estado_entrega === "entregado" || m.estado_entrega === "leido") funnel.entregados++;
        if (m.estado_entrega === "leido") funnel.leidos++;
        if (m.respondido) funnel.respondidos++;

        const canal = m.origen === "ia" ? "ia" : m.origen === "campaña" ? "campaña" : "manual";
        canales.set(canal, (canales.get(canal) ?? 0) + 1);
      } else {
        const fecha = new Date(m.created_at);
        const dia = (fecha.getUTCDay() + 6) % 7; // 0 = lunes
        const hora = fecha.getUTCHours();
        heatmap[dia][hora]++;
      }
    }
  }

  // Plantillas mejor desempeño real: envíos, tasa de lectura, tasa de
  // respuesta — sin inventar ingresos.
  const { data: plantillas, error: plantillasError } = await supabase
    .from("dulabs_plantillas")
    .select("id, nombre")
    .eq("id_tenant", miembro.tenantId)
    .eq("estado", "APPROVED");
  if (plantillasError) return Response.json({ error: plantillasError.message }, { status: 500 });

  const topPlantillas: { nombre: string; enviados: number; tasaLectura: number; tasaRespuesta: number }[] = [];
  const idsPlantillas = (plantillas ?? []).map((p) => p.id);
  if (idsPlantillas.length > 0) {
    const { data: campanas, error: campanasError } = await supabase
      .from("dulabs_campanas")
      .select("id, plantilla_id")
      .in("plantilla_id", idsPlantillas);
    if (campanasError) return Response.json({ error: campanasError.message }, { status: 500 });

    const plantillaPorCampana = new Map((campanas ?? []).map((c) => [c.id, c.plantilla_id as number]));
    const idsCampanas = (campanas ?? []).map((c) => c.id);
    const stats = new Map<number, { enviados: number; leidos: number; respondidos: number }>();

    if (idsCampanas.length > 0) {
      const { data: mensajesPlantillas, error: mpError } = await supabase
        .from("dulabs_mensajes_log")
        .select("campana_id, estado_entrega, respondido")
        .in("campana_id", idsCampanas);
      if (mpError) return Response.json({ error: mpError.message }, { status: 500 });

      for (const m of mensajesPlantillas ?? []) {
        const plantillaId = plantillaPorCampana.get(m.campana_id);
        if (!plantillaId) continue;
        const acc = stats.get(plantillaId) ?? { enviados: 0, leidos: 0, respondidos: 0 };
        acc.enviados++;
        if (m.estado_entrega === "leido") acc.leidos++;
        if (m.respondido) acc.respondidos++;
        stats.set(plantillaId, acc);
      }
    }

    for (const p of plantillas ?? []) {
      const s = stats.get(p.id);
      if (!s || s.enviados === 0) continue;
      topPlantillas.push({
        nombre: p.nombre,
        enviados: s.enviados,
        tasaLectura: s.leidos / s.enviados,
        tasaRespuesta: s.respondidos / s.enviados,
      });
    }
    topPlantillas.sort((a, b) => b.enviados - a.enviados);
  }

  return Response.json({
    funnel,
    heatmap,
    canales: Array.from(canales, ([canal, cantidad]) => ({ canal, cantidad })),
    topPlantillas: topPlantillas.slice(0, 5),
  });
}
