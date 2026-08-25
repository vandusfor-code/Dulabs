import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { PLANES, ORDEN_PLANES, type PlanId } from "@/lib/planes";

export const runtime = "nodejs";

// Activa (o actualiza) la suscripción de un tenant a mano, sin pasar por
// Wompi -- para cerrar tratos negociados (típicamente Enterprise) que no
// van por tarjeta recurrente. Gateado por secreto compartido, NO por sesión
// de usuario: esta acción cruza tenants (activa la suscripción de CUALQUIER
// negocio, no solo el propio), algo que el modelo de roles normal
// (admin/agente de un tenant) no contempla -- mismo criterio que
// /api/wompi/cobro-mensual (CRON_SECRET) o el /api/system/migrate de DuMo.
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
  if (!ORDEN_PLANES.includes(plan as PlanId)) {
    return Response.json({ error: `Plan inválido. Debe ser uno de: ${ORDEN_PLANES.join(", ")}` }, { status: 400 });
  }
  if (!Number.isInteger(precio_cop) || precio_cop < 0) {
    return Response.json({ error: "precio_cop debe ser un entero >= 0" }, { status: 400 });
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

  const fechaProximoCobro =
    body.fecha_proximo_cobro ||
    (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().slice(0, 10);
    })();

  const { data: suscripcion, error: upsertError } = await supabase
    .from("dulabs_suscripciones")
    .upsert(
      {
        id_tenant: miembro.tenant_id,
        plan,
        precio_cop,
        wompi_payment_source_id: null, // facturación manual/negociada, fuera de Wompi
        wompi_customer_email: tenant_email,
        estado: "activa",
        cortesia: false,
        fecha_proximo_cobro: fechaProximoCobro,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id_tenant" }
    )
    .select("*")
    .single();
  if (upsertError) return Response.json({ error: upsertError.message }, { status: 500 });

  return Response.json({
    success: true,
    suscripcion,
    limites: PLANES[plan as PlanId].limites,
  });
}
