/**
 * AGENDA V2 (autorizado) — FASE 5: selección de hora. Lógica de
 * presentación PURA, mismo patrón que fechas.ts/profesionales.ts. El
 * cálculo REAL de qué horarios están libres (motor de disponibilidad +
 * Nylas) vive en lib/agenda-v2/disponibilidad.ts -- este archivo solo sabe
 * transformar horarios YA calculados en un menú numerado, y resolver la
 * respuesta del cliente contra esas opciones guardadas.
 *
 * Reutiliza formatearHoraAmPm (lib/especialistas-flow-adaptador.ts) -- pura
 * función de formato ("14:00" -> "2:00 p. m."), sin ninguna dependencia de
 * Flow Engine ni del modo guiado, ya reutilizada por Agenda V2 en
 * servicios.ts (vía formatearPrecioCop del mismo archivo).
 *
 * Corrección post-deploy (autorizada, "Ver más horarios") -- MISMO concepto
 * de continuación/paginación que ya usa fechas.ts para "Ver más fechas":
 * `calcularHorariosParaFecha` (lib/agenda-v2/disponibilidad.ts) ya trae en
 * UNA sola consulta TODOS los horarios reales libres de ese día -- nunca
 * hace falta una segunda consulta a Nylas para "ver más", solo mostrar el
 * siguiente bloque de los que ya se calcularon. Por eso `construirBloqueHora`
 * devuelve también `horariosRestantes` (los que quedan sin mostrar, en
 * crudo, sin numerar todavía) -- router.ts los guarda en la sesión y los
 * reutiliza tal cual si se pide "Ver más horarios", sin recalcular nada.
 */
import { formatearHoraAmPm } from "@/lib/especialistas-flow-adaptador";
import { normalizarNumeroDeOpcion } from "@/lib/agenda-v2/normalizar-opcion";

/** Máximo de horarios a ofrecer POR BLOQUE -- sección "MENÚ DE HORAS" del pedido: si hay más de 6 libres, se toman los 6 primeros en orden cronológico; el resto queda disponible vía "Ver más horarios". */
export const MAX_OPCIONES_HORA = 6;

export interface OpcionHoraAgendaV2 {
  numero: number;
  fechaIso: string;
  /** "HH:MM" 24h, hora Colombia -- mismo formato que ya produce horaColombiaDesdeIso/listarHorariosDisponiblesPorServicioConNylas. */
  hora: string;
}

/**
 * Corrección post-deploy (autorizada, "Ver más horarios") -- un bloque
 * (página) de horarios: `opciones` ya numeradas desde 1 (nunca continúa la
 * numeración del bloque anterior, mismo criterio EXACTO que "Ver más
 * fechas"), `numeroVerMasHoras` el número real asignado a "Ver más
 * horarios" en ESTE bloque (`null` si no queda ningún horario real más
 * allá de este bloque -- nunca se ofrece una opción que no llevaría a
 * ningún resultado), y `horariosRestantes` los horarios reales (crudos,
 * "HH:MM") que quedan sin mostrar, para poder construir el siguiente
 * bloque sin volver a consultar Nylas.
 */
export interface BloqueHoraAgendaV2 {
  opciones: OpcionHoraAgendaV2[];
  numeroVerMasHoras: number | null;
  horariosRestantes: string[];
}

/**
 * Numera EXACTAMENTE los horarios reales ya calculados (ver
 * lib/agenda-v2/disponibilidad.ts), en el mismo orden cronológico en que
 * llegan (generarHorariosLibres ya los produce ordenados) -- nunca inventa,
 * nunca reordena por su cuenta. Corta en las primeras MAX_OPCIONES_HORA;
 * el resto queda en `horariosRestantes` (nunca descartado).
 */
export function construirBloqueHora(fechaIso: string, horarios: string[]): BloqueHoraAgendaV2 {
  const pagina = horarios.slice(0, MAX_OPCIONES_HORA);
  const horariosRestantes = horarios.slice(MAX_OPCIONES_HORA);
  const opciones = pagina.map((hora, i) => ({ numero: i + 1, fechaIso, hora }));
  const numeroVerMasHoras = horariosRestantes.length > 0 ? opciones.length + 1 : null;
  return { opciones, numeroVerMasHoras, horariosRestantes };
}

function listaOpciones(opciones: OpcionHoraAgendaV2[], numeroVerMasHoras: number | null = null): string {
  const lineaVerMas = numeroVerMasHoras !== null ? `\n${numeroVerMasHoras}. Ver más horarios` : "";
  return `${opciones.map((o) => `${o.numero}. ${formatearHoraAmPm(o.hora)}`).join("\n")}${lineaVerMas}`;
}

/**
 * `numeroVerMasHoras` (autorizado, "Ver más horarios") -- mismo criterio
 * EXACTO que renderizarMenuFecha: `null` por defecto, comportamiento
 * 100% idéntico al de antes de esta corrección cuando se omite.
 */
export function renderizarMenuHora(opciones: OpcionHoraAgendaV2[], numeroVerMasHoras: number | null = null): string {
  return `Perfecto 💗 Estos son los horarios disponibles:\n\n${listaOpciones(opciones, numeroVerMasHoras)}\n\nSelecciona el horario que prefieras.`;
}

export function textoSeleccionInvalidaHora(opciones: OpcionHoraAgendaV2[], numeroVerMasHoras: number | null = null): string {
  return `No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n${listaOpciones(opciones, numeroVerMasHoras)}`;
}

/** `mensaje` calza EXACTAMENTE el número de "Ver más horarios" de este bloque (normalizado, ver normalizar-opcion.ts -- nunca fuzzy). `numeroVerMasHoras === null` (no quedan más horarios reales) siempre devuelve `false`. */
export function esSeleccionVerMasHoras(mensaje: string, numeroVerMasHoras: number | null): boolean {
  if (numeroVerMasHoras === null) return false;
  return normalizarNumeroDeOpcion(mensaje) === numeroVerMasHoras;
}

/**
 * Resuelve la respuesta del cliente CONTRA las opciones realmente
 * mostradas -- mismo criterio EXACTO que el resto de Agenda V2: nunca fuzzy
 * matching, nunca interpreta texto libre, nunca vuelve a calcular la
 * posición. Solo número exacto (normalizado) es válido.
 */
export function resolverSeleccionHora(mensaje: string, opciones: OpcionHoraAgendaV2[]): OpcionHoraAgendaV2 | undefined {
  const numero = normalizarNumeroDeOpcion(mensaje);
  if (numero === null) return undefined;
  return opciones.find((o) => o.numero === numero);
}
