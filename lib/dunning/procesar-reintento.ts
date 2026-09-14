// FASE F16.1 (Commercial Scale — Dunning, autorizado) — lógica de "ya
// reclamé un ciclo, ahora cóbrale" COMPARTIDA por los 3 callers que pueden
// disparar un reintento: el cron automático (app/api/wompi/dunning-
// reintentos/route.ts), el cliente desde /dashboard/cuenta (app/api/
// dashboard/suscripcion/reintentar-pago/route.ts) y el admin desde /admin
// (app/api/dashboard/admin/clientes/[idTenant]/dunning/route.ts). Reusa
// EXACTAMENTE el mismo patrón de cobro que ya usaba cobro-mensual --
// ninguna segunda lógica de cobro.

import type { SupabaseClient } from "@supabase/supabase-js";
import { crearTransaccion, resolverEstadoPago } from "@/lib/wompi";
import { debeOmitirCobroPorPagoPendiente } from "@/lib/wompi-webhook";
import { insertarPagoConPlan } from "@/lib/planes-historial";
import { liberarReclamo, registrarReintentoFallido, recuperarCicloDunning, expirarSuscripcionPorAgotamiento } from "./dunning-domain";
import { enviarNotificacionDunning } from "./notificaciones";

export type ResultadoProcesarReintento =
  | { resultado: "recuperado" }
  | { resultado: "pendiente" }
  | { resultado: "rechazado_reintento" }
  | { resultado: "rechazado_final" }
  | { resultado: "omitido"; motivo: string };

export async function procesarReintentoCobro(
  supabase: SupabaseClient,
  params: { idTenant: string; cicloId: number; intentosActuales: number; primerFalloAt: string },
): Promise<ResultadoProcesarReintento> {
  const { data: ultimoPago } = await supabase
    .from("dulabs_pagos")
    .select("estado")
    .eq("id_tenant", params.idTenant)
    .eq("tipo", "suscripcion")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (debeOmitirCobroPorPagoPendiente(ultimoPago)) {
    await liberarReclamo(supabase, params.cicloId);
    return { resultado: "omitido", motivo: "el cobro anterior sigue PENDING, esperando confirmación del webhook" };
  }

  await supabase.from("dulabs_dunning_eventos").insert({ id_tenant: params.idTenant, ciclo_id: params.cicloId, tipo: "retry_started", metadata: { intento: params.intentosActuales + 1 } });

  const { data: sub } = await supabase
    .from("dulabs_suscripciones")
    .select("plan, precio_cop, wompi_payment_source_id, wompi_customer_email")
    .eq("id_tenant", params.idTenant)
    .single();
  if (!sub || !sub.wompi_payment_source_id) {
    await registrarReintentoFallido(supabase, {
      cicloId: params.cicloId,
      idTenant: params.idTenant,
      primerFalloAt: new Date(params.primerFalloAt),
      intentosActuales: params.intentosActuales,
      motivoFallo: "sin fuente de pago guardada",
    });
    return { resultado: "rechazado_reintento" };
  }

  const referencia = `dulabs-dunning-${params.idTenant}-${Date.now()}`;
  const transaccion = await crearTransaccion({
    amount_in_cents: sub.precio_cop * 100,
    customer_email: sub.wompi_customer_email ?? "",
    reference: referencia,
    payment_source_id: Number(sub.wompi_payment_source_id),
    recurrent: true,
  });
  await insertarPagoConPlan(supabase, { id_tenant: params.idTenant, wompi_transaction_id: transaccion.id, monto_cop: sub.precio_cop, estado: transaccion.status, tipo: "suscripcion" }, sub.plan);

  const estadoResultado = resolverEstadoPago(transaccion.status);

  if (estadoResultado === "pendiente_pago") {
    await liberarReclamo(supabase, params.cicloId);
    return { resultado: "pendiente" };
  }

  if (estadoResultado === "activa") {
    const proximoMes = new Date();
    proximoMes.setMonth(proximoMes.getMonth() + 1);
    await supabase
      .from("dulabs_suscripciones")
      .update({ estado: "activa", fecha_proximo_cobro: proximoMes.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
      .eq("id_tenant", params.idTenant);
    await supabase.from("dulabs_dunning_eventos").insert({ id_tenant: params.idTenant, ciclo_id: params.cicloId, tipo: "retry_succeeded", metadata: { intento: params.intentosActuales + 1 } });
    await recuperarCicloDunning(supabase, { cicloId: params.cicloId, idTenant: params.idTenant });
    const { data: authUser } = await supabase.auth.admin.getUserById(params.idTenant);
    await enviarNotificacionDunning(supabase, {
      idTenant: params.idTenant,
      cicloId: params.cicloId,
      tipo: "recovered",
      destinatario: authUser?.user?.email ?? null,
      nombreNegocio: (authUser?.user?.user_metadata?.nombre as string | undefined) ?? null,
    });
    return { resultado: "recuperado" };
  }

  const resultado = await registrarReintentoFallido(supabase, {
    cicloId: params.cicloId,
    idTenant: params.idTenant,
    primerFalloAt: new Date(params.primerFalloAt),
    intentosActuales: params.intentosActuales,
    motivoFallo: transaccion.status,
  });
  if (resultado.expirado) {
    await expirarSuscripcionPorAgotamiento(supabase, params.idTenant);
    const { data: authUser } = await supabase.auth.admin.getUserById(params.idTenant);
    await enviarNotificacionDunning(supabase, {
      idTenant: params.idTenant,
      cicloId: params.cicloId,
      tipo: "expired",
      destinatario: authUser?.user?.email ?? null,
      nombreNegocio: (authUser?.user?.user_metadata?.nombre as string | undefined) ?? null,
    });
    return { resultado: "rechazado_final" };
  }
  return { resultado: "rechazado_reintento" };
}
