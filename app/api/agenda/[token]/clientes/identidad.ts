import { AMORE_TENANT_ID, phoneNumberIdWhatsappQr } from "@/lib/nylas/nylas-grant";
import type { ResolverTenantResultado } from "@/lib/agenda-admin-auth";

/**
 * Identidad de un cliente (autorizado) -- MISMA regla exacta que ya usa todo
 * el resto del sistema para AMORE (lib/agenda-v2/router.ts::phoneNumberIdSintetico,
 * lib/reserva-servicio-nylas.ts): el phone_number_id "legacy" de Meta que
 * trae especialistaPorRuta para AMORE NUNCA es el correcto (AMORE es
 * WhatsApp-QR/Baileys, no Meta Cloud API) -- usar ese valor crearía un
 * cliente que el bot jamás reconoce cuando esa persona escriba de verdad. Un
 * cliente creado/editado desde este admin para AMORE debe usar el MISMO
 * prefijo sintético "whatsapp-qr:<tenant>" que ya usa el registro real por
 * WhatsApp, para que sea EXACTAMENTE el mismo registro (nunca uno duplicado).
 * Cualquier otro tenant sigue con su phone_number_id real de siempre.
 */
export function resolverPhoneNumberIdCliente(tenant: Pick<Extract<ResolverTenantResultado, { ok: true }>, "idTenant" | "phoneNumberId">): string {
  return tenant.idTenant === AMORE_TENANT_ID ? phoneNumberIdWhatsappQr(tenant.idTenant) : tenant.phoneNumberId;
}

/** Día/mes de cumpleaños (nunca año) -- mismo rango real en todo el sistema (ver lib/clientes-conocidos.ts). */
export function validarCumpleanos(dia: unknown, mes: unknown): { ok: true } | { ok: false; error: string } {
  if (dia !== undefined && dia !== null) {
    const n = Number(dia);
    if (!Number.isInteger(n) || n < 1 || n > 31) return { ok: false, error: "El día de cumpleaños no es válido" };
  }
  if (mes !== undefined && mes !== null) {
    const n = Number(mes);
    if (!Number.isInteger(n) || n < 1 || n > 12) return { ok: false, error: "El mes de cumpleaños no es válido" };
  }
  return { ok: true };
}
