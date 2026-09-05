/**
 * Fase 6A (panel administrativo de Daniela) — mismos mensajes amigables que
 * ya usa el portal público (Fase 4, app/api/reservar/[tenant]/route.ts) para
 * traducir los motivos de rechazo de reservarCitaPorServicio. Extraído a un
 * lugar compartido para que el panel los reutilice sin duplicar el texto ni
 * tocar el archivo del portal ya probado.
 */
const MENSAJES_AMIGABLES: Record<string, string> = {
  servicio_no_encontrado: "El servicio seleccionado ya no está disponible.",
  especialista_no_encontrado: "Ese profesional ya no está disponible.",
  especialista_no_habilitado: "Este profesional ya no está disponible para este servicio.",
  fuera_de_horario: "Ese horario ya no está disponible.",
  bloqueado: "Ese horario ya no está disponible.",
  ocupado: "Ese horario acaba de ser tomado. Por favor selecciona otro.",
  error: "Hubo un problema al crear la cita. Por favor intenta nuevamente.",
};

export function mensajeAmigableReserva(motivo: string): string {
  return MENSAJES_AMIGABLES[motivo] ?? MENSAJES_AMIGABLES.error;
}
