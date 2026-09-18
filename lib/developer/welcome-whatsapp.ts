import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarTemplateDulabs, type ResultadoEnvioTemplate } from "@/lib/developer/dulabs-whatsapp";
import { resolverContactoUsuario, primerNombreDe } from "@/lib/developer/contacto";

// DuLabs Developer -- bienvenida por WhatsApp. Usa la plantilla APROBADA
// bienvenida_2 (Spanish COL, es_CO) enviada desde el número oficial de DuLabs
// vía el sender compartido (lib/developer/dulabs-whatsapp), que reutiliza la
// infra de Business (token cifrado + enviarPlantilla) y valida la estructura
// real de la plantilla antes de enviar. La idempotencia ("una sola vez") la
// controla el orquestador (se dispara en la primera provisión del workspace).

const NOMBRE_PLANTILLA = "bienvenida_2";
const IDIOMA = "es_CO";

export type ResultadoBienvenidaWhatsapp = ResultadoEnvioTemplate;

export async function enviarBienvenidaWhatsappDeveloper(
  supabase: SupabaseClient,
  params: { destinoE164: string; nombre: string }
): Promise<ResultadoBienvenidaWhatsapp> {
  // bienvenida_2 personaliza el nombre en su variable de cuerpo ({{1}}).
  return enviarTemplateDulabs(supabase, {
    nombrePlantilla: NOMBRE_PLANTILLA,
    idioma: IDIOMA,
    destinoE164: params.destinoE164,
    params: [params.nombre || "cliente"],
  });
}

/**
 * Resuelve el contacto del usuario y envía la bienvenida. Punto reutilizado por
 * el worker de QStash (procesamiento del job) y por el fallback inline de
 * welcome.ts cuando QStash no está disponible. Devuelve motivo "sin_whatsapp"
 * si el usuario no tiene número (no es un error).
 */
export async function enviarBienvenidaWhatsappPorUsuario(supabase: SupabaseClient, userId: string): Promise<ResultadoBienvenidaWhatsapp> {
  const c = await resolverContactoUsuario(supabase, userId);
  if (!c.whatsapp) return { enviado: false, motivo: "sin_whatsapp" };
  return enviarBienvenidaWhatsappDeveloper(supabase, { destinoE164: c.whatsapp, nombre: primerNombreDe(c.nombre) });
}
