import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { PLANES, resolverPlanId, resolverPrecioSuscripcion, familiaDePlan, type PlanId } from "@/lib/planes";
import { registrarCambioPlan } from "@/lib/planes-historial";

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

// Upgrade/downgrade de plan (Fase F14.2). Decisión comercial explícita,
// documentada en el reporte de esta fase: el cambio de plan (límites y
// precio) aplica DE INMEDIATO, sin cobrar nada en este momento -- el cobro
// de la diferencia solo llega en el próximo ciclo normal
// (app/api/wompi/cobro-mensual/route.ts, que ya lee `precio_cop` en vivo de
// esta misma fila). No existe ningún prorrateo hoy en la arquitectura, así
// que no se inventa uno acá: un upgrade a mitad de mes no cobra la
// diferencia de inmediato, un downgrade no reembolsa nada del periodo en
// curso. `fecha_proximo_cobro` no se toca -- el ciclo de facturación sigue
// exactamente donde iba.
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
  const planDestino = body.plan;
  if (!planDestino || !(planDestino in PLANES)) {
    return Response.json({ error: "Plan inválido" }, { status: 400 });
  }
  const planDestinoDef = PLANES[planDestino as PlanId];
  if (planDestinoDef.precioCop === null) {
    return Response.json({ error: "El plan Enterprise se activa por cotización, contacta a soporte" }, { status: 400 });
  }

  const { data: actual, error: leerError } = await supabase
    .from("dulabs_suscripciones")
    .select("plan, precio_cop, precio_negociado_cop, estado")
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (leerError) return Response.json({ error: leerError.message }, { status: 500 });
  if (!actual) return Response.json({ error: "No tienes ninguna suscripción todavía. Actívala primero desde /checkout." }, { status: 404 });
  if (actual.estado !== "activa") {
    return Response.json(
      { error: "Tu suscripción no está activa (pago pendiente, vencida o cancelada). Resuelve eso primero desde /checkout antes de cambiar de plan." },
      { status: 400 }
    );
  }

  const planActualId = resolverPlanId(actual.plan);
  if (planActualId === planDestino) {
    return Response.json({ success: true, ya_estaba: true, plan: planActualId });
  }

  const familiaActual = familiaDePlan(planActualId);
  const familiaDestino = familiaDePlan(planDestino as PlanId);
  if (!familiaActual || !familiaDestino || familiaActual !== familiaDestino) {
    return Response.json(
      { error: `No puedes cambiar directamente de ${PLANES[planActualId]?.nombre ?? planActualId} a ${planDestinoDef.nombre}. Contacta a soporte para migrar de familia de plan.` },
      { status: 400 }
    );
  }

  const planActualDef = PLANES[planActualId];
  const direccion = planDestinoDef.precioCop! > planActualDef.precioCop! ? "upgrade" : "downgrade";
  const nuevoPrecioCop = resolverPrecioSuscripcion(planDestinoDef.precioCop!, actual.precio_negociado_cop ?? null);

  // Update condicional atómico: si la suscripción dejó de estar 'activa'
  // entre el SELECT de arriba y este UPDATE (p.ej. el webhook la marcó
  // vencida en paralelo), esto actualiza 0 filas -- se detecta con
  // .maybeSingle() devolviendo null, en vez de aplicar un cambio de plan
  // sobre una suscripción que ya no está vigente.
  const { data: actualizada, error: updateError } = await supabase
    .from("dulabs_suscripciones")
    .update({ plan: planDestino, precio_cop: nuevoPrecioCop, updated_at: new Date().toISOString() })
    .eq("id_tenant", miembro.tenantId)
    .eq("estado", "activa")
    .select("plan, precio_cop")
    .maybeSingle();
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
  if (!actualizada) {
    return Response.json(
      { error: "Tu suscripción cambió de estado justo ahora. Recarga la página e intenta de nuevo." },
      { status: 409 }
    );
  }

  await registrarCambioPlan(supabase, {
    idTenant: miembro.tenantId,
    planAnterior: planActualId,
    planNuevo: planDestino,
    precioAnteriorCop: actual.precio_cop,
    precioNuevoCop: nuevoPrecioCop,
    actorUserId: miembro.userId,
    motivo: direccion === "upgrade" ? "Upgrade de plan" : "Downgrade de plan",
  });

  console.log(`[suscripcion] tenant ${miembro.tenantId}: ${direccion} de ${planActualId} a ${planDestino} ($${nuevoPrecioCop} COP, efectivo de inmediato)`);
  return Response.json({
    success: true,
    direccion,
    plan: actualizada.plan,
    precio_cop: actualizada.precio_cop,
  });
}
