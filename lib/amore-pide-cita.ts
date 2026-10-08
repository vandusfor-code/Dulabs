/**
 * AMORE, modo «saludo único» (lib/amore-bot-modo.ts) -- ¿la clienta está PIDIENDO una cita nueva?
 *
 * Es lo único (junto con gestionar SU cita por frases claras) por lo que el asistente vuelve a hablar después del saludo, y en este modo no hay IA que lo interprete: tiene que
 * leerse bien con reglas fijas. Por eso suma a las frases de siempre (`detectarTriggerAgendaDeterminista`) las formas más comunes de pedir una cita que esas frases no cubren
 * («quisiera una cita», «quiero cita», «¿tienen citas para mañana?», «¿cómo reservo?», «me agendas»).
 *
 * Criterio (el mismo de las demás listas: texto normalizado -- minúsculas, sin tildes --, nunca IA ni coincidencia difusa):
 *   - Un falso positivo solo manda el enlace de reserva (inofensivo); un falso negativo deja a la clienta sin enlace y la atiende el equipo. Aun así NO se dispara con la palabra
 *     «cita» suelta ni con «una cita»/«mi cita» sin un verbo de pedir: «tengo una cita mañana» o «confirmo mi cita para hoy» son de una cita que YA existe.
 *   - Un «no» pegado al verbo («no quiero cita», «ya no necesito una cita») nunca es una petición: esa parte de la frase se descarta antes de buscar (también para las frases
 *     de siempre, que por ser «contiene» leerían «ya no necesito una cita» como «necesito una cita»). Con una coma de por medio («no, quiero una cita») sí cuenta.
 *   - Cancelar / cambiar / consultar SU cita no pasa por aquí: lo atiende `detectarIntencionGestionCitas` (lib/agenda-v2/entrada.ts), que se revisa antes.
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import { detectarTriggerAgendaDeterminista } from "@/lib/amore-entrada-gemini";

const DESEO = String.raw`(?:quiero|quisiera|quisiese|queria|necesito|necesitaba|ocupo|requiero|deseo|busco|me gustaria|me encantaria)`;
const RESERVAR = String.raw`(?:agendar|reservar|apartar|separar|programar)(?:me|nos|lo|la)?`;

/** «no quiero cita», «ya no necesito una cita», «no me gustaria agendar»: la frase negada, hasta el siguiente signo de puntuación. */
const FRASE_NEGADA = new RegExp(String.raw`\bno\s+${DESEO}\b[^,.;:!?¡¿\n]*`, "g");

const PATRONES_PIDE_CITA: RegExp[] = [
  // «agendar / reservar / sacar / pedir / apartar / separar / programar / solicitar» + (hasta 2 palabras) + «cita(s)»: «agendar cita», «sacar una cita», «pedir la cita».
  new RegExp(String.raw`\b(?:agendar|reservar|sacar|pedir|apartar|separar|programar|solicitar)(?:me|nos)?\s+(?:\w+\s+){0,2}?citas?\b`),
  // Deseo o necesidad + «cita»: «quiero cita», «quisiera una cita», «necesito otra cita», «me gustaria tener una cita», «quiero hacer una cita».
  new RegExp(String.raw`\b${DESEO}\s+(?:(?:tener|hacer|solicitar|pedir|sacar|agendar|reservar|separar|apartar|programar)\s+)?(?:(?:una|otra|nueva)\s+){0,2}citas?\b`),
  // Deseo o posibilidad + verbo de reservar: «quisiera agendar», «¿puedo reservar?», «¿me pueden agendar?», «me ayudas a agendar».
  new RegExp(String.raw`\b(?:${DESEO}|puedo|podria|podemos|podrian|pueden|puedes|me ayudas a|me ayudan a|me colaboras con)\s+(?:poder\s+)?${RESERVAR}\b`),
  // Disponibilidad: «¿hay citas?», «¿tienen cupo para mañana?», «¿tienen disponibilidad?», «¿qué horarios tienen?».
  /\b(?:hay|tienen|tienes|manejan)\s+(?:citas?|disponibilidad|cupos?|turnos?|espacios?\s+para)\b/,
  /\bque\s+horarios?\s+(?:tienen|hay|manejan)\b/,
  // «¿Cómo reservo?», «¿cómo puedo agendar?», «¿cómo hago para sacar la cita?».
  /\bcomo\s+(?:puedo\s+|hago\s+para\s+|se\s+puede\s+|se\s+hace\s+para\s+)?(?:agendo|reservo|saco|pido|aparto|separo|agendar|reservar|sacar|pedir|apartar|separar)\b/,
  // «Me agendas», «me agendan», «me das una cita», «me regalas un turno».
  /\bme\s+(?:agendas?|agendan)\b/,
  /\bme\s+(?:reservas?|reservan|separas?|separan|apartas?|apartan|das|dan|regalas?|regalan|asignas?|asignan)\s+(?:(?:un|una|otra|otro|la|el)\s+)?(?:cita|turno)\b/,
];

export function pideCitaNueva(mensaje: string): boolean {
  const texto = normalizeText(mensaje).replace(FRASE_NEGADA, " ");
  if (detectarTriggerAgendaDeterminista(texto)) return true;
  return PATRONES_PIDE_CITA.some((patron) => patron.test(texto));
}
