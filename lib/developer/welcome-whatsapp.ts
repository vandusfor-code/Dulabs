import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarTemplateDulabs, type ResultadoEnvioTemplate } from "@/lib/developer/dulabs-whatsapp";

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
