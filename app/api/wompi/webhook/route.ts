import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verificarChecksumEvento } from "@/lib/wompi";
import { desactivarActivacion } from "@/lib/marketplace-store";
import { resolverAccionWebhookPago } from "@/lib/wompi-webhook";

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
    .select("id_tenant, tipo, marketplace_activacion_id")
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

  const accion = resolverAccionWebhookPago(pago, status);

  switch (accion.tipo) {
    case "actualizar_suscripcion": {
      const { error } = await supabase
        .from("dulabs_suscripciones")
        .update({ estado: accion.estado, updated_at: new Date().toISOString() })
        .eq("id_tenant", accion.idTenant);
      if (error) {
        console.error("[wompi-webhook] error actualizando suscripción:", error.message);
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
