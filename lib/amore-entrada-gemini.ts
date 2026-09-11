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
// Glosario de intenciones AMORE (autorizado) -- ampliación real de la
// sección HABLAR_CON_ASESOR: mismo mecanismo "contains" de siempre, solo
// más frases reales cubiertas. Se excluyen a propósito frases que solo
// MENCIONAN a una profesional sin pedir hablar con ella ("¿Jessica hace
// maquillaje?"), igual que ya documentaba este archivo.
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
  "quiero atencion humana",
  "necesito atencion humana",
  "quiero atencion personalizada",
  "quiero que me atienda una persona",
  "quiero que me atienda alguien",
  "necesito una asesora",
  "necesito un asesor",
  "quiero una asesora",
  "quiero un asesor",
  "puedo hablar con alguien",
  "puedo hablar con una persona",
  "puedo hablar con una asesora",
  "comuniquenme con alguien",
  "pasame con alguien",
  "pasame con una persona",
  "pasame con una asesora",
  "pasame con un asesor",
  "quiero que me pasen con alguien",
  "quiero que me comuniquen con alguien",
  "no quiero hablar con el bot",
  "no quiero hablar con un robot",
  "no quiero hablar con una maquina",
  "quiero una persona no un bot",
  "quiero hablar con alguien de verdad",
  "necesito una persona real",
  "pasame con alguien real",
  "quiero hablar con la encargada",
  "quiero hablar con la responsable",
  "quiero hablar con la administradora",
  "quiero hablar con recepcion",
  "quiero hablar con atencion al cliente",
  "quiero servicio al cliente",
  "necesito servicio al cliente",
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
// Glosario de intenciones AMORE (autorizado) -- ampliación real de la
// sección RESERVAR_CITA: mismo mecanismo "contains" de siempre. Se excluyen
// a propósito las frases de "disponibilidad" ("tienen espacio mañana?",
// "hay dispo?") -- el propio glosario reconoce que esas dependen de
// contexto (pueden ser una pregunta puramente informativa), así que se
// dejan para que Gemini las razone semánticamente (ver SYSTEM_INSTRUCTION
// más abajo), nunca un match literal ciego.
const FRASES_TRIGGER_AGENDA_DETERMINISTA = [
  "quiero una cita",
  "quiero agendar",
  "quiero reservar",
  "quiero apartar una cita",
  "me puedes agendar",
  "quiero reservarlo",
  "quiero agendarlo",
  "quiero sacar una cita",
  "quiero sacar cita",
  "quiero pedir una cita",
  "quiero pedir cita",
  "quiero programar una cita",
  "quiero programar cita",
  "quiero separar una cita",
  "quiero separar cita",
  "quiero apartar cita",
  "necesito una cita",
  "necesito sacar una cita",
  "necesito agendar una cita",
  "necesito reservar una cita",
  "necesito pedir una cita",
  "necesito programar una cita",
  "necesito separar una cita",
  "necesito apartar una cita",
  "me gustaria agendar una cita",
  "me gustaria reservar una cita",
  "me gustaria sacar una cita",
  "me gustaria tener una cita",
  "quisiera agendar una cita",
  "quisiera reservar una cita",
  "quisiera sacar una cita",
  "quisiera tener una cita",
  "me ayudas a sacar una cita",
  "me ayudas a agendar",
  "me ayudas a reservar",
  "me colaboras con una cita",
  "me colaboras agendando",
  "me pueden ayudar a agendar",
  "me pueden sacar una cita",
  "me pueden agendar",
  "me pueden reservar una cita",
  "qiero una cita",
  "kiero una cita",
  "qiero agendar",
  "kiero agendar",
  "quiero agendar una sita",
  "quiero reservar una sita",
  "quiero sacar una sita",
];

export function detectarTriggerAgendaDeterminista(mensaje: string): boolean {
  const textoNormalizado = normalizeText(mensaje);
  return FRASES_TRIGGER_AGENDA_DETERMINISTA.some((f) => textoNormalizado.includes(normalizeText(f)));
}

