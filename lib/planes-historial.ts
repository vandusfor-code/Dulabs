import type { SupabaseClient } from "@supabase/supabase-js";

// FASE F14.2 (Billing / Monetización completa, autorizado) -- helpers
// compartidos para las 2 tablas nuevas de la migración
// 20260914100000_upgrade_downgrade_historial.sql. Ambos son fail-safe: si la
// migración todavía no corrió en Supabase, no deben tumbar el flujo real de
// pago/cambio de plan que los llama -- mismo criterio que ya usa
// app/api/wompi/webhook/route.ts con tipo/marketplace_activacion_id.

export async function registrarCambioPlan(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    planAnterior: string | null;
    planNuevo: string;
    precioAnteriorCop: number | null;
    precioNuevoCop: number;
    actorUserId: string | null;
    motivo: string;
  },
): Promise<void> {
  const { error } = await supabase.from("dulabs_historial_planes").insert({
    id_tenant: params.idTenant,
    plan_anterior: params.planAnterior,
    plan_nuevo: params.planNuevo,
    precio_anterior_cop: params.precioAnteriorCop,
    precio_nuevo_cop: params.precioNuevoCop,
    actor_user_id: params.actorUserId,
    motivo: params.motivo,
  });
  if (error) {
    console.error(
      `[planes-historial] no se pudo registrar el cambio de plan de ${params.idTenant} (¿falta correr la migración 20260914100000?):`,
      error.message,
    );
  }
}

type FilaPago = {
  id_tenant: string;
  wompi_transaction_id: string;
  monto_cop: number;
  estado: string;
  tipo: "suscripcion" | "marketplace";
  marketplace_activacion_id?: number | null;
};

// Inserta en dulabs_pagos incluyendo `plan` (columna nueva); si esa columna
// todavía no existe (42703, migración no aplicada), reintenta sin ella en
// vez de perder el registro del pago -- perder la trazabilidad del plan es
// aceptable temporalmente, perder el pago completo no lo es.
// Códigos reales confirmados contra Supabase real (autorizado, verificado
// empíricamente, ver lib/amore-entrada-sesiones.ts): un INSERT/UPDATE con una
// columna que el schema cache de PostgREST todavía no conoce responde
// "PGRST204", NUNCA el "42703" (undefined_column) de Postgres crudo -- se
// comprueban ambos por robustez.
const CODIGOS_COLUMNA_INEXISTENTE = new Set(["PGRST204", "42703"]);

export async function insertarPagoConPlan(
  supabase: SupabaseClient,
  fila: FilaPago,
  plan: string | null,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("dulabs_pagos").insert({ ...fila, plan });
  if (error && CODIGOS_COLUMNA_INEXISTENTE.has(error.code)) {
    console.error("[planes-historial] dulabs_pagos.plan no existe todavía (falta correr la migración 20260914100000), insertando sin ese campo:", error.message);
    return supabase.from("dulabs_pagos").insert(fila);
  }
  return { error };
}
