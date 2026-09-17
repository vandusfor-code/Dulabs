import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPlantilla } from "@/lib/meta-templates";
import { resolverTokenMeta } from "@/lib/whatsapp-outbound";
import { DULABS_PHONE_NUMBER_ID } from "@/lib/site-contact";
import type { ClienteConfig } from "@/lib/supabase";

// DuLabs Developer -- bienvenida por WhatsApp. REUTILIZA la infraestructura
// existente de DuLabs Business: el número oficial 3148127388
// (phone_number_id DULABS_PHONE_NUMBER_ID), su token cifrado en
// dulabs_clientes_config.meta_permanent_token resuelto con resolverTokenMeta, y
// enviarPlantilla. NO crea número, WABA, token ni proveedor nuevos.
//
// Plantilla APROBADA: bienvenida_2 (Spanish COL, es_CO). NO se asume su
// estructura: se lee la plantilla real en Meta (status + variables) y se
// construyen los parámetros según las variables que REALMENTE tenga. Si no está
// APPROVED o tiene una forma inesperada, se aborta con un motivo claro -- nunca
// se manda un payload que Meta rechazaría. No lanza: devuelve un resultado
// explícito para que el orquestador lo audite. El pago/registro NO deben fallar
// si esto falla.

const NOMBRE_PLANTILLA = "bienvenida_2";
const IDIOMA = "es_CO";
const DULABS_WABA_ID = "1399061204706262";

function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v21.0"}`;
}

export type ResultadoBienvenidaWhatsapp =
  | { enviado: true; wamid: string | null }
  | { enviado: false; motivo: string; detalle?: string };

async function resolverNumeroDulabs(supabase: SupabaseClient): Promise<{ ok: true; cliente: ClienteConfig } | { ok: false; motivo: string }> {
  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, meta_permanent_token, estado_conexion")
    .eq("phone_number_id", DULABS_PHONE_NUMBER_ID)
    .maybeSingle();
  if (error) return { ok: false, motivo: `error leyendo config del número DuLabs: ${error.message}` };
  if (!data) return { ok: false, motivo: "numero_dulabs_no_encontrado" };
  return { ok: true, cliente: data as unknown as ClienteConfig };
}

/** Lee la plantilla real en Meta: estado + nº de variables del body. */
async function inspeccionarPlantilla(token: string): Promise<{ status: string; bodyVars: number } | { error: string }> {
  const url = `${graphBase()}/${DULABS_WABA_ID}/message_templates?name=${NOMBRE_PLANTILLA}&fields=name,status,components`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => null)) as
    | { data?: { status: string; components?: { type: string; text?: string }[] }[]; error?: { message: string } }
    | null;
  if (!json) return { error: "respuesta no-JSON de Meta" };
  if (json.error) return { error: json.error.message };
  const t = json.data?.[0];
  if (!t) return { error: `plantilla ${NOMBRE_PLANTILLA} no encontrada en el WABA` };
  const body = (t.components ?? []).find((c) => c.type === "BODY");
  const bodyVars = (body?.text?.match(/{{\d+}}/g) ?? []).length;
  return { status: t.status, bodyVars };
}

/**
 * Envía bienvenida_2 al WhatsApp del usuario recién registrado, desde el número
 * oficial de DuLabs. `nombre` alimenta la variable de la plantilla si existe.
 * Idempotencia y "enviar una sola vez" las controla el ORQUESTADOR (se dispara
 * en la primera provisión del workspace); acá se hace un intento seguro.
 */
export async function enviarBienvenidaWhatsappDeveloper(
  supabase: SupabaseClient,
  params: { destinoE164: string; nombre: string }
): Promise<ResultadoBienvenidaWhatsapp> {
  const destino = params.destinoE164.replace(/[^\d]/g, ""); // Meta espera dígitos, sin "+"
  if (!destino) return { enviado: false, motivo: "destino_invalido" };

  const num = await resolverNumeroDulabs(supabase);
  if (!num.ok) return { enviado: false, motivo: num.motivo };

  let token: string | null = null;
  try {
    token = resolverTokenMeta(num.cliente);
  } catch (err) {
    return { enviado: false, motivo: "token_no_resoluble", detalle: err instanceof Error ? err.message : String(err) };
  }
  if (!token) return { enviado: false, motivo: "sin_token_meta" };

  const insp = await inspeccionarPlantilla(token);
  if ("error" in insp) return { enviado: false, motivo: "plantilla_no_consultable", detalle: insp.error };
  if (insp.status !== "APPROVED") return { enviado: false, motivo: "plantilla_no_aprobada", detalle: `status=${insp.status}` };
  if (insp.bodyVars > 1) return { enviado: false, motivo: "plantilla_variables_inesperadas", detalle: `body_vars=${insp.bodyVars}` };

  // Solo se pasa el nombre si la plantilla realmente tiene una variable.
  const parametrosPosicionales = insp.bodyVars === 1 ? [params.nombre || "cliente"] : undefined;

  try {
    const { wamid } = await enviarPlantilla({
      phoneNumberId: DULABS_PHONE_NUMBER_ID,
      token,
      para: destino,
      nombrePlantilla: NOMBRE_PLANTILLA,
      idioma: IDIOMA,
      parametrosPosicionales,
    });
    return { enviado: true, wamid };
  } catch (err) {
    return { enviado: false, motivo: "error_envio", detalle: err instanceof Error ? err.message : String(err) };
  }
}
