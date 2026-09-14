import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANES, resolverPlanId, resolverPrecioSuscripcion, familiaDePlan, ORDEN_PLANES_ADMIN, type PlanId } from "@/lib/planes";
import { registrarCambioPlan } from "@/lib/planes-historial";

// FASE F15 (Operations Center, autorizado) -- lógica de dominio de
// suscripción extraída de app/api/dashboard/suscripcion/route.ts (que la
// usaba inline, hardcodeada al tenant del propio llamador) para que el
// nuevo Panel de Operaciones pueda ejecutar las MISMAS operaciones sobre
// CUALQUIER tenant sin duplicar la lógica (Fase 31 del pedido: "Admin NO
// debe tener una segunda implementación de billing/planes/suscripciones").
// El caller (ruta HTTP) decide de quién es `idTenant` -- self-service pasa
// el tenant del propio usuario autenticado, el admin pasa el tenant de la
// URL después de pasar verificarAccesoAdminDulabs. Esta capa nunca
// autoriza nada por sí sola.

export type ResultadoDominio<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function cancelarSuscripcion(supabase: SupabaseClient, idTenant: string): Promise<ResultadoDominio<{ ya_estaba: boolean; activo_hasta: string }>> {
  const { data: suscripcion, error: leerError } = await supabase
    .from("dulabs_suscripciones")
    .select("estado, cancelar_al_vencer, fecha_proximo_cobro, plan")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (leerError) return { ok: false, status: 500, error: leerError.message };
  if (!suscripcion) return { ok: false, status: 404, error: "No tiene ninguna suscripción activa" };
  if (suscripcion.estado === "cancelada") return { ok: false, status: 400, error: "La suscripción ya está cancelada" };
  if (suscripcion.cancelar_al_vencer) {
    return { ok: true, data: { ya_estaba: true, activo_hasta: suscripcion.fecha_proximo_cobro } };
  }

  const { error: updateError } = await supabase
    .from("dulabs_suscripciones")
    .update({ cancelar_al_vencer: true, updated_at: new Date().toISOString() })
    .eq("id_tenant", idTenant);
  if (updateError) return { ok: false, status: 500, error: updateError.message };

  console.log(`[suscripcion-domain] tenant ${idTenant} canceló su plan ${suscripcion.plan} (vigente hasta ${suscripcion.fecha_proximo_cobro})`);
  return { ok: true, data: { ya_estaba: false, activo_hasta: suscripcion.fecha_proximo_cobro } };
}

export async function reactivarSuscripcion(supabase: SupabaseClient, idTenant: string): Promise<ResultadoDominio<{ ya_estaba: boolean; proximo_cobro: string }>> {
  const { data: suscripcion, error: leerError } = await supabase
    .from("dulabs_suscripciones")
    .select("estado, cancelar_al_vencer, fecha_proximo_cobro")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (leerError) return { ok: false, status: 500, error: leerError.message };
  if (!suscripcion) return { ok: false, status: 404, error: "No tiene ninguna suscripción" };
  if (suscripcion.estado !== "activa") {
    return { ok: false, status: 400, error: "La suscripción ya venció. Debe reactivarse desde el checkout (requiere pago)." };
  }
  if (!suscripcion.cancelar_al_vencer) {
    return { ok: true, data: { ya_estaba: true, proximo_cobro: suscripcion.fecha_proximo_cobro } };
  }

  const { error: updateError } = await supabase
    .from("dulabs_suscripciones")
    .update({ cancelar_al_vencer: false, updated_at: new Date().toISOString() })
    .eq("id_tenant", idTenant);
  if (updateError) return { ok: false, status: 500, error: updateError.message };

  return { ok: true, data: { ya_estaba: false, proximo_cobro: suscripcion.fecha_proximo_cobro } };
}

