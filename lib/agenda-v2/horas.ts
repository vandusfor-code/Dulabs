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
 */
import { formatearHoraAmPm } from "@/lib/especialistas-flow-adaptador";

/** Máximo de horarios a ofrecer -- sección "MENÚ DE HORAS" del pedido: si hay más de 6 libres, se toman los 6 primeros en orden cronológico. */
export const MAX_OPCIONES_HORA = 6;

export interface OpcionHoraAgendaV2 {
  numero: number;
  fechaIso: string;
  /** "HH:MM" 24h, hora Colombia -- mismo formato que ya produce horaColombiaDesdeIso/listarHorariosDisponiblesPorServicioConNylas. */
  hora: string;
}

/**
 * Numera EXACTAMENTE los horarios reales ya calculados (ver
 * lib/agenda-v2/disponibilidad.ts), en el mismo orden cronológico en que
 * llegan (generarHorariosLibres ya los produce ordenados) -- nunca inventa,
 * nunca reordena por su cuenta. Corta en las primeras MAX_OPCIONES_HORA.
 */
export function construirOpcionesHora(fechaIso: string, horarios: string[]): OpcionHoraAgendaV2[] {
  return horarios.slice(0, MAX_OPCIONES_HORA).map((hora, i) => ({ numero: i + 1, fechaIso, hora }));
}

function listaOpciones(opciones: OpcionHoraAgendaV2[]): string {
  return opciones.map((o) => `${o.numero}. ${formatearHoraAmPm(o.hora)}`).join("\n");
}

export function renderizarMenuHora(opciones: OpcionHoraAgendaV2[]): string {
  return `Perfecto 💗 Estos son los horarios disponibles:\n\n${listaOpciones(opciones)}\n\nSelecciona el horario que prefieras.`;
}

export function textoSeleccionInvalidaHora(opciones: OpcionHoraAgendaV2[]): string {
  return `No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n${listaOpciones(opciones)}`;
}

/**
 * Resuelve la respuesta del cliente CONTRA las opciones realmente
 * mostradas -- mismo criterio EXACTO que el resto de Agenda V2: nunca fuzzy
 * matching, nunca interpreta texto libre, nunca vuelve a calcular la
 * posición. Solo número exacto es válido.
 */
export function resolverSeleccionHora(mensaje: string, opciones: OpcionHoraAgendaV2[]): OpcionHoraAgendaV2 | undefined {
  const texto = mensaje.trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const numero = Number(texto);
  return opciones.find((o) => o.numero === numero);
}
