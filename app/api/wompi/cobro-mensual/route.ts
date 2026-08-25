import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { crearTransaccion, resolverEstadoPago } from "@/lib/wompi";
import { desactivarActivacion } from "@/lib/marketplace-store";

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
    .select("id_tenant, plan, precio_cop, wompi_payment_source_id, wompi_customer_email, cancelar_al_vencer")
    .eq("estado", "activa")
    .eq("cortesia", false)
    .not("wompi_payment_source_id", "is", null)
    .lte("fecha_proximo_cobro", hoy);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const resultados: { id_tenant: string; ok: boolean; detalle: string }[] = [];

  for (const sub of suscripciones ?? []) {
    try {
      // El cliente canceló y ya llegó el fin de su periodo pagado: se cierra
      // la suscripción en vez de cobrarle otro mes.
      if (sub.cancelar_al_vencer) {
        await supabase
          .from("dulabs_suscripciones")
          .update({ estado: "cancelada", updated_at: new Date().toISOString() })
          .eq("id_tenant", sub.id_tenant);
        console.log(`[cobro-mensual] suscripción de ${sub.id_tenant} cerrada por cancelación del cliente (no se cobra).`);
        resultados.push({ id_tenant: sub.id_tenant, ok: true, detalle: "cancelada por el cliente, no se cobró" });
        continue;
      }

      const referencia = `dulabs-recurrente-${sub.id_tenant}-${Date.now()}`;
      const transaccion = await crearTransaccion({
        amount_in_cents: sub.precio_cop * 100,
        customer_email: sub.wompi_customer_email,
        reference: referencia,
        payment_source_id: Number(sub.wompi_payment_source_id),
        recurrent: true,
      });

      const { error: pagoInsertError } = await supabase.from("dulabs_pagos").insert({
        id_tenant: sub.id_tenant,
        wompi_transaction_id: transaccion.id,
        monto_cop: sub.precio_cop,
        estado: transaccion.status,
        tipo: "suscripcion",
      });
      if (pagoInsertError) {
        console.error(
          `[cobro-mensual] ALERTA: se cobró a Wompi (transacción ${transaccion.id}, tenant ${sub.id_tenant}, $${sub.precio_cop} COP) pero no se pudo registrar en dulabs_pagos — revisar si falta correr la migración de tipo/marketplace_activacion_id:`,
          pagoInsertError.message
        );
      }

      const estadoResultado = resolverEstadoPago(transaccion.status);

      if (estadoResultado === "pendiente_pago") {
        // Challenge 3DS en curso (confirmado real en producción, no solo
        // teórico — ver dulabs_pagos id=1): no tocamos estado (la
        // suscripción sigue "activa" mientras se confirma, no se corta el
        // servicio por un cobro rutinario que todavía no se resolvió) ni
        // fecha_proximo_cobro (para no saltarnos el reintento si termina
        // rechazado). El webhook de Wompi confirmará el resultado final
        // cuando llegue. Si el cron de mañana vuelve a intentar cobrar
        // antes de que el webhook resuelva esto, es el mismo riesgo de
        // reintento ya documentado por falta de idempotency-key hacia
        // Wompi — fuera del alcance de este fix.
        console.log(
          `[cobro-mensual] transacción ${transaccion.id} quedó PENDING (tenant ${sub.id_tenant}) — se deja sin tocar, esperando confirmación del webhook.`
        );
        resultados.push({ id_tenant: sub.id_tenant, ok: true, detalle: "PENDING (esperando webhook)" });
        continue;
      }

      const proximoMes = new Date();
      proximoMes.setMonth(proximoMes.getMonth() + 1);
      await supabase
        .from("dulabs_suscripciones")
        .update({
          estado: estadoResultado,
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

  // --- Marketplace: expirar activaciones de 1 mes vencidas y recobrar las
  // recurrentes cuya fecha de cobro ya llegó. Los agentes de 1 mes se
  // desactivan solos al vencer; las recurrentes que rebotan el pago también.
  const marketplace: { id: number; ok: boolean; detalle: string }[] = [];
  const { data: activaciones } = await supabase
    .from("dulabs_marketplace_activaciones")
    .select("id, id_tenant, phone_number_id, tipo_plan, precio_cop, fecha_proximo_cobro, vence_at, wompi_payment_source_id, wompi_customer_email")
    .eq("estado", "activa");

  for (const act of activaciones ?? []) {
    try {
      if (act.tipo_plan === "mes") {
        if (act.vence_at && act.vence_at <= hoy) {
          await desactivarActivacion(supabase, act.id);
          marketplace.push({ id: act.id, ok: true, detalle: "vencida (1 mes)" });
        }
        continue;
      }

      // Recurrente: cobrar solo si ya llegó la fecha.
      if (!act.fecha_proximo_cobro || act.fecha_proximo_cobro > hoy) continue;
      if (!act.wompi_payment_source_id || !act.wompi_customer_email) {
        await desactivarActivacion(supabase, act.id);
        marketplace.push({ id: act.id, ok: false, detalle: "sin fuente de pago, desactivada" });
        continue;
      }

      const transaccion = await crearTransaccion({
        amount_in_cents: act.precio_cop * 100,
        customer_email: act.wompi_customer_email,
        reference: `dulabs-mkt-rec-${act.id}-${Date.now()}`,
        payment_source_id: Number(act.wompi_payment_source_id),
        recurrent: true,
      });
      const { error: pagoInsertError } = await supabase.from("dulabs_pagos").insert({
        id_tenant: act.id_tenant,
        wompi_transaction_id: transaccion.id,
        monto_cop: act.precio_cop,
        estado: transaccion.status,
        tipo: "marketplace",
        marketplace_activacion_id: act.id,
      });
      if (pagoInsertError) {
        console.error(
          `[cobro-mensual] ALERTA: se cobró a Wompi (transacción ${transaccion.id}, activación marketplace ${act.id}, tenant ${act.id_tenant}, $${act.precio_cop} COP) pero no se pudo registrar en dulabs_pagos — revisar si falta correr la migración de tipo/marketplace_activacion_id:`,
          pagoInsertError.message
        );
      }

      if (transaccion.status === "APPROVED") {
        const proximoMes = new Date();
        proximoMes.setMonth(proximoMes.getMonth() + 1);
        await supabase
          .from("dulabs_marketplace_activaciones")
          .update({ fecha_proximo_cobro: proximoMes.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
          .eq("id", act.id);
        marketplace.push({ id: act.id, ok: true, detalle: "recobrada" });
      } else {
        await desactivarActivacion(supabase, act.id);
        marketplace.push({ id: act.id, ok: false, detalle: `pago ${transaccion.status}, desactivada` });
      }
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      console.error(`[cobro-mensual] error en activación marketplace ${act.id}:`, detalle);
      marketplace.push({ id: act.id, ok: false, detalle });
    }
  }

  return Response.json({ procesados: resultados.length, resultados, marketplace });
}
