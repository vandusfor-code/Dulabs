/**
 * AMORE — textos de «Mi cita» y de la reserva por enlace. Funciones PURAS (sin I/O): lo que el chat y los correos dicen sobre cómo reservar y cómo
 * gestionar una cita existente. Un solo lugar, para que el chat, la confirmación y los recordatorios digan lo mismo.
 */
import { URL_RESERVA_AMORE } from "@/lib/mi-cita/enlaces";

/** Respuesta cuando alguien quiere una cita NUEVA por el chat: la reserva se hace SOLO en el enlace. */
export const MENSAJE_RESERVA_POR_ENLACE = `¡Claro! 💗 Para reservar una cita nueva, puedes hacerlo directamente desde aquí:\n\n${URL_RESERVA_AMORE}\n\nAhí podrás elegir el servicio, la profesional y el horario que prefieras ✨`;

/** La línea que acompaña al enlace personal en confirmaciones y recordatorios. */
export const textoEnlaceGestion = (url: string): string => `Si necesitas modificar o cancelar tu cita, puedes hacerlo desde este enlace:\n${url}`;

/** Cuando la clienta pide cancelar / cambiar su cita por el chat y el bot no encuentra ninguna a su número. */
export const MENSAJE_SIN_CITAS_CON_ENLACE =
  "No encontré citas próximas con este número 💗\n\nSi reservaste con otro número, puedes gestionar tu cita desde el enlace personal que te llegó en tu confirmación.\n\nY si quieres reservar una cita nueva, puedes hacerlo aquí:\n" +
  URL_RESERVA_AMORE;

export function mensajeCitaCancelada(): string {
  return `Tu cita fue cancelada correctamente. 💗\n\nSi quieres reservar una nueva, puedes hacerlo aquí:\n${URL_RESERVA_AMORE}`;
}

export function mensajeCitaReprogramada(d: { servicio: string; profesional: string; fechaTexto: string; horaTexto: string; urlEnlace: string | null }): string {
  const base = `¡Listo! 💗 Tu cita fue reprogramada.\n\nServicio: ${d.servicio}\nProfesional: ${d.profesional}\nNueva fecha: ${d.fechaTexto}\nNueva hora: ${d.horaTexto}\n\nTe esperamos.`;
  return d.urlEnlace ? `${base}\n\n${textoEnlaceGestion(d.urlEnlace)}` : base;
}

/** La línea que acompaña al enlace personal cuando el bot ya está gestionando la cita en el chat (no la sustituye: el chat sigue funcionando). */
export const textoEnlaceGestionChat = (url: string): string => `También puedes modificarla o cancelarla desde tu enlace personal:\n${url}`;
