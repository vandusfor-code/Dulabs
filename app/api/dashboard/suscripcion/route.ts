import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";

export const runtime = "nodejs";

// Precio a mostrar en /checkout ANTES de cobrar: si el tenant ya tiene un
// precio negociado (ver migración 20260827090000_precio_negociado.sql), el
// checkout debe mostrar ESE número, no el de lista -- para que nunca se le
// muestre un precio distinto al que realmente se le va a cobrar. Sin
// requireRol(admin): un usuario recién registrado, sin membresía todavía
// (mismo caso que resuelve /api/pagos/suscribir con su fallback de
// aprovisionar), de todas formas nunca va a tener un precio negociado, así
// que null es la respuesta correcta y segura para ese caso.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });

  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  const idTenant = miembro?.tenantId ?? userData.user.id;

  const { data: suscripcion } = await supabase
    .from("dulabs_suscripciones")
    .select("precio_negociado_cop")
    .eq("id_tenant", idTenant)
    .maybeSingle();

  return Response.json({ precio_negociado_cop: suscripcion?.precio_negociado_cop ?? null });
}

async function autenticarAdmin(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { error: Response.json({ error: "Falta el token de sesión" }, { status: 401 }) };

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return { error: Response.json({ error: "Sesión inválida" }, { status: 401 }) };

  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return { error: Response.json({ error: "Solo un administrador puede gestionar la suscripción" }, { status: 403 }) };
  }
  return { supabase, miembro: miembro! };
}

// Cancela la suscripción. La cancelación es DIFERIDA: el cliente ya pagó el
// periodo en curso, así que conserva el servicio hasta fecha_proximo_cobro y
// ahí el cron de cobro mensual la cierra en vez de volver a cobrar. Cortar
// el acceso el mismo día que cancela sería quedarse con dinero por un
// servicio no prestado.
export async function DELETE(request: NextRequest) {
  const ctx = await autenticarAdmin(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  const { data: suscripcion, error: leerError } = await supabase
    .from("dulabs_suscripciones")
    .select("estado, cancelar_al_vencer, fecha_proximo_cobro, plan")
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (leerError) return Response.json({ error: leerError.message }, { status: 500 });
  if (!suscripcion) return Response.json({ error: "No tienes ninguna suscripción activa" }, { status: 404 });
  if (suscripcion.estado === "cancelada") {
    return Response.json({ error: "Tu suscripción ya está cancelada" }, { status: 400 });
  }
  if (suscripcion.cancelar_al_vencer) {
    return Response.json({
      success: true,
      ya_estaba: true,
      activo_hasta: suscripcion.fecha_proximo_cobro,
    });
  }

  const { error: updateError } = await supabase
    .from("dulabs_suscripciones")
    .update({ cancelar_al_vencer: true, updated_at: new Date().toISOString() })
    .eq("id_tenant", miembro.tenantId);
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  console.log(`[suscripcion] tenant ${miembro.tenantId} canceló su plan ${suscripcion.plan} (vigente hasta ${suscripcion.fecha_proximo_cobro})`);
  return Response.json({ success: true, activo_hasta: suscripcion.fecha_proximo_cobro });
}

// Reactiva una suscripción cancelada que todavía no ha vencido: simplemente
// se vuelve a marcar para renovarse. Si ya venció (estado 'cancelada'), hay
// que pasar de nuevo por el checkout -- no se puede "revivir" sin cobrar.
export async function POST(request: NextRequest) {
  const ctx = await autenticarAdmin(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  const { data: suscripcion, error: leerError } = await supabase
    .from("dulabs_suscripciones")
    .select("estado, cancelar_al_vencer, fecha_proximo_cobro")
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (leerError) return Response.json({ error: leerError.message }, { status: 500 });
  if (!suscripcion) return Response.json({ error: "No tienes ninguna suscripción" }, { status: 404 });
  if (suscripcion.estado !== "activa") {
    return Response.json(
      { error: "Tu suscripción ya venció. Vuelve a activarla desde la página de planes." },
      { status: 400 }
    );
  }
  if (!suscripcion.cancelar_al_vencer) {
    return Response.json({ success: true, ya_estaba: true });
  }

  const { error: updateError } = await supabase
    .from("dulabs_suscripciones")
    .update({ cancelar_al_vencer: false, updated_at: new Date().toISOString() })
    .eq("id_tenant", miembro.tenantId);
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  return Response.json({ success: true, proximo_cobro: suscripcion.fecha_proximo_cobro });
}
