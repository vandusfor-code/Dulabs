import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { crearTransaccion } from "@/lib/wompi";

export const runtime = "nodejs";
export const maxDuration = 60;

// Disparado diariamente por Vercel Cron. Cobra a cada suscripción activa
// cuya fecha_proximo_cobro ya venció, reutilizando su fuente de pago
// guardada (sin volver a pedirle la tarjeta al cliente).
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = supabaseAdmin();
  const hoy = new Date().toISOString().slice(0, 10);

  const { data: suscripciones, error } = await supabase
    .from("dulabs_suscripciones")
    .select("id_tenant, plan, precio_cop, wompi_payment_source_id, wompi_customer_email")
    .eq("estado", "activa")
    .lte("fecha_proximo_cobro", hoy);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const resultados: { id_tenant: string; ok: boolean; detalle: string }[] = [];

  for (const sub of suscripciones ?? []) {
    try {
      const referencia = `dulabs-recurrente-${sub.id_tenant}-${Date.now()}`;
      const transaccion = await crearTransaccion({
        amount_in_cents: sub.precio_cop * 100,
        customer_email: sub.wompi_customer_email,
        reference: referencia,
        payment_source_id: Number(sub.wompi_payment_source_id),
        recurrent: true,
      });

      await supabase.from("dulabs_pagos").insert({
        id_tenant: sub.id_tenant,
        wompi_transaction_id: transaccion.id,
        monto_cop: sub.precio_cop,
        estado: transaccion.status,
      });

      const proximoMes = new Date();
      proximoMes.setMonth(proximoMes.getMonth() + 1);
      await supabase
        .from("dulabs_suscripciones")
        .update({
          estado: transaccion.status === "DECLINED" ? "vencida" : "activa",
          fecha_proximo_cobro: proximoMes.toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        })
        .eq("id_tenant", sub.id_tenant);

      resultados.push({ id_tenant: sub.id_tenant, ok: true, detalle: transaccion.status });
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      console.error(`[cobro-mensual] error cobrando a ${sub.id_tenant}:`, detalle);
      resultados.push({ id_tenant: sub.id_tenant, ok: false, detalle });
    }
  }

  return Response.json({ procesados: resultados.length, resultados });
}
