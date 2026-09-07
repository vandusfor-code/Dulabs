/**
 * Verificación compartida de "¿el número remitente de esta plantilla/envío
 * sigue realmente conectado a este tenant?" -- reutilizada TAL CUAL por
 * POST /api/campanas/enviar y POST /api/campanas/media, para que ambos
 * apliquen exactamente el mismo criterio (nunca dos reglas ligeramente
 * distintas para lo mismo).
 *
 * Motivo real (caso Soluciones Financieras/Charlotte, autorizado): cuando un
 * tenant reconecta su WhatsApp tras una desconexión, Meta puede emitir un
 * phone_number_id NUEVO para el mismo número físico -- el flujo de conexión
 * (app/api/auth/meta-callback/route.ts) actualiza dulabs_clientes_config en
 * el momento, pero NUNCA reasigna las plantillas ya creadas bajo el
 * phone_number_id viejo (una plantilla aprobada por Meta pertenece al WABA
 * donde se aprobó, no es portable con solo cambiar un campo en nuestra base
 * de datos). Esas plantillas quedan "huérfanas": siguen existiendo y
 * apareciendo como APPROVED, pero su phone_number_id ya no tiene ninguna
 * fila de configuración real. Esta función es el único punto que decide eso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClienteConfigNumero {
  id: string;
  phone_number_id: string;
  meta_permanent_token: string | null;
  mensajes_usados_mes: number;
  mes_actual: string;
}

export const MENSAJE_PLANTILLA_DESCONECTADA = "La plantilla seleccionada ya no está vinculada a un número de WhatsApp activo.";

/**
 * Fila real de configuración del número remitente, o null si ese
 * phone_number_id ya no está conectado a este tenant. Nunca hardcodea
 * ningún tenant/número -- funciona igual para cualquiera.
 */
export async function resolverClienteDeNumero(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; idTenant: string },
): Promise<ClienteConfigNumero | null> {
  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("id, phone_number_id, meta_permanent_token, mensajes_usados_mes, mes_actual")
    .eq("phone_number_id", params.phoneNumberId)
    .eq("id_tenant", params.idTenant)
    .maybeSingle();
  if (error) throw error;
  return data as ClienteConfigNumero | null;
}

/**
 * Todos los phone_number_id realmente conectados a este tenant hoy -- usado
 * para marcar qué plantillas son utilizables (GET /api/plantillas) sin
 * necesidad de consultar uno por uno.
 */
export async function phoneNumberIdsConectados(supabase: SupabaseClient, idTenant: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("dulabs_clientes_config").select("phone_number_id").eq("id_tenant", idTenant);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.phone_number_id as string));
}
