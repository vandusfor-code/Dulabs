// DuLabs Developer V1 -- Fase 12 (Billing). Feature flag server-side. OFF por
// defecto => comportamiento EXACTO de Fase 11 (cambios de plan inmediatos vía
// /subscription/plan). ON => upgrade exige pago (checkout) y downgrade se
// difiere al fin de período. Nunca se lee del cliente.
export function billingHabilitado(): boolean {
  const v = (process.env.DEVELOPER_BILLING_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on";
}
