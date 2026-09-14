import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verificarChecksumEvento } from "@/lib/wompi";
import { desactivarActivacion } from "@/lib/marketplace-store";
import { resolverAccionWebhookPago } from "@/lib/wompi-webhook";
import { dispararOnboardingSiAplica } from "@/lib/onboarding-trigger";
import {
  obtenerCicloActivo,
  iniciarCicloDunning,
  registrarReintentoFallido,
  recuperarCicloDunning,
  expirarSuscripcionPorAgotamiento,
} from "@/lib/dunning/dunning-domain";
import { enviarNotificacionDunning } from "@/lib/dunning/notificaciones";

export const runtime = "nodejs";

type EventoWompi = {
  event: string;
  data: { transaction: { id: string; status: string; amount_in_cents: number } };
  signature: { properties: string[]; checksum: string };
  timestamp: number;
};

// Wompi reintenta hasta 3 veces en 24h si no respondemos 200 a tiempo,
// así que respondemos rápido y dejamos el trabajo pesado adentro simple.
export async function POST(request: NextRequest) {
  let payload: EventoWompi;
  try {
    payload = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (!verificarChecksumEvento(payload)) {
    console.error("[wompi-webhook] checksum inválido, evento descartado");
    return new Response("Forbidden", { status: 403 });
  }

  if (payload.event !== "transaction.updated") {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  const { id: transactionId, status } = payload.data.transaction;
  const supabase = supabaseAdmin();

  // El `tipo` decide qué tabla actualizar: un pago de marketplace nunca debe
  // tocar dulabs_suscripciones (el plan principal), y viceversa. Si la
  // migración que agrega estas columnas todavía no corrió en Supabase, este
  // select falla con "column does not exist" — pagoError queda registrado y
  // `pago` sale null, así que no se actualiza nada (fail-safe) en vez de
  // reventar o de repetir el bug viejo.
  const { data: pago, error: pagoError } = await supabase
    .from("dulabs_pagos")
    .update({ estado: status })
    .eq("wompi_transaction_id", transactionId)
    .select("id, id_tenant, tipo, marketplace_activacion_id")
    .maybeSingle();

  if (pagoError) {
    console.error(
      `[wompi-webhook] error actualizando pago (¿falta correr la migración de tipo/marketplace_activacion_id?):`,
      pagoError.message
    );
  }

  if (!pago) {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  // FASE F14 -- protección real contra eventos fuera de orden (ver comentario
  // en lib/wompi-webhook.ts): solo se aplica el evento si esta es la
  // transacción más reciente registrada para este tenant+tipo. Para
  // marketplace, "más reciente" se compara dentro de la misma activación
  // (dos tenants distintos nunca comparten activacion_id), no del tenant
  // entero -- un tenant puede tener varias activaciones de marketplace en
  // paralelo, cada una con su propio historial de cobro.
  let masRecienteQuery = supabase
    .from("dulabs_pagos")
    .select("id")
    .eq("id_tenant", pago.id_tenant)
    .eq("tipo", pago.tipo);
  masRecienteQuery =
    pago.tipo === "marketplace"
      ? masRecienteQuery.eq("marketplace_activacion_id", pago.marketplace_activacion_id)
      : masRecienteQuery;
  const { data: masReciente } = await masRecienteQuery.order("id", { ascending: false }).limit(1).maybeSingle();
  const esTransaccionMasReciente = !masReciente || masReciente.id <= pago.id;

  const accion = resolverAccionWebhookPago(pago, status, esTransaccionMasReciente);

  switch (accion.tipo) {
    case "actualizar_suscripcion": {
      // FASE F16.1 (Dunning, autorizado) -- este evento puede estar
      // confirmando de forma asíncrona (challenge 3DS) un cobro que en
      // realidad ya pasó por el ciclo de dunning (el cron de reintentos, o
      // el cobro mensual original). obtenerCicloActivo() es el discriminador:
      // si ya hay un ciclo activo para este tenant, esta confirmación
      // resuelve ESE ciclo (reintento fallido/recuperado); si no, es un
      // evento normal (o el primer fallo real) y sigue el camino de F14.
      const cicloExistente = await obtenerCicloActivo(supabase, accion.idTenant);

      if (accion.estado === "vencida") {
        if (cicloExistente) {
          const resultado = await registrarReintentoFallido(supabase, {
            cicloId: cicloExistente.id,
            idTenant: accion.idTenant,
            primerFalloAt: new Date(cicloExistente.primer_fallo_at),
            intentosActuales: cicloExistente.intentos,
            motivoFallo: status,
          });
          if (resultado.expirado) {
            await expirarSuscripcionPorAgotamiento(supabase, accion.idTenant);
            const { data: authUser } = await supabase.auth.admin.getUserById(accion.idTenant);
            await enviarNotificacionDunning(supabase, {
              idTenant: accion.idTenant,
              cicloId: cicloExistente.id,
              tipo: "expired",
              destinatario: authUser?.user?.email ?? null,
              nombreNegocio: (authUser?.user?.user_metadata?.nombre as string | undefined) ?? null,
            });
          }
          break;
        }

        // Sin ciclo activo: solo se abre uno nuevo si la suscripción YA
        // estaba 'activa' (una renovación real que falló) -- un primer pago
        // de alta ('pendiente_pago' -> rechazado) no tiene servicio que
        // proteger con un período de gracia, así que ese caso sigue el
        // camino de F14 tal cual (se marca 'vencida' de inmediato, sin abrir
        // dunning).
        const { data: suscripcionActual } = await supabase.from("dulabs_suscripciones").select("estado").eq("id_tenant", accion.idTenant).maybeSingle();
        if (suscripcionActual?.estado === "activa") {
          const ciclo = await iniciarCicloDunning(supabase, { idTenant: accion.idTenant, motivoFallo: status });
          const { data: authUser } = await supabase.auth.admin.getUserById(accion.idTenant);
          await enviarNotificacionDunning(supabase, {
            idTenant: accion.idTenant,
            cicloId: ciclo.id,
            tipo: "payment_failed",
            destinatario: authUser?.user?.email ?? null,
            nombreNegocio: (authUser?.user?.user_metadata?.nombre as string | undefined) ?? null,
          });
          break;
        }

        const { error } = await supabase
          .from("dulabs_suscripciones")
          .update({ estado: accion.estado, updated_at: new Date().toISOString() })
          .eq("id_tenant", accion.idTenant);
        if (error) console.error("[wompi-webhook] error actualizando suscripción:", error.message);
        break;
      }

      // accion.estado === "activa"
      if (cicloExistente) {
        const proximoMes = new Date();
        proximoMes.setMonth(proximoMes.getMonth() + 1);
        await supabase
          .from("dulabs_suscripciones")
          .update({ estado: "activa", fecha_proximo_cobro: proximoMes.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
          .eq("id_tenant", accion.idTenant);
        await recuperarCicloDunning(supabase, { cicloId: cicloExistente.id, idTenant: accion.idTenant });
        const { data: authUser } = await supabase.auth.admin.getUserById(accion.idTenant);
        await enviarNotificacionDunning(supabase, {
          idTenant: accion.idTenant,
          cicloId: cicloExistente.id,
          tipo: "recovered",
          destinatario: authUser?.user?.email ?? null,
          nombreNegocio: (authUser?.user?.user_metadata?.nombre as string | undefined) ?? null,
        });
        break;
      }

      const { error } = await supabase
        .from("dulabs_suscripciones")
        .update({ estado: accion.estado, updated_at: new Date().toISOString() })
        .eq("id_tenant", accion.idTenant);
      if (error) {
        console.error("[wompi-webhook] error actualizando suscripción:", error.message);
      } else {
        // Onboarding automático por WhatsApp -- solo dispara en pago
        // realmente confirmado (nunca en "vencida"), y es idempotente por
        // tenant, así que una renovación mensual no manda una segunda
        // bienvenida (ver lib/onboarding-trigger.ts).
        await dispararOnboardingSiAplica(supabase, accion.idTenant);
      }
      break;
    }
    case "desactivar_marketplace":
      await desactivarActivacion(supabase, accion.activacionId);
      break;
    case "activar_marketplace": {
      const { error } = await supabase
        .from("dulabs_marketplace_activaciones")
        .update({ estado: "activa", updated_at: new Date().toISOString() })
        .eq("id", accion.activacionId);
      if (error) {
        console.error("[wompi-webhook] error activando activación de marketplace:", error.message);
      }
      break;
    }
    case "sin_accion":
      console.log(`[wompi-webhook] transacción ${transactionId}: ${accion.motivo}`);
      break;
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}
