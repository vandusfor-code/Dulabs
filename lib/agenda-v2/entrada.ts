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
