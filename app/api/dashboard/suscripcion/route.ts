import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { cancelarSuscripcion, reactivarSuscripcion, cambiarPlanSuscripcion } from "@/lib/suscripcion-domain";

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

  // FASE F13 (Go-Live Onboarding, autorizado) -- hallazgo real (caso real de
  // Daniel): /checkout siempre mostraba el formulario de pago desde cero,
  // sin importar si ya existía una suscripción en curso. Un pago que quedó
  // en "pendiente_pago" (challenge 3DS sin confirmar por el webhook, ver
  // pagos/suscribir/route.ts) hacía que el cliente viera "paga de nuevo"
  // en vez de un estado claro -- y un segundo intento real choca con
  // dulabs_reservar_suscripcion (409, "ya tienes un pago en proceso"), una
  // respuesta confusa sin contexto. `estado`/`plan` se agregan para que el
  // checkout pueda mostrar el estado real ANTES de ofrecer pagar de nuevo.
  // Aditivo: cualquier consumidor existente que solo lea
  // `precio_negociado_cop` (como este mismo endpoint hacía hasta ahora)
  // sigue funcionando exactamente igual.
  const { data: suscripcion } = await supabase
    .from("dulabs_suscripciones")
    .select("precio_negociado_cop, estado, plan")
    .eq("id_tenant", idTenant)
    .maybeSingle();

  return Response.json({
    precio_negociado_cop: suscripcion?.precio_negociado_cop ?? null,
    estado: suscripcion?.estado ?? null,
    plan: suscripcion?.plan ?? null,
  });
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

  const r = await cancelarSuscripcion(supabase, miembro.tenantId);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ success: true, ya_estaba: r.data.ya_estaba, activo_hasta: r.data.activo_hasta });
}

// Reactiva una suscripción cancelada que todavía no ha vencido: simplemente
// se vuelve a marcar para renovarse. Si ya venció (estado 'cancelada'), hay
// que pasar de nuevo por el checkout -- no se puede "revivir" sin cobrar.
export async function POST(request: NextRequest) {
  const ctx = await autenticarAdmin(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  const r = await reactivarSuscripcion(supabase, miembro.tenantId);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ success: true, ya_estaba: r.data.ya_estaba, proximo_cobro: r.data.proximo_cobro });
}

// Upgrade/downgrade de plan (Fase F14.2). Decisión comercial explícita,
// documentada en el reporte de esa fase: el cambio de plan (límites y
// precio) aplica DE INMEDIATO, sin cobrar nada en este momento -- el cobro
// de la diferencia solo llega en el próximo ciclo normal
// (app/api/wompi/cobro-mensual/route.ts, que ya lee `precio_cop` en vivo de
// esta misma fila). No existe ningún prorrateo hoy en la arquitectura, así
// que no se inventa uno acá.
export async function PATCH(request: NextRequest) {
  const ctx = await autenticarAdmin(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  let body: { plan?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const r = await cambiarPlanSuscripcion(supabase, {
    idTenant: miembro.tenantId,
    planDestino: body.plan ?? "",
    actorUserId: miembro.userId,
    motivo: "Cambio de plan (autoservicio)",
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  if (r.data.ya_estaba) return Response.json({ success: true, ya_estaba: true, plan: r.data.plan });
  return Response.json({ success: true, direccion: r.data.direccion, plan: r.data.plan, precio_cop: r.data.precio_cop });
}
