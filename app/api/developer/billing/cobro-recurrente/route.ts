import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { obtenerPaymentProvider } from "@/lib/developer/billing/payment-provider";
import { obtenerTasaFxUsdCop, usdCentsACopCents, resolverPricing } from "@/lib/developer/billing/pricing";
import {
  suscripcionesPorCobrar,
  tienePagoPendienteReciente,
  obtenerClienteDeCuenta,
  insertarPagoRenovacion,
} from "@/lib/developer/billing/billing-store";
import { activarSuscripcionPagada, procesarRenovacionFallida, validarRecursosCabenEnPlan } from "@/lib/developer/billing/billing-lifecycle";

// DuLabs Developer V1 -- Fase 12 (Billing, Wompi). Cron de recurrencia
// (mensual/anual) + reintentos de dunning. Cobra vía la fuente de pago
// tokenizada (recurrent:true). Idempotente frente a corridas concurrentes:
// salta cuentas con un pago PENDING reciente (anti doble-cobro). Protegido por
// CRON_SECRET (Vercel Cron manda Authorization: Bearer <CRON_SECRET>).

export const runtime = "nodejs";

function autorizado(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const recibido = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(secret).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return new Response("Forbidden", { status: 403 });

  const supabase = supabaseAdmin();
  const provider = obtenerPaymentProvider();
  const hoy = new Date().toISOString().slice(0, 10);

  let fxRate: number;
  try {
    fxRate = obtenerTasaFxUsdCop();
  } catch {
    return Response.json({ error: "fx_no_configurado" }, { status: 500 });
  }

  const pendientes = await suscripcionesPorCobrar(supabase, hoy);
  let cobrados = 0;
  let saltados = 0;
  let fallidos = 0;

  for (const sub of pendientes) {
    try {
      if (await tienePagoPendienteReciente(supabase, sub.account_id)) {
        saltados++;
        continue;
      }
      const cliente = await obtenerClienteDeCuenta(supabase, sub.account_id);
      if (!cliente?.wompi_payment_source_id || !cliente.wompi_customer_email) {
        saltados++;
        continue;
      }

      // Downgrade al fin de período (opción A): si hay intención y los recursos
      // caben en el plan destino, se renueva YA en el plan menor (precio menor).
      // Si ya no caben, se mantiene el plan actual este ciclo (intención queda).
      let planRenovar = sub.plan_codigo;
      let cambiarPlanA: string | null = null;
      let precioUsdCents = sub.precio_usd_cents;
      if (sub.downgrade_a_plan) {
        const cabe = await validarRecursosCabenEnPlan(supabase, { accountId: sub.account_id, planCodigo: sub.downgrade_a_plan });
        if (cabe.ok) {
          planRenovar = sub.downgrade_a_plan;
          cambiarPlanA = sub.downgrade_a_plan;
          precioUsdCents = (await resolverPricing(supabase, { plan: sub.downgrade_a_plan, intervalo: sub.intervalo })).precioUsdCents;
        }
      }

      const montoCopCents = usdCentsACopCents(precioUsdCents, fxRate);
      const reference = `dulabs-dev-${sub.account_id}-renew-${Date.now()}`;
      const tx = await provider.cobrar({
        amountInCents: montoCopCents,
        customerEmail: cliente.wompi_customer_email,
        reference,
        paymentSourceId: Number(cliente.wompi_payment_source_id),
        recurrent: true,
      });
      await insertarPagoRenovacion(supabase, {
        accountId: sub.account_id,
        reference,
        planCodigo: planRenovar,
        intervalo: sub.intervalo,
        precioUsdCents,
        montoCopCents,
        fxRate,
        providerTransactionId: tx.id,
        estado: tx.status,
      });

      const efecto = provider.efectoDeEstado(tx.status);
      if (efecto === "active") {
        await activarSuscripcionPagada(supabase, {
          accountId: sub.account_id,
          planCodigo: planRenovar,
          intervalo: sub.intervalo,
          precioUsdCents,
          cambiarPlanA,
          motivo: `renovación ${tx.id}`,
        });
        cobrados++;
      } else if (efecto === "fallido") {
        await procesarRenovacionFallida(supabase, { accountId: sub.account_id });
        fallidos++;
      }
      // 'pendiente' (3DS): lo resuelve el webhook.
    } catch (err) {
      fallidos++;
      console.error(`[dev-billing-cron] error cobrando cuenta ${sub.account_id}:`, err instanceof Error ? err.message : String(err));
    }
  }

  return Response.json({ procesadas: pendientes.length, cobrados, saltados, fallidos });
}
