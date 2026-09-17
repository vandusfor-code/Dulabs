import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { obtenerPaymentProvider } from "@/lib/developer/billing/payment-provider";
import { obtenerTasaFxUsdCop, usdCentsACopCents } from "@/lib/developer/billing/pricing";
import {
  suscripcionesPorCobrar,
  tienePagoPendienteReciente,
  obtenerClienteDeCuenta,
  insertarPagoRenovacion,
} from "@/lib/developer/billing/billing-store";
import { activarSuscripcionPagada, procesarRenovacionFallida } from "@/lib/developer/billing/billing-lifecycle";

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

      const montoCopCents = usdCentsACopCents(sub.precio_usd_cents, fxRate);
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
        planCodigo: sub.plan_codigo,
        intervalo: sub.intervalo,
        precioUsdCents: sub.precio_usd_cents,
        montoCopCents,
        fxRate,
        providerTransactionId: tx.id,
        estado: tx.status,
      });

      const efecto = provider.efectoDeEstado(tx.status);
      if (efecto === "active") {
        await activarSuscripcionPagada(supabase, {
          accountId: sub.account_id,
          planCodigo: sub.plan_codigo,
          intervalo: sub.intervalo,
          precioUsdCents: sub.precio_usd_cents,
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
