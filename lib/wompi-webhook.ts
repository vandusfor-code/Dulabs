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

export function resolverAccionWebhookPago(pago: PagoParaWebhook, status: string): AccionWebhookPago {
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

  // tipo === "suscripcion": mismo criterio que ya existía antes de este fix
  // (preservado tal cual lo pidió el usuario, "como hoy").
  return {
    tipo: "actualizar_suscripcion",
    idTenant: pago.id_tenant,
    estado: status === "DECLINED" ? "vencida" : "activa",
  };
}