// --- NUEVA FASE (autorizado, DESPEDIDA / NO_ENTENDI_REPETIR) --------------
// Glosario AMORE (AMORE_GLOSARIO_INTENCIONES.md secciones 19/20 +
// AMORE_REGLAS_TECNICAS_INTENCIONES.md secciones 23/24), implementadas de
// forma aislada y de bajo riesgo (pedido explícito): solo responden un
// texto fijo y cordial, NUNCA cambian el modo de la conversación, NUNCA
// tocan una sesión de Agenda V2 ni llaman a Gemini (ver el punto de
// llamada en lib/amore-entrada-router.ts).
//
// A diferencia de los detectores "contains" ya existentes arriba (atención
// humana, fast-track de agenda), acá se exige coincidencia EXACTA del
// mensaje completo (tras quitar signos ¿?¡! sobrantes) -- varias de estas
// frases son palabras sueltas muy comunes ("gracias", "que", "como") que SÍ
// podrían aparecer dentro de un mensaje con otra intención real ("gracias,
// ¿cuánto cuesta el manicure?"); exigir el mensaje COMPLETO evita ese falso
// positivo.

export const MENSAJE_DESPEDIDA = "¡Con mucho gusto! 💗 Cualquier cosa que necesites, aquí estoy. ¡Que tengas un lindo día!";
export const MENSAJE_NO_ENTENDI_REPETIR =
  "Claro 💗 Te explico de nuevo, más sencillo: puedo darte información de nuestros servicios, precios y horarios, o ayudarte a agendar tu cita. ¿Qué te gustaría hacer?";

function normalizarParaCoincidenciaExacta(mensaje: string): string {
  return normalizeText(mensaje)
    .replace(/^[¿¡]+/, "")
    .replace(/[?!.,]+$/, "")
    .trim();
}

const FRASES_DESPEDIDA = [
  "gracias",
  "muchas gracias",
  "mil gracias",
  "te agradezco",
  "les agradezco",
  "gracias por la informacion",
  "gracias por todo",
  "eso era todo",
  "eso es todo",
  "listo gracias",
  "perfecto gracias",
  "bueno gracias",
  "ok gracias",
  "vale gracias",
  "hasta luego",
  "hasta pronto",
  "chao",
  "chau",
  "nos vemos",
  "que estes bien",
  "que esten bien",
  "feliz dia",
  "feliz tarde",
  "feliz noche",
  "bendiciones",
  "dios les bendiga",
  "muchas gracias por la atencion",
];

export function detectarDespedida(mensaje: string): boolean {
  const normalizado = normalizarParaCoincidenciaExacta(mensaje);
  if (!normalizado) return false;
  return FRASES_DESPEDIDA.some((f) => normalizado === normalizeText(f));
}

const FRASES_NO_ENTENDI_REPETIR = [
  "no entendi",
  "no entiendo",
  "no entendi nada",
  "no entiendo nada",
  "que",
  "como",
  "como asi",
  "que quieres decir",
  "que significa",
  "explicame",
  "me puedes explicar",
  "me puede explicar",
  "no comprendi",
  "no me quedo claro",
  "no se",
  "repiteme",
  "me lo repites",
  "puedes repetir",
  "puede repetir",
  "otra vez",
  "de nuevo",
  "me puedes explicar mejor",
  "explicame mejor",
  "no te entendi",
  "no le entendi",
];

export function detectarNoEntendiRepetir(mensaje: string): boolean {
  const normalizado = normalizarParaCoincidenciaExacta(mensaje);
  if (!normalizado) return false;
  return FRASES_NO_ENTENDI_REPETIR.some((f) => normalizado === normalizeText(f));
}

