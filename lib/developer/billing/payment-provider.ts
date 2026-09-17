import {
  crearFuentePagoDev,
  crearTransaccionDev,
  verificarChecksumEventoDev,
  estadoDesdeWompi,
  type EstadoWompi,
} from "@/lib/developer/billing/wompi-client";

// DuLabs Developer V1 -- Fase 12 (Billing). Abstracción de proveedor de pago.
// Wompi es el proveedor actual, pero todo el billing de Developer depende de
// esta interface (no de Wompi directo), para poder añadir un proveedor
// internacional a futuro sin reescribir checkout/webhook/recurrencia.

export type ResultadoTransaccion = { id: string; status: EstadoWompi; amountInCents: number };

export type EventoWebhookNormalizado = {
  /** Huella única del evento para idempotencia (checksum del evento en Wompi). */
  eventId: string;
  tipo: string;
  transactionId: string | null;
  status: string | null;
  raw: unknown;
};

export interface PaymentProvider {
  readonly nombre: string;
  /** Crea la fuente de pago tokenizada reutilizable. Devuelve su id o lanza. */
  crearFuentePago(params: { token: string; customerEmail: string; acceptanceToken: string; acceptPersonalAuth: string }): Promise<{ id: number; status: string }>;
  /** Cobra en la moneda del proveedor (COP para Wompi). `amountInCents` ya resuelto server-side. */
  cobrar(params: { amountInCents: number; customerEmail: string; reference: string; paymentSourceId: number; recurrent?: boolean }): Promise<ResultadoTransaccion>;
  /** Verifica la firma del webhook. */
  verificarFirmaWebhook(payload: unknown): boolean;
  /** Normaliza el payload del webhook (idempotencia + datos de transacción). */
  parsearEvento(payload: unknown): EventoWebhookNormalizado | null;
  /** Mapea el status crudo del proveedor al efecto sobre la suscripción. */
  efectoDeEstado(status: string): "active" | "pendiente" | "fallido";
}

type PayloadWompi = {
  event?: string;
  data?: { transaction?: { id?: string; status?: string } };
  signature?: { properties?: string[]; checksum?: string };
  timestamp?: number;
};

export class WompiProvider implements PaymentProvider {
  readonly nombre = "wompi";

  async crearFuentePago(params: { token: string; customerEmail: string; acceptanceToken: string; acceptPersonalAuth: string }) {
    const f = await crearFuentePagoDev({
      token: params.token,
      customer_email: params.customerEmail,
      acceptance_token: params.acceptanceToken,
      accept_personal_auth: params.acceptPersonalAuth,
    });
    return { id: f.id, status: f.status };
  }

  async cobrar(params: { amountInCents: number; customerEmail: string; reference: string; paymentSourceId: number; recurrent?: boolean }) {
    const t = await crearTransaccionDev({
      amount_in_cents: params.amountInCents,
      customer_email: params.customerEmail,
      reference: params.reference,
      payment_source_id: params.paymentSourceId,
      recurrent: params.recurrent,
    });
    return { id: t.id, status: t.status, amountInCents: t.amount_in_cents };
  }

  verificarFirmaWebhook(payload: unknown): boolean {
    const p = payload as PayloadWompi;
    if (!p?.data || !p.signature?.properties || !p.signature.checksum || typeof p.timestamp !== "number") return false;
    return verificarChecksumEventoDev({
      data: p.data as Record<string, unknown>,
      signature: { properties: p.signature.properties, checksum: p.signature.checksum },
      timestamp: p.timestamp,
    });
  }

  parsearEvento(payload: unknown): EventoWebhookNormalizado | null {
    const p = payload as PayloadWompi;
    if (!p?.data?.transaction || !p.signature?.checksum) return null;
    return {
      eventId: p.signature.checksum, // único por evento -> idempotencia/replay
      tipo: p.event ?? "unknown",
      transactionId: p.data.transaction.id ?? null,
      status: p.data.transaction.status ?? null,
      raw: payload,
    };
  }

  efectoDeEstado(status: string) {
    return estadoDesdeWompi(status);
  }
}

/** Selección del proveedor activo (hoy Wompi). Único punto para cambiarlo. */
export function obtenerPaymentProvider(): PaymentProvider {
  return new WompiProvider();
}
