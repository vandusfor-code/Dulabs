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
export const MENSAJE_BIENVENIDA_2 = "¿Qué deseas hacer?\n\n1. Quiero una cita\n2. Quiero hacer una consulta\n3. Hablar con una persona";
export const MENSAJE_MENU_INICIO_INVALIDO =
  "No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n1. Quiero una cita\n2. Quiero hacer una consulta\n3. Hablar con una persona";
export const MENSAJE_GEMINI_BIENVENIDA = "Claro 💗 Cuéntame, ¿qué te gustaría saber?";
export const MENSAJE_TRANSICION_AGENDA = "Perfecto 💗 Vamos a agendar tu cita.";
export const MENSAJE_ERROR_GEMINI = "Disculpa, tuve un problema entendiendo tu mensaje 💗 ¿Puedes reformularlo?";

// --- Fase 1 (atención humana, autorizado) -------------------------------

/** Único número real al que se notifica -- ya normalizado con indicativo de país (auditado: soloDigitos del worker NO agrega el 57, ver worker/src/whatsapp-qr/socket-baileys.ts). */
export const NUMERO_JESSICA = "573227298600";

export const MENSAJE_ATENCION_HUMANA_CLIENTE =
  "Entiendo que quieres hablar directamente con Jessica. 💗\nYa le notifiqué que deseas comunicarte con ella. En un momento te responderá directamente.";

/** Único motivo real disponible en esta fase -- deliberadamente NO se llama a Gemini para resumir un motivo (sección PRIORIZAMOS CONFIABILIDAD del pedido). */
export const MOTIVO_ATENCION_HUMANA_DEFECTO = "Solicita atención directa.";

export function construirMensajeNotificacionJessica(params: { nombre: string | null; telefono: string; motivo?: string }): string {
  const nombre = params.nombre?.trim() || "Cliente Nuevo";
  const motivo = params.motivo?.trim() || MOTIVO_ATENCION_HUMANA_DEFECTO;
  return `AMORE – Cliente requiere atención\n\nCliente: ${nombre}\nWhatsApp: ${params.telefono}\nMotivo: ${motivo}\n\nLa clienta solicita atención directa. Por favor, revisa la conversación.`;
}

// --- Fase 2 (registro de clientes nuevos, autorizado) -------------------

export const MENSAJE_REGISTRO_NOMBRE = "Antes de continuar, necesito registrarte en AMORE. 💗\n\n¿Me regalas tu nombre?";
export const MENSAJE_REGISTRO_DIA = "Para completar tu registro, ¿me regalas el día de tu cumpleaños?";
export const MENSAJE_REGISTRO_MES =
  "¿Y en qué mes cumples años?\n\nTranquila 💗 Esta información la usamos para conocer tus fechas especiales y brindarte una atención más personalizada.";
export const MENSAJE_DIA_INVALIDO = "Necesito un día válido entre 1 y 31. 💗 ¿Cuál es el día de tu cumpleaños?";
export const MENSAJE_MES_INVALIDO = "Necesito un mes válido entre 1 y 12. 💗 ¿En qué mes cumples años?";
/** Mismo criterio de texto que RESPUESTA_CANCELACION de Agenda V2 (lib/agenda-v2/controlador.ts) -- nunca una segunda redacción divergente para el mismo concepto ("cancelaste, escríbeme cuando quieras retomarlo"). */
export const MENSAJE_REGISTRO_CANCELADO = "Listo, cancelé el registro 💗 Escríbeme cuando quieras retomarlo.";

