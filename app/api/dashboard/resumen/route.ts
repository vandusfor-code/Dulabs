import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const ESTADOS_PENDIENTES = ["pendiente", "PENDING", "IN_APPEAL"];

// Datos reales para el Command Center: conversaciones de las últimas 24h,
// tasa de automatización real (origen ia vs manual), plantillas esperando
// aprobación de Meta, campañas de hoy y consumo real por categoría de precio
// de Meta (en vez de un costo en dólares inventado).
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
    .select("phone_number_id")
    .eq("id_tenant", userData.user.id);
  if (negociosError) return Response.json({ error: negociosError.message }, { status: 500 });
  const phoneNumberIds = (negocios ?? []).map((n) => n.phone_number_id);

  const ahora = new Date();
  const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const inicioHoy = new Date(ahora);
  inicioHoy.setHours(0, 0, 0, 0);

  let conversaciones24h = 0;
  let automatizadas24h = 0;
  const porCategoriaMes = new Map<string, number>();

  if (phoneNumberIds.length > 0) {
    const { data: mensajes24h, error: mensajesError } = await supabase
      .from("dulabs_mensajes_log")
      .select("origen")
      .in("phone_number_id", phoneNumberIds)
      .eq("direccion", "saliente")
      .gte("created_at", hace24h.toISOString());
    if (mensajesError) return Response.json({ error: mensajesError.message }, { status: 500 });

    conversaciones24h = mensajes24h?.length ?? 0;
    automatizadas24h = (mensajes24h ?? []).filter((m) => m.origen === "ia").length;

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
  });
}
