import { createHash } from "node:crypto";

/**
 * Clave estable de una conversación de Publi Bordados, aislada por tenant + número + cliente.
 * Es la MISMA que calcula `dulabs_pb_clave_conversacion` en SQL (mismo vector probado en ambos
 * lados), así un operador puede buscar una conversación desde el SQL Editor sin que el teléfono
 * quede guardado. No es un secreto: el tenant (uuid) y el phone_number_id forman parte del
 * material, así que la misma persona tiene claves distintas en números o tenants distintos.
 */
export function claveConversacion(idTenant: string, phoneNumberId: string, waId: string): string {
  const material = `dulabs:pb:v1:${idTenant.toLowerCase()}:${phoneNumberId}:${waId.replace(/\D/g, "")}`;
  return createHash("sha256").update(material, "utf8").digest("hex");
}
