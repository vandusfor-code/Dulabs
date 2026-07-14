import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Mensajes por día en los últimos 7 días, para la gráfica del Resumen.
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

  const dias: { fecha: string; cantidad: number }[] = [];
  const hoy = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    dias.push({ fecha: d.toISOString().slice(0, 10), cantidad: 0 });
  }

  if (phoneNumberIds.length > 0) {
    const desde = new Date(hoy);
    desde.setDate(desde.getDate() - 6);
    desde.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("dulabs_mensajes_log")
      .select("created_at")
      .in("phone_number_id", phoneNumberIds)
      .gte("created_at", desde.toISOString());
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const indicePorFecha = new Map(dias.map((d, i) => [d.fecha, i]));
    for (const m of data ?? []) {
      const fecha = m.created_at.slice(0, 10);
      const idx = indicePorFecha.get(fecha);
      if (idx !== undefined) dias[idx].cantidad++;
    }
  }

  return Response.json({ dias });
}
