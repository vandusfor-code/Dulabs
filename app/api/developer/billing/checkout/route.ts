import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { ensureCuentaParaWorkspace } from "@/lib/developer/accounts-store";
import { resolverPricing, obtenerTasaFxUsdCop, usdCentsACopCents, type Intervalo } from "@/lib/developer/billing/pricing";
import { obtenerPaymentProvider } from "@/lib/developer/billing/payment-provider";
import { reservarCheckout, guardarClienteYFuente, actualizarPagoTransaccion, type TipoPago } from "@/lib/developer/billing/billing-store";
import { activarSuscripcionPagada } from "@/lib/developer/billing/billing-lifecycle";

// DuLabs Developer V1 -- Fase 12 (Billing, Wompi). Checkout de suscripción.
// Solo el DUEÑO DE LA CUENTA. El backend resuelve TODO: cuenta (del workspace
// autenticado), precio USD (catálogo), FX->COP (server-side), monto y firma.
// El frontend solo manda { plan, intervalo, token, acceptance_token,
// accept_personal_auth, customer_email }. La tarjeta se tokeniza en el navegador
// (nunca toca el servidor). Reserva atómica antes de cobrar (anti doble-cobro).
// La activación de límites ocurre SOLO tras pago APROBADO (idempotente).

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as
      | { plan?: string; intervalo?: string; token?: string; acceptance_token?: string; accept_personal_auth?: string; customer_email?: string }
      | null;

    const plan = cuerpo?.plan?.trim().toUpperCase();
    const intervalo = cuerpo?.intervalo as Intervalo | undefined;
    if (!plan) return jsonError(400, "invalid_request", ctx.requestId, "Falta 'plan'");
    if (intervalo !== "month" && intervalo !== "year") return jsonError(400, "invalid_request", ctx.requestId, "intervalo debe ser 'month' o 'year'");
    if (!cuerpo?.token || !cuerpo.customer_email || !cuerpo.acceptance_token || !cuerpo.accept_personal_auth) {
      return jsonError(400, "invalid_request", ctx.requestId, "Faltan datos de pago (token/customer_email/acceptance_token/accept_personal_auth)");
    }

    // Pricing SIEMPRE server-side. Enterprise/manual => sin checkout.
    let pricing;
    try {
      pricing = await resolverPricing(ctx.supabase, { plan, intervalo });
    } catch {
      return jsonError(400, "plan_invalido", ctx.requestId, "El plan no existe en el catálogo");
    }
    if (!pricing.checkoutHabilitado) {
      return jsonError(400, "checkout_no_disponible", ctx.requestId, "Este plan se contrata con el equipo comercial (Enterprise).");
    }

    // Cuenta derivada del workspace; solo el dueño de la cuenta cobra.
    const cuenta = await ensureCuentaParaWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, ownerUserId: ctx.userId });
    if (cuenta.owner_user_id !== ctx.userId) {
      return jsonError(403, "not_account_owner", ctx.requestId, "Solo el dueño de la cuenta puede gestionar el pago.");
    }

    // FX server-side + reserva atómica (anti doble-checkout).
    let fxRate: number;
    try {
      fxRate = obtenerTasaFxUsdCop();
    } catch {
      return jsonError(500, "fx_no_configurado", ctx.requestId);
    }
    const montoCopCents = usdCentsACopCents(pricing.precioUsdCents, fxRate);
    const esCambioDePlan = plan !== cuenta.plan_codigo;
    const tipo: TipoPago = esCambioDePlan && cuenta.estado === "active" ? "upgrade" : "checkout";
    const reference = `dulabs-dev-${cuenta.id}-${Date.now()}`;

    const reserva = await reservarCheckout(ctx.supabase, {
      accountId: cuenta.id, reference, tipo, planCodigo: plan, intervalo,
      precioUsdCents: pricing.precioUsdCents, montoCopCents, fxRate,
    });
    if (!reserva.ok) {
      if (reserva.motivo === "checkout_en_curso") return jsonError(409, "checkout_in_progress", ctx.requestId, "Ya hay un pago en proceso. Espera un momento e intenta de nuevo.");
      if (reserva.motivo === "plan_invalido") return jsonError(400, "plan_invalido", ctx.requestId);
      return jsonError(400, "checkout_rechazado", ctx.requestId, reserva.motivo);
    }
    const paymentId = reserva.paymentId;
    const provider = obtenerPaymentProvider();

    try {
      const fuente = await provider.crearFuentePago({
        token: cuerpo.token, customerEmail: cuerpo.customer_email, acceptanceToken: cuerpo.acceptance_token, acceptPersonalAuth: cuerpo.accept_personal_auth,
      });
      if (fuente.status !== "AVAILABLE") {
        await actualizarPagoTransaccion(ctx.supabase, { paymentId, providerTransactionId: `nofuente-${reference}`, estado: "ERROR" });
        return jsonError(402, "payment_source_error", ctx.requestId, `La fuente de pago quedó en estado ${fuente.status}`);
      }

      const tx = await provider.cobrar({ amountInCents: montoCopCents, customerEmail: cuerpo.customer_email, reference, paymentSourceId: fuente.id, recurrent: true });
      await guardarClienteYFuente(ctx.supabase, { accountId: cuenta.id, customerEmail: cuerpo.customer_email, paymentSourceId: String(fuente.id) });
      await actualizarPagoTransaccion(ctx.supabase, { paymentId, providerTransactionId: tx.id, estado: tx.status });

      const efecto = provider.efectoDeEstado(tx.status);
      if (efecto === "active") {
        // Transición PENDING->APPROVED (recién creado): activar. El webhook, si
        // llega luego con el MISMO tx ya APPROVED, no re-activa (idempotencia).
        await activarSuscripcionPagada(ctx.supabase, {
          accountId: cuenta.id, planCodigo: plan, intervalo, precioUsdCents: pricing.precioUsdCents,
          cambiarPlanA: esCambioDePlan ? plan : null, motivo: `checkout ${tx.id}`,
        });
      }
      // efecto === "pendiente" (3DS): se espera el webhook. efecto === "fallido":
      // el pago quedó DECLINED/ERROR/VOIDED, no se activa nada.
      return jsonOk({ estado: tx.status, reference, activada: efecto === "active" }, ctx.requestId, 201);
    } catch (err) {
      // Fallo tras la reserva: marcar el pago para no bloquear futuros checkouts.
      await actualizarPagoTransaccion(ctx.supabase, { paymentId, providerTransactionId: `error-${reference}`, estado: "ERROR" }).catch(() => {});
      console.error(`[dev-billing-checkout] error (request_id=${ctx.requestId}):`, err instanceof Error ? err.message : String(err));
      return jsonError(502, "payment_failed", ctx.requestId, "No se pudo procesar el pago. Intenta de nuevo.");
    }
  });
}
