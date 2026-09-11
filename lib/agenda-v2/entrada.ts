/**
 * AGENDA V2 (autorizado) — detección determinística de inicio, reutilizando
 * TAL CUAL las variantes reales ya sembradas para CODIGO_ESCENARIO_AGENDAMIENTO
 * (070_agendamiento en AMORE) y el mismo matching que ya usa el banco de
 * escenarios (coincideVariante, matching.ts) -- nunca un vocabulario nuevo,
 * nunca "text.includes('cita')".
 *
 * Auditado (autorizado): las 6 variantes reales de 070_agendamiento son
 * TODAS tipo "contains" ("quiero agendar", "quiero reservar", "quiero una
 * cita", "necesito cita", "quiero sacar cita", "quiero separar") -- ninguna
 * depende de entidades extraídas (servicio/categoría/afirmación corta), así
 * que se reutilizan sin necesitar el pipeline completo de extracción de
 * entidades (catálogo, sinónimos, etc.) que sí necesita resolverEscenario.
 * Si en el futuro se agrega una variante que SÍ dependa de entidades (ej.
 * "servicio_detectado"), coincideVariante simplemente la evaluará como
 * "no coincide" acá (entidades vacías) -- nunca falla, nunca inventa.
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import { coincideVariante } from "@/lib/bot-escenarios/matching";
import { CODIGO_ESCENARIO_AGENDAMIENTO, type EntidadesDetectadas, type EscenarioRow } from "@/lib/bot-escenarios/tipos";

const ENTIDADES_VACIAS: EntidadesDetectadas = {
  serviciosDetectados: [],
  esAfirmacionCorta: false,
  esNegacionCorta: false,
  indicaGeneroMasculino: false,
  pideVerOpcionesDeNuevo: false,
};

/**
 * true solo si el tenant tiene sembrado un escenario activo con el código
 * reservado de agendamiento Y el mensaje coincide con alguna de sus
 * variantes reales -- un tenant que no lo siembre simplemente nunca activa
 * Agenda V2 (mismo criterio ya documentado en tipos.ts para este código).
 */
export function esInicioDeAgendaV2(mensaje: string, escenarios: EscenarioRow[]): boolean {
  const escenario = escenarios.find((e) => e.codigo === CODIGO_ESCENARIO_AGENDAMIENTO && e.activo);
  if (!escenario) return false;
  const textoNormalizado = normalizeText(mensaje);
  return escenario.variantes.some((v) => coincideVariante(v, textoNormalizado, ENTIDADES_VACIAS));
}

/**
 * FASE 8 (autorizado) — detección de intención de GESTIONAR una cita
 * existente (consultar/cancelar/reprogramar). A diferencia de
 * esInicioDeAgendaV2 (escenario sembrado, configurable por tenant), esta es
 * deliberadamente una lista FIJA y NO configurable de frases "contains"
 * literales (sección "DETECCIÓN DE INTENCIÓN" del pedido: "triggers
 * explícitos y controlados", "NO usar IA semántica, embeddings ni fuzzy
 * matching") -- funciona igual para cualquier tenant, sin depender de que
 * alguien siembre un escenario nuevo. Mismo mecanismo de comparación
 * (normalizeText + substring) que ya usa el resto de Agenda V2 para
 * comandos de control (ver COMANDO_CANCELAR en controlador.ts).
 */
export type AccionGestionCitasDetectada = "consultar" | "cancelar" | "reprogramar";

