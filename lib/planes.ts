// Precios en pesos colombianos (COP), fuente única compartida por el
// checkout, la suscripción y el cobro mensual recurrente.
export const PRECIO_COP_POR_PLAN: Record<string, number> = {
  "Plan Básico": 59990,
  "Plan Pro": 129990,
  "Plan Enterprise": 299990,
};

export const PLAN_POR_DEFECTO = "Plan Pro";

export function precioPlan(plan: string): number {
  return PRECIO_COP_POR_PLAN[plan] ?? PRECIO_COP_POR_PLAN[PLAN_POR_DEFECTO];
}