export async function cambiarPlanSuscripcion(
  supabase: SupabaseClient,
  params: { idTenant: string; planDestino: string; actorUserId: string | null; motivo: string },
): Promise<ResultadoDominio<{ ya_estaba: boolean; direccion?: "upgrade" | "downgrade"; plan: string; precio_cop: number }>> {
  const { idTenant, planDestino, actorUserId, motivo } = params;
  if (!planDestino || !(planDestino in PLANES)) return { ok: false, status: 400, error: "Plan inválido" };
  const planDestinoDef = PLANES[planDestino as PlanId];
  if (planDestinoDef.precioCop === null) {
    return { ok: false, status: 400, error: "El plan Enterprise se activa por cotización, no por autoservicio" };
  }

  const { data: actual, error: leerError } = await supabase
    .from("dulabs_suscripciones")
    .select("plan, precio_cop, precio_negociado_cop, estado")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (leerError) return { ok: false, status: 500, error: leerError.message };
  if (!actual) return { ok: false, status: 404, error: "No tiene ninguna suscripción todavía." };
  if (actual.estado !== "activa") {
    return { ok: false, status: 400, error: "La suscripción no está activa (pago pendiente, vencida o cancelada)." };
  }

  const planActualId = resolverPlanId(actual.plan);
  if (planActualId === planDestino) {
    return { ok: true, data: { ya_estaba: true, plan: planActualId, precio_cop: actual.precio_cop } };
  }

  const familiaActual = familiaDePlan(planActualId);
  const familiaDestino = familiaDePlan(planDestino as PlanId);
  if (!familiaActual || !familiaDestino || familiaActual !== familiaDestino) {
    return {
      ok: false,
      status: 400,
      error: `No se puede cambiar directamente de ${PLANES[planActualId]?.nombre ?? planActualId} a ${planDestinoDef.nombre} -- son de familias comerciales distintas.`,
    };
  }

  const planActualDef = PLANES[planActualId];
  const direccion: "upgrade" | "downgrade" = planDestinoDef.precioCop! > planActualDef.precioCop! ? "upgrade" : "downgrade";
  const nuevoPrecioCop = resolverPrecioSuscripcion(planDestinoDef.precioCop!, actual.precio_negociado_cop ?? null);

  const { data: actualizada, error: updateError } = await supabase
    .from("dulabs_suscripciones")
    .update({ plan: planDestino, precio_cop: nuevoPrecioCop, updated_at: new Date().toISOString() })
    .eq("id_tenant", idTenant)
    .eq("estado", "activa")
    .select("plan, precio_cop")
    .maybeSingle();
  if (updateError) return { ok: false, status: 500, error: updateError.message };
  if (!actualizada) return { ok: false, status: 409, error: "La suscripción cambió de estado justo ahora. Vuelve a intentar." };

  await registrarCambioPlan(supabase, {
    idTenant,
    planAnterior: planActualId,
    planNuevo: planDestino,
    precioAnteriorCop: actual.precio_cop,
    precioNuevoCop: nuevoPrecioCop,
    actorUserId,
    motivo,
  });

  console.log(`[suscripcion-domain] tenant ${idTenant}: ${direccion} de ${planActualId} a ${planDestino} ($${nuevoPrecioCop} COP, efectivo de inmediato)`);
  return { ok: true, data: { ya_estaba: false, direccion, plan: actualizada.plan, precio_cop: actualizada.precio_cop } };
}

// Activación/actualización manual (sin pasar por Wompi) -- misma lógica que
// ya usaba app/api/admin/activar-suscripcion/route.ts (gateada por secreto
// compartido, para uso server-to-server), ahora también reutilizable desde
// el Panel de Operaciones (gateado por sesión de operador real).
export async function activarSuscripcionManual(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    plan: string;
    precioCop: number;
    fechaProximoCobro?: string;
    correo: string;
    operador?: string | null;
    motivo?: string | null;
  },
): Promise<ResultadoDominio<{ suscripcion: Record<string, unknown> }>> {
  const { idTenant, plan, precioCop, correo } = params;
  if (!(ORDEN_PLANES_ADMIN as string[]).includes(plan)) {
    return { ok: false, status: 400, error: `Plan inválido. Debe ser uno de: ${ORDEN_PLANES_ADMIN.join(", ")}` };
  }
  if (!Number.isInteger(precioCop) || precioCop < 0) {
    return { ok: false, status: 400, error: "precio_cop debe ser un entero >= 0" };
  }

  const fechaProximoCobro =
    params.fechaProximoCobro ||
    (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().slice(0, 10);
    })();

  const filaBase = {
    id_tenant: idTenant,
    plan,
    precio_cop: precioCop,
    wompi_payment_source_id: null,
    wompi_customer_email: correo,
    estado: "activa",
    cortesia: false,
    fecha_proximo_cobro: fechaProximoCobro,
    updated_at: new Date().toISOString(),
  };

  let { data: suscripcion, error: upsertError } = await supabase
    .from("dulabs_suscripciones")
    .upsert(
      { ...filaBase, activada_manualmente_por: params.operador ?? null, activada_manualmente_motivo: params.motivo ?? null },
      { onConflict: "id_tenant" },
    )
    .select("*")
    .single();
  if (upsertError?.code === "PGRST204" || upsertError?.code === "42703") {
    ({ data: suscripcion, error: upsertError } = await supabase
      .from("dulabs_suscripciones")
      .upsert(filaBase, { onConflict: "id_tenant" })
      .select("*")
      .single());
  }
  if (upsertError) return { ok: false, status: 500, error: upsertError.message };
  return { ok: true, data: { suscripcion } };
}