// NUEVA FASE (autorizado, reconocimiento semántico/contextual de
// CANCELAR_CITA/REPROGRAMAR_CITA) -- cierra el gap de las variantes
// AMBIGUAS/indirectas del glosario ("me salió una vuelta y no voy a poder
// ir", "no puedo ir mañana, ¿la pasamos para el viernes?") que el detector
// determinista de frases fijas (detectarIntencionGestionCitas,
// lib/agenda-v2/entrada.ts) NUNCA puede resolver por diseño -- un match
// "contains" no puede distinguir "no puedo ir" (cancelar) de "no puedo ir,
// ¿la pasamos para el viernes?" (reprogramar) sin razonar el mensaje
// completo. Gemini SOLO clasifica -- nunca cancela ni reprograma nada; el
// backend (lib/agenda-v2/router.ts::iniciarGestionCitasAgendaV2) reutiliza
// la MISMA gestión de citas de FASE 8 (buscar cita real -> mostrar -> pedir
// confirmación -> ejecutar solo tras confirmar). El detector determinista
// sigue evaluándose PRIMERO (antes de llegar a Gemini, ver
// lib/agenda-v2/router.ts::procesarMensajeConAgendaV2) -- estas dos
// categorías nuevas solo se alcanzan para frases que ese detector no cubrió.
export type IntentGemini = "CONSULTA" | "TRIGGER_AGENDA" | "CANCELAR_CITA" | "REPROGRAMAR_CITA";

export interface ResultadoClasificacionGemini {
  intent: IntentGemini;
  /** Ignorado por el caller cuando intent=TRIGGER_AGENDA (sección STRUCTURED OUTPUT del pedido). */
  replyText: string;
  detectedServiceMention: string | null;
  // NUEVA FASE (autorizado, extracción de datos para RESERVAR_CITA) --
  // MISMO criterio EXACTO que detectedServiceMention: Gemini SOLO extrae el
  // texto crudo tal cual lo dijo la clienta ("Mary", "el viernes", "a las
  // 4") -- NUNCA resuelve un id real, NUNCA calcula una fecha/hora final.
  // Quien de verdad valida/resuelve estos textos contra datos reales
  // (catálogo, elegibilidad, disponibilidad real con Nylas) es
  // iniciarNuevaSesionAgendaV2 (lib/agenda-v2/router.ts) -- la IA nunca crea
  // ni asume una cita.
  detectedProfessionalMention: string | null;
  detectedDateMention: string | null;
  detectedTimeMention: string | null;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["CONSULTA", "TRIGGER_AGENDA", "CANCELAR_CITA", "REPROGRAMAR_CITA"] },
    reply_text: { type: "string" },
    detected_service_mention: { type: "string", nullable: true },
    detected_professional_mention: { type: "string", nullable: true },
    detected_date_mention: { type: "string", nullable: true },
    detected_time_mention: { type: "string", nullable: true },
  },
  required: ["intent", "reply_text"],
};