/**
 * Detector determinístico de solicitud EXPLÍCITA de hablar con una persona
 * -- mismo criterio EXACTO que FRASES_TRIGGER_AGENDA_DETERMINISTA/
 * detectarIntencionGestionCitas (lib/agenda-v2/entrada.ts): normalizeText +
 * coincidencia "contains" contra una lista FIJA y controlada, nunca IA.
 * Deliberadamente acotado a las frases reales dadas -- "¿Jessica hace
 * maquillaje?"/"¿Qué profesionales tienen?" NUNCA deben calzar acá (no
 * expresan intención de hablar con alguien, solo mencionan a Jessica o
 * preguntan por el equipo).
 *
 * Corrección post-deploy (auditoría real, autorizado) -- las frases largas
 * originales ("quiero hablar con jessica", etc.) exigían que el MENSAJE del
 * cliente las contuviera completas; un mensaje real corto y sin verbo
 * ("Hablar con Jessica") es MÁS CORTO que esas frases y por lo tanto nunca
 * las contiene como subcadena, así que el detector nunca se activaba (caso
 * real observado en producción con el teléfono de pruebas autorizado). Se
 * agregan los núcleos cortos reales sin verbo inicial -- el mecanismo de
 * coincidencia ("contains", nunca IA) NO cambia, y las frases largas
 * existentes siguen coincidiendo igual porque cada núcleo corto es también
 * subcadena de ellas.
 */
const FRASES_ATENCION_HUMANA_DETERMINISTA = [
  "quiero hablar con jessica",
  "me gustaria hablar con jessica",
  "necesito hablar con jessica",
  "pasame con jessica",
  "quiero hablar con una persona",
  "necesito hablar con alguien",
  "quiero hablar con alguien de amore",
  "prefiero hablar con una persona",
  "necesito que jessica me atienda",
  "quiero hablar directamente con alguien",
  "quiero hablar directamente con jessica",
  "hablar con jessica",
  "hablar con una persona",
  "hablar con alguien",
  "hablar con alguien de amore",
];

export function detectarSolicitudAtencionHumana(mensaje: string): boolean {
  const textoNormalizado = normalizeText(mensaje);
  return FRASES_ATENCION_HUMANA_DETERMINISTA.some((f) => textoNormalizado.includes(normalizeText(f)));
}

// --- Fase 3b (interés general en productos, autorizado) -------------------

/** Único link real de la tienda -- nunca inventado, coincide con app/amore/tienda/page.tsx. */
export const URL_TIENDA_AMORE = "https://www.dulabs.co/amore/tienda";

export const MENSAJE_INTERES_PRODUCTOS =
  `¡Claro que sí! 💗 Aquí puedes ver todos nuestros productos:\n\n${URL_TIENDA_AMORE}\n\nCuando encuentres el que te guste, toca "Comprar" y seguimos por aquí mismo. 🛍️`;

/**
 * Detector determinístico (mismo criterio "contains" de siempre, nunca IA)
 * para una pregunta GENERAL sobre productos ("¿tienen productos de
 * belleza?"), distinto de detectarIntencionCompraLibre (que exige un verbo
 * de compra explícito + el nombre de un producto real). Este es más amplio a
 * propósito -- el peor caso posible es enviar el link de la tienda cuando no
 * hacía falta, nunca inicia el flujo de compra ni escribe ningún estado
 * nuevo (a diferencia de interceptarCompraProductoAmore).
 */
const FRASES_INTERES_PRODUCTOS_GENERAL = [
  "productos de belleza",
  "tienen productos",
  "venden productos",
  "que productos tienen",
  "que productos venden",
  "quiero ver los productos",
  "quiero ver productos",
  "catalogo de productos",
  "tienda de productos",
  "productos amore",
];

export function detectarInteresGeneralProductos(mensaje: string): boolean {
  const textoNormalizado = normalizeText(mensaje);
  return FRASES_INTERES_PRODUCTOS_GENERAL.some((f) => textoNormalizado.includes(normalizeText(f)));
}

// --- Fase 3 (compra de producto, autorizado) -----------------------------

export const MENSAJE_COMPRA_MENU = "¿Qué deseas hacer?\n\n1. Pagar producto\n2. Hablar con un asesor";
export const MENSAJE_COMPRA_OPCION_INVALIDA =
  "No reconocí esa opción 💗 Por favor responde con el número:\n\n1. Pagar producto\n2. Hablar con un asesor";
