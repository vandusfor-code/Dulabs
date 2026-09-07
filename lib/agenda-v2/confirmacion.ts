/**
 * AGENDA V2 (autorizado) — FASE 6: S5_CONFIRMAR. Lógica de presentación PURA,
 * mismo patrón que fechas.ts/horas.ts/profesionales.ts. A diferencia de los
 * pasos anteriores, las 4 opciones NO salen de un catálogo real (nunca hay
 * "más o menos" confirmaciones posibles) -- son un menú de control FIJO,
 * pero se resuelven exactamente igual (número exacto contra lo guardado en
 * `opcionesMostradas`), para mantener un único mecanismo de resolución en
 * toda Agenda V2.
 *
 * El RESUMEN sí sale exclusivamente de datos reales ya resueltos por
 * router.ts (servicio, profesional, fecha, hora) -- este archivo nunca
 * inventa ni cachea nada, solo formatea lo que recibe.
 *
 * Reutiliza (nunca duplica):
 * - formatearPrecioCop (lib/especialistas-flow-adaptador.ts) -- ya usado en
 *   lib/agenda-v2/servicios.ts.
 * - formatearDuracion (lib/catalogo-servicios-flow-adaptador.ts) -- "15" ->
 *   "15 min", "90" -> "1 h 30 min".
 */
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { formatearDuracion } from "@/lib/catalogo-servicios-flow-adaptador";

export type AccionConfirmacionAgendaV2 = "confirmar" | "cambiar_fecha" | "cambiar_hora" | "cancelar";

export interface OpcionConfirmacionAgendaV2 {
  numero: number;
  accion: AccionConfirmacionAgendaV2;
}

/** Menú de control fijo -- siempre las mismas 4 opciones, en el mismo orden. Nunca varía por tenant ni por cita. */
export const OPCIONES_CONFIRMACION: OpcionConfirmacionAgendaV2[] = [
  { numero: 1, accion: "confirmar" },
  { numero: 2, accion: "cambiar_fecha" },
  { numero: 3, accion: "cambiar_hora" },
  { numero: 4, accion: "cancelar" },
];

export interface ResumenCitaAgendaV2 {
  servicioNombre: string;
  servicioPrecio: number;
  servicioDuracionMin: number;
  profesionalNombre: string;
  /** Ya formateada, ej. "Miércoles 9 de septiembre" (ver formatearFechaLarga en fechas.ts). */
  fechaEtiqueta: string;
  /** Ya formateada, ej. "3:00 p. m." (ver formatearHoraAmPm en especialistas-flow-adaptador.ts). */
  horaTexto: string;
}

function listaOpcionesTexto(): string {
  return "1. Confirmar cita\n2. Cambiar fecha\n3. Cambiar horario\n4. Cancelar";
}

/** Resumen real de la cita + el menú de control -- EXCLUSIVAMENTE con los datos recibidos, nunca inventa ni hardcodea ninguno. */
export function renderizarResumenConfirmacion(resumen: ResumenCitaAgendaV2): string {
  return (
    `Perfecto 💗 Estos son los datos de tu cita:\n\n` +
    `Servicio: ${resumen.servicioNombre}\n` +
    `Profesional: ${resumen.profesionalNombre}\n` +
    `Fecha: ${resumen.fechaEtiqueta}\n` +
    `Hora: ${resumen.horaTexto}\n` +
    `Duración: ${formatearDuracion(resumen.servicioDuracionMin)}\n` +
    `Valor: ${formatearPrecioCop(resumen.servicioPrecio)}\n\n` +
    `¿Deseas confirmar tu cita?\n\n${listaOpcionesTexto()}`
  );
}

/**
 * FASE 8 (autorizado) -- mismo resumen y MISMO menú de control de 4
 * opciones (confirmar/cambiar fecha/cambiar hora/cancelar), pero con la
 * introducción propia de una reprogramación ("vas a cambiar tu cita" en vez
 * de "estos son los datos de tu cita") -- nunca duplica el menú, solo la
 * primera línea.
 */
export function renderizarResumenCambio(resumen: ResumenCitaAgendaV2): string {
  return (
    `💗 Vas a cambiar tu cita a:\n\n` +
    `Servicio: ${resumen.servicioNombre}\n` +
    `Profesional: ${resumen.profesionalNombre}\n` +
    `Fecha: ${resumen.fechaEtiqueta}\n` +
    `Hora: ${resumen.horaTexto}\n` +
    `Duración: ${formatearDuracion(resumen.servicioDuracionMin)}\n` +
    `Valor: ${formatearPrecioCop(resumen.servicioPrecio)}\n\n` +
    `¿Confirmas el cambio?\n\n${listaOpcionesTexto()}`
  );
}

export function textoSeleccionInvalidaConfirmacion(): string {
  return `No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n${listaOpcionesTexto()}`;
}

/**
 * FASE 7 (autorizado) -- datos de la cita YA creada de verdad (devueltos por
 * crearCitaConNylas + el precio real del catálogo, ver router.ts). Mismo
 * criterio que ResumenCitaAgendaV2: EXCLUSIVAMENTE datos reales recibidos,
 * nunca inventados ni hardcodeados.
 */
export interface ResumenCitaConfirmada {
  servicioNombre: string;
  profesionalNombre: string;
  /** Ya formateada, ej. "Miércoles 9 de septiembre" (ver formatearFechaLarga en fechas.ts). */
  fechaEtiqueta: string;
  /** Ya formateada, ej. "3:00 p. m." (ver formatearHoraAmPm en especialistas-flow-adaptador.ts). */
  horaTexto: string;
  valor: number;
}

/** Mensaje de éxito real (la cita YA quedó persistida) -- EXCLUSIVAMENTE con los datos recibidos. */
export function renderizarConfirmacionExitosa(resumen: ResumenCitaConfirmada): string {
  return (
    `¡Listo! 💗 Tu cita quedó agendada.\n\n` +
    `Servicio: ${resumen.servicioNombre}\n` +
    `Profesional: ${resumen.profesionalNombre}\n` +
    `Fecha: ${resumen.fechaEtiqueta}\n` +
    `Hora: ${resumen.horaTexto}\n` +
    `Valor: ${formatearPrecioCop(resumen.valor)}\n\n` +
    `Te esperamos.`
  );
}

/** FASE 7 -- la revalidación inmediatamente antes de crear encontró el horario ya ocupado. Nunca se crea nada. */
export const MENSAJE_HORARIO_RECIEN_OCUPADO = "Lo siento 💗 Ese horario acaba de ser ocupado.\n\nPor favor selecciona otro horario disponible.";

/** FASE 7 -- cualquier error técnico/de configuración al intentar crear la reserva real. Nunca se marca éxito ni se cierra la sesión. */
export const MENSAJE_ERROR_TECNICO_CONFIRMACION =
  "Ups 😔 Tuvimos un problema técnico confirmando tu cita. Por favor intenta de nuevo respondiendo 1, o escribe *cancelar* si prefieres salir.";

/**
 * Resuelve la respuesta del cliente CONTRA las opciones guardadas -- mismo
 * criterio EXACTO que el resto de Agenda V2: nunca fuzzy matching, nunca
 * parseInt libre, nunca interpretación semántica ("sí", "dale", "confirmo").
 * Solo número exacto (1-4) es válido.
 */
export function resolverSeleccionConfirmacion(mensaje: string, opciones: OpcionConfirmacionAgendaV2[]): OpcionConfirmacionAgendaV2 | undefined {
  const texto = mensaje.trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const numero = Number(texto);
  return opciones.find((o) => o.numero === numero);
}
