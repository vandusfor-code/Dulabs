import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const LIMITE_MENSAJES_POR_PLAN: Record<string, number> = {
  "Plan Básico": 1000,
  "Plan Pro": 5000,
  "Plan Enterprise": Infinity,
};
const PLAN_POR_DEFECTO = "Plan Pro";

function mesActualISO(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

// Datos del tenant autenticado. El front nunca ve meta_permanent_token:
// solo campos de visualización + un booleano de si hay token guardado.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return Response.json({ error: "Falta el token de sesión" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select(
      "nombre_negocio, telefono_negocio, phone_number_id, whatsapp_business_account_id, meta_permanent_token, updated_at, plan, mensajes_usados_mes, mes_actual, prompt_sistema, base_conocimiento, base_conocimiento_nombre_archivo, base_conocimiento_actualizado_at"
    )
    .eq("id_tenant", userData.user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const mesHoy = mesActualISO();
  const negocios = (data ?? []).map((n) => {
    const plan = n.plan ?? PLAN_POR_DEFECTO;
    const limite = LIMITE_MENSAJES_POR_PLAN[plan] ?? LIMITE_MENSAJES_POR_PLAN[PLAN_POR_DEFECTO];
    // El contador se reinicia en el primer envío del mes (webhook); si ya
    // cambió el mes y todavía no hubo envíos, mostramos 0 en vez del valor viejo.
    const usados = n.mes_actual === mesHoy ? n.mensajes_usados_mes : 0;
    return {
      nombre_negocio: n.nombre_negocio,
      telefono_negocio: n.telefono_negocio,
      phone_number_id: n.phone_number_id,
      whatsapp_business_account_id: n.whatsapp_business_account_id,
      conectado: Boolean(n.meta_permanent_token || process.env.META_ACCESS_TOKEN),
      updated_at: n.updated_at,
      plan,
      mensajes_usados: usados,
      mensajes_limite: Number.isFinite(limite) ? limite : null,
      prompt_sistema: n.prompt_sistema,
      base_conocimiento_nombre_archivo: n.base_conocimiento_nombre_archivo,
      base_conocimiento_actualizado_at: n.base_conocimiento_actualizado_at,
      base_conocimiento_caracteres: n.base_conocimiento?.length ?? 0,
    };
  });

  const { data: suscripcion } = await supabase
    .from("dulabs_suscripciones")
    .select("plan, precio_cop, estado, fecha_proximo_cobro")
    .eq("id_tenant", userData.user.id)
    .maybeSingle();

  return Response.json({ email: userData.user.email, negocios, suscripcion });
}
