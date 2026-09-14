import { resolverEstadoPago } from "@/lib/wompi";

// Lógica pura de decisión del webhook de Wompi, aislada de I/O para poder
// probarla sin tocar Supabase real. El webhook (app/api/wompi/webhook/route.ts)
// solo ejecuta la acción que esta función devuelve.
//
// Regla central: un pago de marketplace NUNCA debe tocar dulabs_suscripciones
// (el plan principal), y un pago de suscripción nunca toca
// dulabs_marketplace_activaciones. El `tipo` del pago decide la rama.

export type PagoParaWebhook = {
  id_tenant: string;
  tipo: "suscripcion" | "marketplace";
  marketplace_activacion_id: number | null;
};

export type AccionWebhookPago =
  | { tipo: "actualizar_suscripcion"; idTenant: string; estado: "activa" | "vencida" }
  | { tipo: "desactivar_marketplace"; activacionId: number }
  | { tipo: "activar_marketplace"; activacionId: number }
  | { tipo: "sin_accion"; motivo: string };

// Mismo criterio de "rechazo" que ya usa app/api/dashboard/marketplace/activar/route.ts
// al decidir si un cobro de marketplace fue exitoso.
const ESTADOS_RECHAZADOS_MARKETPLACE = new Set(["DECLINED", "ERROR", "VOIDED"]);

// FASE F14 (SaaS Commercial Readiness, autorizado) -- hallazgo real de esta
// fase: el webhook aplicaba el evento de CUALQUIER transacción al tenant sin
// comparar si esa transacción sigue siendo la más reciente. Un evento tardío
// o reintentado por Wompi de una transacción VIEJA (p.ej. un intento de
// renovación que quedó en PENDING/DECLINED y luego el cliente reintentó con
// una transacción nueva que sí fue aprobada) podía llegar DESPUÉS del evento
// de la transacción nueva y revertir una suscripción recién activada a
// "vencida" -- confirmado con un test real (ver
// lib/flow/f14-billing-idempotencia.e2e.test.ts, escenario "webhook fuera de
// orden"). `esTransaccionMasReciente` lo calcula el caller (necesita
// consultar el máximo id de dulabs_pagos para ese tenant+tipo) porque esta
// función se mantiene pura/aislada de Supabase a propósito.
export function resolverAccionWebhookPago(
  pago: PagoParaWebhook,
  status: string,
  esTransaccionMasReciente: boolean = true,
): AccionWebhookPago {
  if (!esTransaccionMasReciente) {
    return {
      tipo: "sin_accion",
      motivo: "evento de una transacción anterior a la más reciente de este tenant/tipo -- se ignora para no revertir un estado ya resuelto por un intento más nuevo",
    };
  }
  if (pago.tipo === "marketplace") {
    if (!pago.marketplace_activacion_id) {
      return { tipo: "sin_accion", motivo: "pago marketplace sin marketplace_activacion_id" };
    }
    if (ESTADOS_RECHAZADOS_MARKETPLACE.has(status)) {
      return { tipo: "desactivar_marketplace", activacionId: pago.marketplace_activacion_id };
    }
    if (status === "APPROVED") {
      return { tipo: "activar_marketplace", activacionId: pago.marketplace_activacion_id };
    }
    // PENDING u otro estado no terminal: no tocar nada, esperar el próximo evento.
    return { tipo: "sin_accion", motivo: `estado no terminal (${status}), esperando próximo evento` };
  }

  // tipo === "suscripcion": mismo criterio de 3 vías que suscribir/route.ts y
  // cobro-mensual/route.ts (resolverEstadoPago, lib/wompi.ts). PENDING no es
  // terminal — no toca la suscripción todavía (sigue en pendiente_pago o
  // "activa" según quien la haya dejado así), se espera el próximo evento.
  const estado = resolverEstadoPago(status);
  if (estado === "pendiente_pago") {
    return { tipo: "sin_accion", motivo: `suscripción con estado no terminal (${status}), esperando próximo evento` };
  }
  return { tipo: "actualizar_suscripcion", idTenant: pago.id_tenant, estado };
}

// FASE F14 -- hallazgo real: app/api/wompi/cobro-mensual/route.ts dejaba
// fecha_proximo_cobro sin tocar cuando el cobro del día quedaba PENDING (3DS
// en curso), así que la corrida del cron del día siguiente volvía a
// seleccionar la misma suscripción (sigue "activa", con
// fecha_proximo_cobro <= hoy) y creaba una SEGUNDA transacción real con la
// misma fuente de pago -- doble cobro si ambas terminan aprobadas, o un
// tercer intento el día después si la segunda también queda PENDING. Esta
// función pura decide si el cron debe SALTARSE el cobro de hoy porque el
// intento anterior de este mismo tenant todavía no se resolvió; el caller
// (cobro-mensual/route.ts) es quien consulta el último pago real.
export function debeOmitirCobroPorPagoPendiente(ultimoPago: { estado: string } | null): boolean {
  return ultimoPago?.estado === "PENDING";
}