// Corrección post-deploy (auditoría real, autorizado) -- las frases
// originales solo cubrían "mi cita" ("cancelar mi cita"); un mensaje real
// con artículo "la" ("quiero cancelar la cita") no las contiene como
// subcadena, así que el detector nunca se activaba (caso real observado en
// producción con el teléfono de pruebas autorizado, cita ya creada y
// sesión Agenda V2 ya cerrada). Se agregan las variantes reales con "la
// cita" -- el mecanismo de coincidencia ("contains", nunca fuzzy/IA) NO
// cambia. Deliberadamente "cita" sola NUNCA se agrega a ninguna lista --
// seguiría sin ser intención de gestión (ver detectarIntencionGestionCitas).
// Glosario de intenciones AMORE (autorizado) -- ampliación real de las
// secciones CANCELAR_CITA/REPROGRAMAR_CITA/CONSULTAR_CITA, mismo mecanismo
// "contains" de siempre. Deliberadamente NO se agregan las frases
// ambiguas del glosario tipo "no puedo ir"/"se me complicó"/"me salió un
// compromiso": el propio glosario reconoce que su intención real depende
// de si la misma clienta propone una fecha alterna en el mismo mensaje
// ("no puedo ir" -> cancelar, pero "no puedo ir, ¿la pasamos para el
// viernes?" -> reprogramar) -- un match "contains" literal no puede
// distinguir eso (agregarlas a FRASES_CANCELAR clasificaría MAL el
// segundo caso, porque cancelar se evalúa primero). Esa clase de frases
// queda sin detector determinista por ahora; requiere razonamiento
// contextual real (ver detectarIntencionGestionCitas más abajo).
const FRASES_CANCELAR = [
  "cancelar mi cita",
  "quiero cancelar mi cita",
  "cancelar la cita",
  "quiero cancelar la cita",
  "cancelar cita",
  "ya no quiero la cita",
  "ya no quiero mi cita",
  "ya no necesito la cita",
  "ya no necesito mi cita",
  "ya no deseo la cita",
  "ya no deseo mi cita",
  "ya no me interesa la cita",
  "quiero anular mi cita",
  "quiero anular la cita",
  "quiero eliminar mi cita",
  "quiero eliminar la cita",
  "quiero quitar mi cita",
  "quiero quitar la cita",
  "quiero borrar mi cita",
  "quiero borrar la cita",
  "cancelame la cita",
  "cancelame mi cita",
  "mejor cancela la cita",
  "mejor cancela mi cita",
  "como cancelo la cita",
  "como puedo cancelar la cita",
  "me pueden cancelar la cita",
  "me pueden anular la cita",
];
const FRASES_REPROGRAMAR = [
  "reprogramar mi cita",
  "quiero reprogramar mi cita",
  "reprogramar la cita",
  "quiero reprogramar la cita",
  "quiero cambiar mi cita",
  "cambiar mi cita",
  "quiero cambiar la cita",
  "cambiar la cita",
  "quiero cambiar la fecha",
  "quiero cambiar el horario",
  "quiero mover mi cita",
  "quiero mover la cita",
  "quiero modificar mi cita",
  "quiero modificar la cita",
  "quiero reprogramar",
  "necesito reprogramar",
  "necesito reprogramar mi cita",
  "esa hora no me sirve",
  "ese horario no me sirve",
  "prefiero otro horario",
  "prefiero otro dia",
  "quiero otra fecha",
  "quiero otra hora",
  "quiero otro horario",
  "me pueden cambiar la cita",
  "me pueden mover la cita",
];
const FRASES_CONSULTAR = [
  "consultar mi cita",
  "quiero consultar mi cita",
  "consultar la cita",
  "quiero consultar la cita",
  "ver mi cita",
  "quiero ver mi cita",
  "ver la cita",
  "quiero ver la cita",
  "que cita tengo",
  "cuando tengo mi cita",
  "cuando es mi cita",
  "a que hora tengo mi cita",
  "a que hora es mi cita",
  "que dia tengo mi cita",
  "con quien tengo la cita",
  "quien me atiende",
  "quien me va a atender",
  "que tengo agendado",
  "que tengo reservado",
  "que tengo programado",
  "quiero saber mi cita",
  "quiero revisar mi cita",
  "donde tengo la cita",
  "me confirmas la cita",
];

function coincideAlgunaFrase(textoNormalizado: string, frases: string[]): boolean {
  return frases.some((f) => textoNormalizado.includes(normalizeText(f)));
}

/**
 * Devuelve la acción detectada, o `null` si el mensaje no calza con NINGUNA
 * de las frases controladas. Se revisa cancelar/reprogramar ANTES que
 * consultar a propósito (aunque hoy no hay superposición real entre las
 * listas) para que un futuro ajuste de frases nunca deje que "cancelar"/
 * "cambiar" se interprete por error como una simple consulta.
 */
export function detectarIntencionGestionCitas(mensaje: string): AccionGestionCitasDetectada | null {
  const textoNormalizado = normalizeText(mensaje);
  if (coincideAlgunaFrase(textoNormalizado, FRASES_CANCELAR)) return "cancelar";
  if (coincideAlgunaFrase(textoNormalizado, FRASES_REPROGRAMAR)) return "reprogramar";
  if (coincideAlgunaFrase(textoNormalizado, FRASES_CONSULTAR)) return "consultar";
  return null;
}
