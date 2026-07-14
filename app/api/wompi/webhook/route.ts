import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verificarChecksumEvento } from "@/lib/wompi";

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

  const { data: pago, error: pagoError } = await supabase
    .from("dulabs_pagos")
    .update({ estado: status })
    .eq("wompi_transaction_id", transactionId)
    .select("id_tenant")
    .maybeSingle();

  if (pagoError) {
    console.error("[wompi-webhook] error actualizando pago:", pagoError.message);
  }

  if (pago?.id_tenant) {
    const nuevoEstado = status === "APPROVED" ? "activa" : status === "DECLINED" ? "vencida" : null;
    if (nuevoEstado) {
      const { error: subError } = await supabase
        .from("dulabs_suscripciones")
        .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
        .eq("id_tenant", pago.id_tenant);
      if (subError) {
        console.error("[wompi-webhook] error actualizando suscripción:", subError.message);
      }
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}
