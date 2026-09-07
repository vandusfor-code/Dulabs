/**
 * AMORE (autorizado, Fase 9) — puente Gemini -> Agenda V2. Gemini ÚNICAMENTE
 * clasifica la intención del mensaje (CONSULTA vs TRIGGER_AGENDA) y redacta
 * una respuesta natural para el caso CONSULTA -- NUNCA crea, modifica ni
 * cancela una cita, NUNCA llama a Nylas ni a crearCitaConNylas (eso sigue
 * siendo exclusivo de Agenda V2, lib/agenda-v2/*).
 *
 * Reutiliza TAL CUAL el boundary Gemini ya existente (FASE B del Flow
 * Engine, lib/flow/gemini/gemini-client.ts) -- misma API key
 * (GEMINI_KEY/resolveGeminiApiKeyFromEnv), mismo mecanismo real de salida
 * forzada vía responseSchema/responseMimeType=application/json. Nunca una
 * segunda integración de Gemini.
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import {
  createGeminiGenerateContentClient,
  resolveGeminiApiKeyFromEnv,
  GEMINI_DEFAULT_MODEL,
} from "@/lib/flow/gemini/gemini-client";
import type { GeminiGenerateContentClient } from "@/lib/flow/gemini/gemini-types";

export const MENSAJE_BIENVENIDA_1 = "¡Hola! 💗 Bienvenido/a a AMORE.\n\nEstoy aquí para ayudarte a encontrar el servicio ideal o reservar tu cita.";
export const MENSAJE_BIENVENIDA_2 = "¿Qué deseas hacer?\n\n1. Quiero una cita\n2. Quiero hacer una consulta";
export const MENSAJE_MENU_INICIO_INVALIDO = "No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n1. Quiero una cita\n2. Quiero hacer una consulta";
export const MENSAJE_GEMINI_BIENVENIDA = "Claro 💗 Cuéntame, ¿qué te gustaría saber?";
export const MENSAJE_TRANSICION_AGENDA = "Perfecto 💗 Vamos a agendar tu cita.";
export const MENSAJE_ERROR_GEMINI = "Disculpa, tuve un problema entendiendo tu mensaje 💗 ¿Puedes reformularlo?";

/**
 * FAST TRACK DETERMINISTA (sección del pedido) -- frases FIJAS e
 * inequívocas, revisadas ANTES de llamar a Gemini (evita latencia y evita
 * que un mensaje obvio quede atrapado esperando una clasificación). Mismo
 * criterio EXACTO que detectarIntencionGestionCitas (lib/agenda-v2/entrada.ts):
 * normalizeText + coincidencia "contains" contra una lista controlada,
 * nunca IA/fuzzy. Deliberadamente NO incluye "cita" sola -- "¿cuánto cuesta
 * una cita?"/"¿atienden citas los sábados?" deben seguir siendo CONSULTA.
 */
const FRASES_TRIGGER_AGENDA_DETERMINISTA = [
  "quiero una cita",
  "quiero agendar",
  "quiero reservar",
  "quiero apartar una cita",
  "me puedes agendar",
  "quiero reservarlo",
  "quiero agendarlo",
];

export function detectarTriggerAgendaDeterminista(mensaje: string): boolean {
  const textoNormalizado = normalizeText(mensaje);
  return FRASES_TRIGGER_AGENDA_DETERMINISTA.some((f) => textoNormalizado.includes(normalizeText(f)));
}

export type IntentGemini = "CONSULTA" | "TRIGGER_AGENDA";

export interface ResultadoClasificacionGemini {
  intent: IntentGemini;
  /** Ignorado por el caller cuando intent=TRIGGER_AGENDA (sección STRUCTURED OUTPUT del pedido). */
  replyText: string;
  detectedServiceMention: string | null;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["CONSULTA", "TRIGGER_AGENDA"] },
    reply_text: { type: "string" },
    detected_service_mention: { type: "string", nullable: true },
  },
  required: ["intent", "reply_text"],
};