export const MENSAJE_COMPRA_ASESOR_CLIENTE = "Con gusto 💗 Ya te transfiero el chat para que una asesora pueda atenderte personalmente.";
export const MENSAJE_COMPRA_PAGO_REGISTRADO_CLIENTE =
  "Perfecto 💗 Ya pasé la información a nuestro equipo. Una asesora se comunicará contigo pronto para continuar con tu compra.";
export const MENSAJE_COMPRA_RECORDATORIO_PAGO =
  'Cuando realices el pago, escríbeme "Ya pagué" 💗\n\nSi prefieres, también puedes escribir "hablar con Jessica" para que te atienda una asesora.';

export function construirMensajeCompraSaludo(nombreProducto: string): string {
  return `Claro que sí 💗 Veo que estás interesada en ${nombreProducto}.`;
}

// Método de pago real de AMORE para productos (autorizado) -- única llave
// definida por el negocio, nunca inventar otra (Nequi/Daviplata/banco/link).
// Punto de integración único: si el negocio define OTRO método más adelante,
// se reemplaza únicamente este texto -- el resto del flujo (modo
// compra_esperando_pago, detección de "Ya pagué") no necesita cambiar.
export const LLAVE_PAGO_PRODUCTOS_AMORE = "@urrego3948";

export const MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE =
  `💗 Puedes realizar el pago a la siguiente llave:\n\n${LLAVE_PAGO_PRODUCTOS_AMORE}\n\nCuando realices el pago, escríbeme "Ya pagué" 💗`;

export function construirMensajeJessicaCompraAsesor(nombreProducto: string): string {
  return `Una cliente requiere tu atención. Está interesada en un producto.\n\nProducto: ${nombreProducto}\n\nRevisa el chat para continuar la atención.`;
}

export function construirMensajeJessicaPagoReportado(nombreProducto: string): string {
  return `Una cliente reporta pago de producto.\n\nProducto: ${nombreProducto}\n\nRevisa el chat para validar el pago y continuar con la compra.`;
}

/** Texto EXACTO que arma el botón "Comprar" de la tienda (ver lib/amore-tienda.ts) para el link wa.me -- debe coincidir con el prefijo reconocido acá carácter a carácter (salvo mayúsculas/acentos) para poder detectar con certeza que el mensaje viene de la tienda. */
export const PREFIJO_MENSAJE_TIENDA = "Hola, estoy interesada en este producto:";

/**
 * Extrae el nombre del producto de un mensaje generado por el botón
 * "Comprar" de la tienda -- coincidencia por PREFIJO (normalizado), nunca
 * por "contains" de palabras sueltas ("producto"/"comprar"), para que la
 * entrada real de la tienda tenga prioridad inequívoca sobre cualquier
 * conversación genérica (sección PRIORIDAD DE COMPRA del pedido, aprobada).
 * Devuelve `null` si el mensaje no viene de ahí.
 */
export function extraerProductoDeLinkTienda(mensaje: string): string | null {
  const normalizado = normalizeText(mensaje);
  const prefijoNormalizado = normalizeText(PREFIJO_MENSAJE_TIENDA);
  if (!normalizado.startsWith(prefijoNormalizado)) return null;
  // Se recorta del texto ORIGINAL (no normalizado) para conservar
  // mayúsculas/acentos reales del nombre del producto al mostrarlo de
  // vuelta a la clienta ("Veo que estás interesada en ...").
  const indice = mensaje.toLowerCase().indexOf("producto:");
  if (indice === -1) return null;
  const nombre = mensaje.slice(indice + "producto:".length).trim();
  return nombre.length > 0 ? nombre : null;
}

