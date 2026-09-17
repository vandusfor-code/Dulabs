import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { obtenerPaymentProvider } from "@/lib/developer/billing/payment-provider";
import {
  registrarEventoWebhook,
  marcarEvento,
  obtenerPagoPorTransaccion,
  actualizarPagoPorTransaccion,
  esPagoMasRecienteDeCuenta,
  auditarBilling,
  type EstadoPago,
} from "@/lib/developer/billing/billing-store";
import { activarSuscripcionPagada, procesarRenovacionFallida } from "@/lib/developer/billing/billing-lifecycle";
import { dispararConfirmacionPagoDeveloper } from "@/lib/developer/payment-confirmation";

// DuLabs Developer V1 -- Fase 12 (Billing, Wompi). Webhook PROPIO de Developer
// (comercio Wompi separado; NO el de Business). Pipeline: firma -> registrar
// evento (event-log) -> idempotencia (dedup por checksum) -> 200 -> procesar ->
// actualizar pago -> activar/dunning vía RPCs de Fase 11 -> auditoría.
// Protección contra replay, duplicados, eventos fuera de orden y forgery.

export const runtime = "nodejs";

const ESTADOS_VALIDOS: EstadoPago[] = ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"];
function normalizarEstado(status: string | null): EstadoPago {
  return status && (ESTADOS_VALIDOS as string[]).includes(status) ? (status as EstadoPago) : "ERROR";
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const provider = obtenerPaymentProvider();

  // 1-2. Firma / autenticidad. Sin firma válida no se procesa (anti forgery).
  if (!provider.verificarFirmaWebhook(payload)) {
    console.error("[dev-billing-webhook] firma inválida, evento descartado");
    return new Response("Forbidden", { status: 403 });
  }

  const evento = provider.parsearEvento(payload);
  if (!evento) return new Response("EVENT_RECEIVED", { status: 200 });

  const supabase = supabaseAdmin();

  // 3-4. Registrar evento primero + idempotencia (dedup por checksum único).
  const reg = await registrarEventoWebhook(supabase, {
    providerEventId: evento.eventId,
    tipo: evento.tipo,
    payload,
    signatureVerified: true,
    correlationId: evento.transactionId,
  });
  if (!reg.nuevo || reg.id === null) {
    // Ya visto (duplicado/replay) -> 200 sin reprocesar.
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
  const eventoId = reg.id;

  // 5. Responder rápido: procesamos inline (Wompi reintenta si no hay 200), pero
  //    ya está persistido, así que un fallo posterior queda en el event-log.
  try {
    if (evento.tipo !== "transaction.updated" || !evento.transactionId) {
      await marcarEvento(supabase, { id: eventoId, status: "ignored_duplicate", error: `evento no accionable: ${evento.tipo}` });
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const pagoPrevio = await obtenerPagoPorTransaccion(supabase, evento.transactionId);
    if (!pagoPrevio) {
      await marcarEvento(supabase, { id: eventoId, status: "ignored_duplicate", error: "transacción sin pago Developer (¿de Business?)" });
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    // 6-7. Orden: solo aplicar si es el pago más reciente de la cuenta.
    const esReciente = await esPagoMasRecienteDeCuenta(supabase, { accountId: pagoPrevio.account_id, paymentId: pagoPrevio.id });
    const nuevoEstado = normalizarEstado(evento.status);
    await actualizarPagoPorTransaccion(supabase, { providerTransactionId: evento.transactionId, estado: nuevoEstado });

    if (!esReciente) {
      await marcarEvento(supabase, { id: eventoId, status: "ignored_duplicate", error: "evento de un pago anterior (fuera de orden)" });
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    const efecto = provider.efectoDeEstado(nuevoEstado);
    // Idempotencia de activación: solo en la TRANSICIÓN a APPROVED (previo != APPROVED).
    if (efecto === "active" && pagoPrevio.estado !== "APPROVED") {
      await activarSuscripcionPagada(supabase, {
        accountId: pagoPrevio.account_id,
        planCodigo: pagoPrevio.plan_codigo,
        intervalo: pagoPrevio.intervalo,
        precioUsdCents: pagoPrevio.precio_usd_cents,
        cambiarPlanA: pagoPrevio.plan_codigo,
        motivo: `webhook ${evento.transactionId}`,
      });
      // Confirmación de pago (email + WhatsApp) -- una vez por activación, no
      // bloqueante: un fallo se loguea pero nunca revierte la activación.
      try {
        await dispararConfirmacionPagoDeveloper(supabase, {
          accountId: pagoPrevio.account_id,
          planCodigo: pagoPrevio.plan_codigo,
          transactionId: evento.transactionId,
        });
      } catch (err) {
        console.error("[dev-billing-webhook] confirmación de pago falló (no bloqueante):", err instanceof Error ? err.message : String(err));
      }
    } else if (efecto === "fallido" && pagoPrevio.tipo === "renewal" && pagoPrevio.estado !== nuevoEstado) {
      // Solo las RENOVACIONES fallidas abren dunning (un checkout inicial fallido
      // no tiene servicio que proteger).
      await procesarRenovacionFallida(supabase, { accountId: pagoPrevio.account_id });
    }

    await auditarBilling(supabase, { accountId: pagoPrevio.account_id, accion: "WEBHOOK_PROCESSED", despues: { transactionId: evento.transactionId, estado: nuevoEstado, efecto } });
    await marcarEvento(supabase, { id: eventoId, status: "processed" });
    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (err) {
    await marcarEvento(supabase, { id: eventoId, status: "failed", error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    console.error("[dev-billing-webhook] error procesando:", err instanceof Error ? err.message : String(err));
    // 200 igual: el evento quedó persistido (failed) para reproceso; evitamos
    // que Wompi reintente en loop un error no transitorio. Un cron admin drena.
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
}