const SYSTEM_INSTRUCTION = `Eres la asistente virtual de AMORE, un salón de belleza/estética. Tu ÚNICO trabajo en este turno es CLASIFICAR la intención del mensaje del cliente y, si aplica, redactar una respuesta natural y cálida a su duda.

Debes responder EXCLUSIVAMENTE en el JSON pedido, con "intent" siendo una de estas dos categorías:

- CONSULTA: el cliente busca información (precios, servicios, duración, recomendaciones, horarios generales, información del salón) y TODAVÍA NO decidió iniciar una reserva. Ejemplos: "¿Cuánto cuesta?", "¿Qué servicios tienen?", "¿Qué me recomiendas?", "¿Cuánto dura?", "¿Atienden los domingos?", "¿Qué horarios manejan?", "¿Cuánto cuesta una cita?", "¿Qué horarios tienen para citas?", "¿Atienden citas los sábados?".
- TRIGGER_AGENDA: el cliente expresa CLARAMENTE que quiere iniciar el proceso de reserva. Ejemplos: "Quiero una cita.", "Quiero agendar.", "Me gustaría reservar.", "Me interesa, quiero agendarlo.", "Sí, quiero reservar.", "Quiero hacerlo el sábado.", "Me puedes separar un espacio." También aplica si el cliente responde afirmativamente a una pregunta tuya sobre si quiere agendar.

Reglas estrictas:
- NUNCA inventes que ya creaste, modificaste o cancelaste una cita -- tú NO tienes esa capacidad, solo clasificas. La reserva real la hace otro sistema después de tu clasificación.
- Cuando intent=CONSULTA, "reply_text" debe ser una respuesta natural, cálida y breve a la duda del cliente (información general del salón; si no conoces un dato exacto como un precio, sé honesta y sugiere que lo puede confirmar al agendar, nunca inventes una cifra).
- Cuando intent=TRIGGER_AGENDA, igual completa "reply_text" con cualquier texto breve (será ignorado por el sistema).
- "detected_service_mention": si el cliente mencionó un servicio concreto (ej. "sombreado", "manicure"), pon ese texto tal cual; si no mencionó ninguno, usa null.
- Nunca actives TRIGGER_AGENDA solo porque la palabra "cita" aparece en el mensaje -- una pregunta sobre citas (precio, horarios, disponibilidad general) sigue siendo CONSULTA.`;

export interface DepsClasificarGemini {
  geminiClient?: GeminiGenerateContentClient;
  resolveApiKey?: typeof resolveGeminiApiKeyFromEnv;
}

/**
 * Clasifica UN mensaje del cliente (más el historial reciente de esta
 * conversación, opcional) entre CONSULTA/TRIGGER_AGENDA. Nunca lanza una
 * excepción "de negocio": si Gemini falla o responde algo fuera del schema,
 * se resuelve como CONSULTA con un mensaje de error genérico (fail-safe:
 * nunca se arriesga a disparar Agenda V2 por un error técnico ajeno a la
 * clienta).
 */
export async function clasificarMensajeConGemini(
  params: { mensaje: string; historial?: Array<{ role: "user" | "model"; text: string }> },
  deps: DepsClasificarGemini = {},
): Promise<ResultadoClasificacionGemini> {
  const resolveApiKey = deps.resolveApiKey ?? resolveGeminiApiKeyFromEnv;
  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error("[amore-entrada] sin GEMINI_KEY configurada -- se responde CONSULTA con mensaje de error genérico");
    return { intent: "CONSULTA", replyText: MENSAJE_ERROR_GEMINI, detectedServiceMention: null };
  }
  const client = deps.geminiClient ?? createGeminiGenerateContentClient(apiKey);

  let resultado;
  try {
    resultado = await client.generateContent({
      model: GEMINI_DEFAULT_MODEL,
      systemInstruction: SYSTEM_INSTRUCTION,
      contents: [...(params.historial ?? []), { role: "user", text: params.mensaje }],
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 500,
      temperature: 0.4,
    });
  } catch (err) {
    console.error("[amore-entrada] error técnico llamando a Gemini -- se responde CONSULTA con mensaje de error genérico:", err instanceof Error ? err.message : "error desconocido");
    return { intent: "CONSULTA", replyText: MENSAJE_ERROR_GEMINI, detectedServiceMention: null };
  }

  const parseado = parsearSalidaGemini(resultado.text);
  if (!parseado) {
    console.error("[amore-entrada] salida de Gemini fuera del schema esperado -- se responde CONSULTA con mensaje de error genérico");
    return { intent: "CONSULTA", replyText: MENSAJE_ERROR_GEMINI, detectedServiceMention: null };
  }
  return parseado;
}

function parsearSalidaGemini(texto: string | null): ResultadoClasificacionGemini | null {
  if (!texto) return null;
  let data: unknown;
  try {
    data = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (obj.intent !== "CONSULTA" && obj.intent !== "TRIGGER_AGENDA") return null;
  if (typeof obj.reply_text !== "string") return null;
  const mencion = obj.detected_service_mention;
  if (mencion !== null && mencion !== undefined && typeof mencion !== "string") return null;
  return { intent: obj.intent, replyText: obj.reply_text, detectedServiceMention: typeof mencion === "string" ? mencion : null };
}
