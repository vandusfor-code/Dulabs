import type { VariablesMensaje } from "./tipos";

// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) —
// renderizado PURO de la plantilla configurada por tenant. Cinco variables
// soportadas; cualquier otra llave "{{...}}" mal escrita queda tal cual --
// nunca se inventa un valor para ella.
export function renderizarMensajeComunicacion(plantilla: string, variables: VariablesMensaje): string {
  return plantilla
    .replaceAll("{{nombre}}", variables.nombre)
    .replaceAll("{{servicio}}", variables.servicio)
    .replaceAll("{{profesional}}", variables.profesional)
    .replaceAll("{{fecha}}", variables.fecha)
    .replaceAll("{{hora}}", variables.hora);
}

/** "sábado, 5 de septiembre" / "9:30 a. m." -- SIEMPRE hora de Colombia, nunca la del servidor. Mismo criterio que lib/reserva-notificaciones-whatsapp.ts. */
export function formatearFechaComunicacion(inicioISO: string): { fecha: string; hora: string } {
  const d = new Date(inicioISO);
  const fecha = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" }).format(d);
  const hora = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(d);
  return { fecha, hora };
}
