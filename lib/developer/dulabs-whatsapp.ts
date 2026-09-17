import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPlantilla } from "@/lib/meta-templates";
import { resolverTokenMeta } from "@/lib/whatsapp-outbound";
import { DULABS_PHONE_NUMBER_ID } from "@/lib/site-contact";
import type { ClienteConfig } from "@/lib/supabase";

// DuLabs Developer -- envío de plantillas WhatsApp desde el número OFICIAL de
// DuLabs (3148127388 / DULABS_PHONE_NUMBER_ID). Punto único que REUTILIZA la
// infraestructura de Business: token cifrado de dulabs_clientes_config resuelto
// con resolverTokenMeta, y enviarPlantilla. NO crea número/WABA/token nuevos.
// Antes de enviar, LEE la estructura real de la plantilla en Meta (status +
// número de variables) y valida que los parámetros calcen -- nunca manda un
// payload que Meta rechazaría, y nunca "inventa" variables. No lanza.

export const DULABS_WABA_ID = "1399061204706262";

function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v21.0"}`;
}

export type ResultadoEnvioTemplate =
  | { enviado: true; wamid: string | null }
  | { enviado: false; motivo: string; detalle?: string };

async function resolverTokenDulabs(supabase: SupabaseClient): Promise<{ token: string } | { error: string }> {
  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, meta_permanent_token, estado_conexion")
    .eq("phone_number_id", DULABS_PHONE_NUMBER_ID)
    .maybeSingle();
  if (error) return { error: `config número DuLabs: ${error.message}` };
  if (!data) return { error: "numero_dulabs_no_encontrado" };
  let token: string | null = null;
  try {
    token = resolverTokenMeta(data as unknown as ClienteConfig);
  } catch (err) {
    return { error: `token_no_resoluble: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!token) return { error: "sin_token_meta" };
  return { token };
}

async function contarVariablesPlantilla(token: string, nombre: string): Promise<{ status: string; bodyVars: number } | { error: string }> {
  const url = `${graphBase()}/${DULABS_WABA_ID}/message_templates?name=${encodeURIComponent(nombre)}&fields=name,status,components`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => null)) as
    | { data?: { status: string; components?: { type: string; text?: string }[] }[]; error?: { message: string } }
    | null;
  if (!json) return { error: "respuesta no-JSON de Meta" };
  if (json.error) return { error: json.error.message };
  const t = json.data?.[0];
  if (!t) return { error: `plantilla ${nombre} no encontrada en el WABA` };
  const body = (t.components ?? []).find((c) => c.type === "BODY");
  const bodyVars = (body?.text?.match(/{{\d+}}/g) ?? []).length;
  return { status: t.status, bodyVars };
}

/**
 * Envía `nombrePlantilla` desde el número DuLabs a `destinoE164`, validando
 * contra la estructura real: la plantilla debe estar APPROVED y su nº de
 * variables debe coincidir con params.length -- si no, aborta con motivo claro.
 */
export async function enviarTemplateDulabs(
  supabase: SupabaseClient,
  input: { nombrePlantilla: string; idioma: string; destinoE164: string; params?: string[] }
): Promise<ResultadoEnvioTemplate> {
  const destino = input.destinoE164.replace(/[^\d]/g, ""); // Meta espera dígitos, sin "+"
  if (!destino) return { enviado: false, motivo: "destino_invalido" };

  const tok = await resolverTokenDulabs(supabase);
  if ("error" in tok) return { enviado: false, motivo: "sin_credenciales", detalle: tok.error };

  const insp = await contarVariablesPlantilla(tok.token, input.nombrePlantilla);
  if ("error" in insp) return { enviado: false, motivo: "plantilla_no_consultable", detalle: insp.error };
  if (insp.status !== "APPROVED") return { enviado: false, motivo: "plantilla_no_aprobada", detalle: `status=${insp.status}` };

  const params = input.params ?? [];
  if (insp.bodyVars !== params.length) {
    return { enviado: false, motivo: "variables_no_coinciden", detalle: `plantilla espera ${insp.bodyVars}, se pasaron ${params.length}` };
  }

  try {
    const { wamid } = await enviarPlantilla({
      phoneNumberId: DULABS_PHONE_NUMBER_ID,
      token: tok.token,
      para: destino,
      nombrePlantilla: input.nombrePlantilla,
      idioma: input.idioma,
      parametrosPosicionales: params.length > 0 ? params : undefined,
    });
    return { enviado: true, wamid };
  } catch (err) {
    return { enviado: false, motivo: "error_envio", detalle: err instanceof Error ? err.message : String(err) };
  }
}