/**
 * Intención de compra en texto LIBRE (fuera del link de la tienda) -- exige
 * un verbo de compra explícito Y que el mensaje mencione el nombre de un
 * producto ACTIVO real del tenant. Aprobado explícitamente: "no quiero que
 * palabras genéricas como 'producto', 'comprar' o 'pago' por sí solas
 * interrumpan" una sesión de Agenda V2 -- por eso NUNCA basta con el verbo
 * solo, siempre debe calzar además con un producto real.
 */
const FRASES_COMPRA_EXPLICITA = ["quiero comprar", "deseo comprar", "me interesa comprar", "quiero pagar por"];

export function detectarIntencionCompraLibre(mensaje: string, nombresProductosActivos: string[]): string | null {
  const normalizado = normalizeText(mensaje);
  const tieneVerboCompra = FRASES_COMPRA_EXPLICITA.some((f) => normalizado.includes(normalizeText(f)));
  if (!tieneVerboCompra) return null;
  const producto = nombresProductosActivos.find((nombre) => normalizado.includes(normalizeText(nombre)));
  return producto ?? null;
}

/**
 * Confirmación de "Ya pagué" -- el LLAMADOR (interceptarCompraProductoAmore)
 * es responsable de exigir que la conversación ya esté en modo
 * compra_esperando_pago antes de invocar esto; esta función solo reconoce el
 * texto. Aprobado explícitamente: "NO convertir 'Ya pagué' en un trigger
 * global" -- por diseño, este detector NUNCA se evalúa fuera de ese estado.
 */
const FRASES_PAGO_CONFIRMADO = ["ya pague", "ya hice el pago", "pago realizado", "ya realice el pago", "ya pague el producto", "listo ya pague"];

export function detectarConfirmacionPago(mensaje: string): boolean {
  const normalizado = normalizeText(mensaje);
  return FRASES_PAGO_CONFIRMADO.some((f) => normalizado.includes(normalizeText(f)));
}

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
- Nunca actives TRIGGER_AGENDA solo porque la palabra "cita" aparece en el mensaje -- una pregunta sobre citas (precio, horarios, disponibilidad general) sigue siendo CONSULTA.

[REGLA CRÍTICA DE INTENCIÓN]
TRIGGER_AGENDA significa que el usuario desea iniciar EXPLÍCITAMENTE un proceso de reserva/agendamiento. Tienes acceso al historial reciente de esta conversación (turnos anteriores) --úsalo siempre que el mensaje actual sea corto o ambiguo.

No debes inferir TRIGGER_AGENDA solamente porque el usuario:
- diga "sí";
- diga "sí porfa";
- diga "claro";
- diga "dale";
- diga "bueno";
- diga "por favor";
- muestre interés en un servicio.

Un afirmativo corto ("sí", "sí porfa", "claro", "dale", "bueno", "por favor") SOLO puede ser TRIGGER_AGENDA si tu ÚLTIMO mensaje en el historial fue una pregunta explícita cuya intención era confirmar el INICIO de una reserva (ej. "¿Quieres que te ayude a reservar una cita?", "¿Te gustaría agendar?"). Si tu último mensaje preguntaba otra cosa (mostrar opciones, dar información, recomendar un servicio, confirmar una fecha de evento), el mismo afirmativo corto es CONSULTA.

Ejemplo:
ASISTENTE: "¿Quieres que te ayude a reservar una cita?"
USUARIO: "Sí por favor."
→ TRIGGER_AGENDA

Pero:
ASISTENTE: "¿Quieres conocer nuestras opciones de maquillaje?"
USUARIO: "Sí por favor."
→ CONSULTA

También:
ASISTENTE: "¿Quieres que te recomiende una opción para tu graduación?"
USUARIO: "Sí."
→ CONSULTA

Nunca asumas una reserva por el tema general de la conversación (hablar de un evento, una fecha o un servicio no es lo mismo que pedir agendar). Si existe duda real entre CONSULTA y TRIGGER_AGENDA, responde CONSULTA.`;

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
