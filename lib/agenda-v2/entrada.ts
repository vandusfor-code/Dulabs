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

const FRASES_CANCELAR = ["cancelar mi cita", "quiero cancelar mi cita", "cancelar cita"];
const FRASES_REPROGRAMAR = [
  "reprogramar mi cita",
  "quiero cambiar mi cita",
  "cambiar mi cita",
  "quiero cambiar la fecha",
  "quiero cambiar el horario",
];
const FRASES_CONSULTAR = ["consultar mi cita", "ver mi cita", "que cita tengo", "cuando tengo mi cita", "quiero ver mi cita"];

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
