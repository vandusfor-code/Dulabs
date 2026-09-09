/**
 * AGENDA V2 (autorizado) — FASE 4: selección de fecha. Lógica de
 * presentación PURA (numerar/renderizar/resolver), en el mismo estilo que
 * categorias.ts/servicios.ts/profesionales.ts -- deliberadamente
 * independiente de lib/bot-escenarios/agendamiento-guiado.ts (esa pertenece
 * al modo guiado existente, acoplado al Flow Engine; no se importa nada de
 * ahí, ni siquiera su función de formateo de fecha, para mantener a Agenda
 * V2 genuinamente aislada -- por eso formatearFechaLarga se repite acá,
 * deliberadamente, en vez de reutilizarse).
 *
 * El cálculo REAL de qué fechas son candidatas (horario real + bloqueos +
 * disponibilidad Nylas) vive en lib/agenda-v2/disponibilidad.ts -- este
 * archivo solo sabe transformar una lista de fechas YA decididas en un menú
 * numerado, y resolver la respuesta del cliente contra esas opciones
 * guardadas. Nunca decide por su cuenta qué día es válido.
 */

function capitalizar(texto: string): string {
  return texto.length > 0 ? texto[0]!.toUpperCase() + texto.slice(1) : texto;
}

/** "Martes 8 de septiembre" (America/Bogota) a partir de un fechaISO YYYY-MM-DD ya resuelto -- nunca calculado por IA. */
export function formatearFechaLarga(fechaIso: string): string {
  const ancla = new Date(`${fechaIso}T12:00:00-05:00`);
  const texto = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" }).format(ancla);
  return capitalizar(texto.replace(",", ""));
}

export interface OpcionFechaAgendaV2 {
  numero: number;
  fechaIso: string;
  etiqueta: string;
}

/** Numera EXACTAMENTE las fechas ya decididas como candidatas reales (ver lib/agenda-v2/disponibilidad.ts) -- nunca inventa ni reordena por su cuenta. */
export function construirOpcionesFecha(fechasIso: string[]): OpcionFechaAgendaV2[] {
  return fechasIso.map((fechaIso, i) => ({ numero: i + 1, fechaIso, etiqueta: formatearFechaLarga(fechaIso) }));
}

function listaOpciones(opciones: OpcionFechaAgendaV2[], numeroVerMasFechas: number | null = null): string {
  const lineaVerMas = numeroVerMasFechas !== null ? `\n${numeroVerMasFechas}. Ver más fechas` : "";
  return `${opciones.map((o) => `${o.numero}. ${o.etiqueta}`).join("\n")}${lineaVerMas}`;
}

// Corrección post-deploy (autorizada, "Ver más fechas") -- `numeroVerMasFechas`
// es el número asignado a "Ver más fechas" en ESTE menú (calculado por
// lib/agenda-v2/disponibilidad.ts/router.ts a partir de la disponibilidad
// real restante dentro del horizonte) -- `null` cuando no hay ninguna fecha
// real más allá de las ya mostradas (nunca se ofrece una opción que no
// llevaría a ningún resultado). Comportamiento 100% idéntico al de antes de
// esta corrección cuando se omite (default `null`).
export function renderizarMenuFecha(opciones: OpcionFechaAgendaV2[], numeroVerMasFechas: number | null = null): string {
  return `Perfecto 💗 ¿Qué día deseas agendar?\n\n${listaOpciones(opciones, numeroVerMasFechas)}`;
}

export function textoSeleccionInvalidaFecha(opciones: OpcionFechaAgendaV2[], numeroVerMasFechas: number | null = null): string {
  return `No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n${listaOpciones(opciones, numeroVerMasFechas)}`;
}

/** `mensaje` calza EXACTAMENTE el número de "Ver más fechas" de este menú (nunca fuzzy, mismo criterio "solo número exacto" de todo Agenda V2). `numeroVerMasFechas === null` (no hay más fechas dentro del horizonte) siempre devuelve `false`. */
export function esSeleccionVerMasFechas(mensaje: string, numeroVerMasFechas: number | null): boolean {
  if (numeroVerMasFechas === null) return false;
  return mensaje.trim() === String(numeroVerMasFechas);
}

/**
 * Resuelve la respuesta del cliente CONTRA las opciones realmente
 * mostradas (guardadas en la sesión) -- mismo criterio EXACTO que
 * resolverSeleccionServicio/Categoria/Profesional: nunca parsea texto libre
 * ("el sábado", "mañana"), nunca reconstruye el menú, nunca busca la fecha
 * directamente en base de datos. Solo número exacto es válido.
 */
export function resolverSeleccionFecha(mensaje: string, opciones: OpcionFechaAgendaV2[]): OpcionFechaAgendaV2 | undefined {
  const texto = mensaje.trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const numero = Number(texto);
  return opciones.find((o) => o.numero === numero);
}
