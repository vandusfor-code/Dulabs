import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { PLANES, type PlanId } from "@/lib/planes";
import { activarSuscripcionManual } from "@/lib/suscripcion-domain";

export const runtime = "nodejs";

// Activa (o actualiza) la suscripción de un tenant a mano, sin pasar por
// Wompi -- para cerrar tratos negociados (típicamente Enterprise) que no
// van por tarjeta recurrente. Gateado por secreto compartido, NO por sesión
// de usuario: esta acción cruza tenants (activa la suscripción de CUALQUIER
// negocio, no solo el propio), algo que el modelo de roles normal
// (admin/agente de un tenant) no contempla -- mismo criterio que
// /api/wompi/cobro-mensual (CRON_SECRET) o el /api/system/migrate de DuMo.
// FASE F15: la lógica real vive en lib/suscripcion-domain.ts
// (activarSuscripcionManual), compartida con la acción equivalente del
// Panel de Operaciones (gateada por sesión real, no por secreto) -- esta
// ruta sigue existiendo para uso server-to-server/manual.
function autorizado(request: NextRequest): boolean {
  const secreto = process.env.PLATFORM_ADMIN_SECRET;
  if (!secreto) return false;
  const provisto = request.headers.get("x-platform-admin-secret");
  if (!provisto) return false;
  const a = Buffer.from(provisto);
  const b = Buffer.from(secreto);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type Body = {
  tenant_email?: string;
  plan?: string;
  precio_cop?: number;
  fecha_proximo_cobro?: string; // YYYY-MM-DD, opcional -- default +1 año (ciclo típico de un trato Enterprise)
  operador?: string;
  motivo?: string;
};

export async function POST(request: NextRequest) {
  if (!autorizado(request)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { tenant_email, plan, precio_cop } = body;
  if (!tenant_email || !plan || precio_cop === undefined) {
    return Response.json({ error: "Faltan 'tenant_email', 'plan' o 'precio_cop'" }, { status: 400 });
  }

  const supabase = supabaseAdmin();

  const { data: miembro, error: miembroError } = await supabase
    .from("dulabs_miembros_equipo")
    .select("tenant_id")
    .eq("email", tenant_email)
    .maybeSingle();
  if (miembroError) return Response.json({ error: miembroError.message }, { status: 500 });
  if (!miembro) {
    return Response.json({ error: `No existe ningún miembro de equipo con el correo '${tenant_email}'` }, { status: 404 });
  }

  const r = await activarSuscripcionManual(supabase, {
    idTenant: miembro.tenant_id,
    plan,
    precioCop: precio_cop,
    fechaProximoCobro: body.fecha_proximo_cobro,
    correo: tenant_email,
    operador: body.operador,
    motivo: body.motivo,
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });

  return Response.json({
    success: true,
    suscripcion: r.data.suscripcion,
    limites: PLANES[plan as PlanId].limites,
  });
}
