/**
 * PILOTO AMORE + Nylas (autorizado) — el grant_id de Nylas NUNCA se
 * hardcodea dentro de la lógica de negocio (mismo criterio que
 * resolverAiExecutorOverride en lib/whatsapp-qr-bot.ts para Gemini): se
 * resuelve acá, gateado explícitamente por tenant_id real, y solo AMORE lo
 * recibe. Cualquier otro tenant (incluido uno futuro) recibe `null` --
 * ningún calendario de otro tenant puede terminar consultado por error.
 */
export const AMORE_TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";

export function resolverNylasGrantIdParaTenant(idTenant: string): string | null {
  if (idTenant !== AMORE_TENANT_ID) return null;
  return process.env.NYLAS_GRANT_ID_AMORE ?? null;
}
