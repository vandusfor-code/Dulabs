import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { crearTransaccion } from "@/lib/wompi";
import { descifrarSecreto } from "@/lib/crypto";
import { enviarTexto, dentroVentana24h } from "@/lib/whatsapp";
import { enviarPlantilla, consultarEstadoPlantilla } from "@/lib/meta-templates";
import { agentePorSlug } from "@/lib/marketplace";

const IDIOMA_PLANTILLA = "es_CO";

export const runtime = "nodejs";
export const maxDuration = 60;

// Desactiva una activación del marketplace: la marca 'vencida' y devuelve el
// número a su agente propio (marketplace_activacion_id -> null). La config
// propia del cliente nunca se tocó, así que vuelve a usarse sola.
async function desactivarActivacionMarketplace(
  supabase: SupabaseClient,
  activacion: { id: number; phone_number_id: string }
) {
  await supabase
    .from("dulabs_clientes_config")
    .update({ marketplace_activacion_id: null })
    .eq("marketplace_activacion_id", activacion.id);
  await supabase
    .from("dulabs_marketplace_activaciones")
    .update({ estado: "vencida", updated_at: new Date().toISOString() })
    .eq("id", activacion.id);
}

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
          await desactivarActivacionMarketplace(supabase, act);
          marketplace.push({ id: act.id, ok: true, detalle: "vencida (1 mes)" });
        }
        continue;
      }

      // Recurrente: cobrar solo si ya llegó la fecha.
      if (!act.fecha_proximo_cobro || act.fecha_proximo_cobro > hoy) continue;
      if (!act.wompi_payment_source_id || !act.wompi_customer_email) {
        await desactivarActivacionMarketplace(supabase, act);
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
      await supabase.from("dulabs_pagos").insert({
        id_tenant: act.id_tenant,
        wompi_transaction_id: transaccion.id,
        monto_cop: act.precio_cop,
        estado: transaccion.status,
      });

      if (transaccion.status === "APPROVED") {
        const proximoMes = new Date();
        proximoMes.setMonth(proximoMes.getMonth() + 1);
        await supabase
          .from("dulabs_marketplace_activaciones")
          .update({ fecha_proximo_cobro: proximoMes.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
          .eq("id", act.id);
        marketplace.push({ id: act.id, ok: true, detalle: "recobrada" });
      } else {
        await desactivarActivacionMarketplace(supabase, act);
        marketplace.push({ id: act.id, ok: false, detalle: `pago ${transaccion.status}, desactivada` });
      }
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      console.error(`[cobro-mensual] error en activación marketplace ${act.id}:`, detalle);
      marketplace.push({ id: act.id, ok: false, detalle });
    }
  }

  // --- Recordatorios de citas: citas de hoy o mañana sin recordatorio
  // enviado, de agentes con agenda. Se envían una vez en este batch diario —
  // no es "N horas antes" exacto, ver nota en el módulo de agenda. Dentro de
  // la ventana de 24h se manda texto libre; fuera de ella hace falta una
  // plantilla Utility aprobada (recordatorio_template_name) — si no hay una
  // configurada, el intento queda como error visible en el resultado, mismo
  // patrón que /api/cron/encuestas-seguimiento.
  const recordatorios: { id: number; ok: boolean; detalle: string }[] = [];
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const mananaISO = manana.toISOString().slice(0, 10);

  const { data: citasPendientes } = await supabase
    .from("dulabs_marketplace_citas")
    .select("id, activacion_id, phone_number_id, numero_cliente, nombre_cliente, fecha, hora_inicio, servicio")
    .eq("estado", "agendada")
    .eq("recordatorio_enviado", false)
    .in("fecha", [hoy, mananaISO]);

  if (citasPendientes && citasPendientes.length > 0) {
    const activacionIds = [...new Set(citasPendientes.map((c) => c.activacion_id))];
    const { data: activacionesRecordatorio } = await supabase
      .from("dulabs_marketplace_activaciones")
      .select("id, agente_slug, recordatorio_template_name")
      .in("id", activacionIds);
    const activacionPorId = new Map((activacionesRecordatorio ?? []).map((a) => [a.id, a]));

    const phoneNumberIds = [...new Set(citasPendientes.map((c) => c.phone_number_id))];
    const { data: clientes } = await supabase
      .from("dulabs_clientes_config")
      .select("phone_number_id, meta_permanent_token, whatsapp_business_account_id")
      .in("phone_number_id", phoneNumberIds);
    const clientePorNumero = new Map((clientes ?? []).map((c) => [c.phone_number_id, c]));

    for (const cita of citasPendientes) {
      try {
        const activacion = activacionPorId.get(cita.activacion_id);
        const cliente = clientePorNumero.get(cita.phone_number_id);
        if (!activacion || !cliente) throw new Error("negocio o activación no encontrados");
        const agente = agentePorSlug(activacion.agente_slug);
        const token = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
        if (!token) throw new Error("sin token de Meta");

        const esHoy = cita.fecha === hoy;
        const texto = `Recordatorio: tienes una cita ${esHoy ? "hoy" : "mañana"} a las ${cita.hora_inicio.slice(0, 5)}${
          agente ? ` en ${agente.nombre}` : ""
        }${cita.servicio ? ` (${cita.servicio})` : ""}.`;

        const dentroVentana = await dentroVentana24h(supabase, cita.phone_number_id, cita.numero_cliente);
        let wamid: string | null = null;
        if (dentroVentana) {
          ({ wamid } = await enviarTexto({ phoneNumberId: cita.phone_number_id, token, para: cita.numero_cliente, texto }));
        } else {
          if (!activacion.recordatorio_template_name) {
            throw new Error("fuera de la ventana de 24h y sin plantilla de recordatorio configurada");
          }
          const estado = await consultarEstadoPlantilla({
            wabaId: cliente.whatsapp_business_account_id,
            token,
            nombre: activacion.recordatorio_template_name,
          });
          if (estado !== "APPROVED") {
            throw new Error(`plantilla "${activacion.recordatorio_template_name}" no aprobada (estado: ${estado ?? "no encontrada"})`);
          }
          ({ wamid } = await enviarPlantilla({
            phoneNumberId: cita.phone_number_id,
            token,
            para: cita.numero_cliente,
            nombrePlantilla: activacion.recordatorio_template_name,
            idioma: IDIOMA_PLANTILLA,
          }));
        }

        await supabase.from("dulabs_mensajes_log").insert({
          phone_number_id: cita.phone_number_id,
          telefono_cliente: cita.numero_cliente,
          direccion: "saliente",
          contenido: texto,
          origen: "agente",
          wamid,
        });
        await supabase
          .from("dulabs_marketplace_citas")
          .update({ recordatorio_enviado: true, updated_at: new Date().toISOString() })
          .eq("id", cita.id);
        recordatorios.push({ id: cita.id, ok: true, detalle: "enviado" });
      } catch (err) {
        const detalle = err instanceof Error ? err.message : String(err);
        console.error(`[cobro-mensual] error enviando recordatorio de cita ${cita.id}:`, detalle);
        recordatorios.push({ id: cita.id, ok: false, detalle });
      }
    }
  }

  return Response.json({ procesados: resultados.length, resultados, marketplace, recordatorios });
}