const SYSTEM_INSTRUCTION = `Eres la asistente virtual de AMORE, un salón de belleza/estética. Tu ÚNICO trabajo en este turno es CLASIFICAR la intención del mensaje del cliente y, si aplica, redactar una respuesta natural y cálida a su duda.

Debes responder EXCLUSIVAMENTE en el JSON pedido, con "intent" siendo una de estas cuatro categorías:

- CONSULTA: el cliente busca información (precios, servicios, duración, recomendaciones, horarios generales, información del salón) y TODAVÍA NO decidió iniciar una reserva. Ejemplos: "¿Cuánto cuesta?", "¿Qué servicios tienen?", "¿Qué me recomiendas?", "¿Cuánto dura?", "¿Atienden los domingos?", "¿Qué horarios manejan?", "¿Cuánto cuesta una cita?", "¿Qué horarios tienen para citas?", "¿Atienden citas los sábados?".
- TRIGGER_AGENDA: el cliente expresa CLARAMENTE que quiere iniciar el proceso de reserva de una cita NUEVA. Ejemplos: "Quiero una cita.", "Quiero agendar.", "Me gustaría reservar.", "Me interesa, quiero agendarlo.", "Sí, quiero reservar.", "Quiero hacerlo el sábado.", "Me puedes separar un espacio.", "¿Tienen disponibilidad para mañana?", "¿Me pueden atender el viernes?", "¿Será que me hacen un espacio?", "¿Tendrán un campito para mí?", "¿Me regalan un espacio esta semana?". También aplica si el cliente responde afirmativamente a una pregunta tuya sobre si quiere agendar.
  - Cuidado: una pregunta sobre disponibilidad puede ser puramente informativa según el contexto ("¿manejan turnos los domingos, en general?" sin mencionar una fecha propia sigue siendo CONSULTA_HORARIO). Si el cliente pregunta por SU propia disponibilidad para ir ("¿tienen espacio para mí mañana?", "¿me pueden atender el viernes?"), es TRIGGER_AGENDA; si pregunta por el horario general del negocio sin intención personal de ir ("¿a qué hora abren?", "¿qué días trabajan?"), sigue siendo CONSULTA.
- CANCELAR_CITA: el cliente habla de una cita que YA TIENE (nunca una nueva) y expresa que no va a poder asistir, SIN proponer ni aceptar una fecha/hora alternativa. Ejemplos: "ya no quiero la cita", "me salió una vuelta y no voy a poder ir", "vea que no alcanzo a llegar", "se me presentó un compromiso", "no puedo ir" (sola, sin mencionar otro día ni querer cambiarla).
- REPROGRAMAR_CITA: el cliente habla de una cita que YA TIENE y expresa que no puede asistir COMO ESTABA, pero SÍ quiere ir en otro momento -- propone, pide o acepta otra fecha/hora, o deja claro que prefiere cambiarla en vez de cancelarla. Ejemplos: "no puedo ir mañana, ¿la pasamos para el viernes?", "no puedo ese día, ¿me la pueden cambiar?", "esa hora no me sirve, ¿puedo ir más tarde?", "me salió un compromiso pero quiero ir otro día", "no puedo ir, pero quiero otra fecha".

[REGLA DE AMBIGÜEDAD CANCELAR vs REPROGRAMAR -- MUY IMPORTANTE]
"No puedo ir" (o equivalentes) por sí solo, SIN ninguna mención de otro día/hora ni de querer cambiar/mover la cita, es CANCELAR_CITA. Si el mismo mensaje además pide, sugiere o acepta otra fecha/hora, es REPROGRAMAR_CITA -- nunca canceles cuando el cliente en realidad quiere mantener la cita en otro momento. Si el mensaje es TAN corto o ambiguo que de verdad no puedes decidir con confianza entre cancelar/reprogramar/otra cosa (y NO tienes contexto previo en el historial que lo aclare), NUNCA elijas una al azar: responde intent=CONSULTA con un "reply_text" breve y natural preguntando cuál prefiere, ej.: "Claro 💗 ¿Quieres cancelar tu cita o prefieres cambiarla para otro día?". Pero si el contexto ya deja clara la intención, no hagas una pregunta innecesaria.

Reglas estrictas:
- NUNCA inventes que ya creaste, modificaste o cancelaste una cita -- tú NO tienes esa capacidad, solo clasificas. La cancelación/reprogramación/reserva real las hace otro sistema después de tu clasificación, y SIEMPRE le pedirá confirmación al cliente antes de ejecutar nada.
- Cuando intent=CONSULTA, "reply_text" debe ser una respuesta natural, cálida y breve a la duda del cliente (información general del salón; si no conoces un dato exacto como un precio, sé honesta y sugiere que lo puede confirmar al agendar, nunca inventes una cifra).
- Cuando intent=TRIGGER_AGENDA/CANCELAR_CITA/REPROGRAMAR_CITA, igual completa "reply_text" con cualquier texto breve (será ignorado por el sistema).
- "detected_service_mention": si el cliente mencionó un servicio concreto (ej. "sombreado", "manicure"), pon ese texto tal cual; si no mencionó ninguno, usa null.
- Nunca actives TRIGGER_AGENDA solo porque la palabra "cita" aparece en el mensaje -- una pregunta sobre citas (precio, horarios, disponibilidad general) sigue siendo CONSULTA.
- Nunca confundas CANCELAR_CITA/REPROGRAMAR_CITA con TRIGGER_AGENDA -- son sobre una cita que el cliente YA TIENE reservada, nunca sobre agendar una cita nueva.

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

Nunca asumas una reserva por el tema general de la conversación (hablar de un evento, una fecha o un servicio no es lo mismo que pedir agendar). Si existe duda real entre CONSULTA y TRIGGER_AGENDA, responde CONSULTA.

Además de "intent" y "reply_text", extrae estos 4 campos SOLO cuando intent=TRIGGER_AGENDA y la clienta mencionó ese dato en su mensaje (o en el historial reciente, si sigue siendo relevante para esta reserva). Extrae ÚNICAMENTE el texto TAL CUAL lo dijo la clienta -- NUNCA calcules una fecha exacta, NUNCA conviertas una hora a formato 24h, NUNCA valides si el servicio/profesional existe de verdad: eso lo hace otro sistema después. Si no mencionó un dato, ese campo debe ser null (nunca inventar ni asumir un valor por defecto).

- "detected_service_mention": el servicio que quiere (ej. "las uñas", "sombreado de cejas", "un manicure"). Ya lo hacías, sin cambios.
- "detected_professional_mention": el nombre de la profesional, SOLO si la clienta pidió específicamente a alguien (ej. "con Mary", "que me atienda Jessica"). null si no mencionó a nadie en particular.
- "detected_date_mention": la fecha tal cual la dijo (ej. "mañana", "el viernes", "el 15 de diciembre"). null si no mencionó ninguna fecha.
- "detected_time_mention": la hora tal cual la dijo (ej. "a las 4", "4pm", "en la tarde"). null si no mencionó ninguna hora.

Ejemplo:
"Quiero hacerme las uñas con Mary el viernes a las 4"
→ intent=TRIGGER_AGENDA, detected_service_mention="las uñas", detected_professional_mention="Mary", detected_date_mention="el viernes", detected_time_mention="a las 4"

Ejemplo (dato parcial, el resto queda null):
"Quiero una cita con Mary el viernes"
→ detected_professional_mention="Mary", detected_date_mention="el viernes", detected_service_mention=null, detected_time_mention=null`;

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
    return {
      intent: "CONSULTA",
      replyText: MENSAJE_ERROR_GEMINI,
      detectedServiceMention: null,
      detectedProfessionalMention: null,
      detectedDateMention: null,
      detectedTimeMention: null,
    };
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
    return {
      intent: "CONSULTA",
      replyText: MENSAJE_ERROR_GEMINI,
      detectedServiceMention: null,
      detectedProfessionalMention: null,
      detectedDateMention: null,
      detectedTimeMention: null,
    };
  }

  const parseado = parsearSalidaGemini(resultado.text);
  if (!parseado) {
    console.error("[amore-entrada] salida de Gemini fuera del schema esperado -- se responde CONSULTA con mensaje de error genérico");
    return {
      intent: "CONSULTA",
      replyText: MENSAJE_ERROR_GEMINI,
      detectedServiceMention: null,
      detectedProfessionalMention: null,
      detectedDateMention: null,
      detectedTimeMention: null,
    };
  }
  return parseado;
}

/** `undefined`/`null`/no-string -> null (nunca inventa un texto ni deja `undefined` pasar como si fuera un dato real). */
function comoTextoOpcional(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
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
  if (obj.intent !== "CONSULTA" && obj.intent !== "TRIGGER_AGENDA" && obj.intent !== "CANCELAR_CITA" && obj.intent !== "REPROGRAMAR_CITA") return null;
  if (typeof obj.reply_text !== "string") return null;
  const camposTexto = [obj.detected_service_mention, obj.detected_professional_mention, obj.detected_date_mention, obj.detected_time_mention];
  if (camposTexto.some((v) => v !== null && v !== undefined && typeof v !== "string")) return null;
  return {
    intent: obj.intent,
    replyText: obj.reply_text,
    detectedServiceMention: comoTextoOpcional(obj.detected_service_mention),
    detectedProfessionalMention: comoTextoOpcional(obj.detected_professional_mention),
    detectedDateMention: comoTextoOpcional(obj.detected_date_mention),
    detectedTimeMention: comoTextoOpcional(obj.detected_time_mention),
  };
}
