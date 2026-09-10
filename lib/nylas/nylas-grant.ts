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

/**
 * NUEVA FASE (autorizado, comisiones/clientes/citas manuales) — mismo
 * prefijo sintético que ya usan por su cuenta lib/agenda-v2/router.ts
 * (phoneNumberIdSintetico) y lib/reserva-servicio-nylas.ts (inline): la
 * identidad real de un cliente/una cita de AMORE en todo el sistema
 * (dulabs_clientes_conocidos, dulabs_citas_especialista.phone_number_id)
 * NUNCA es el phone_number_id legacy de Meta -- siempre "whatsapp-qr:<tenant>".
 * Exportada acá (junto a AMORE_TENANT_ID, el otro dato de identidad de este
 * tenant) para que código NUEVO la reutilice en vez de reimplementar el
 * mismo prefijo una tercera vez.
 */
export function phoneNumberIdWhatsappQr(idTenant: string): string {
  return `whatsapp-qr:${idTenant}`;
}
