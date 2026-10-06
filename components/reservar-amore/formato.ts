// AMORE (portal) — formatos de fecha, hora y duración compartidos por todas las pantallas (antes cada una tenía su propia copia). Todo en hora de Colombia.

export function formatearDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const minutos = min % 60;
  return minutos === 0 ? `${horas} h` : `${horas} h ${minutos} min`;
}

export function fechaDesdeISO(fechaISO: string): Date {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function isoDesdeFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function sumarDias(fechaISO: string, dias: number): string {
  const fecha = fechaDesdeISO(fechaISO);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return isoDesdeFecha(fecha);
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** «Octubre 2026» */
export function formatearMesAnio(fechaISO: string): string {
  return capitalizar(new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "America/Bogota" }).format(fechaDesdeISO(fechaISO)));
}

/** «Viernes, 9 de octubre» */
export function formatearFechaLarga(fechaISO: string): string {
  return capitalizar(new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", weekday: "long", timeZone: "America/Bogota" }).format(fechaDesdeISO(fechaISO)));
}

/** «Vie 9 oct» (para resúmenes de una línea) */
export function formatearFechaCorta(fechaISO: string): string {
  const texto = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", weekday: "short", timeZone: "America/Bogota" }).format(fechaDesdeISO(fechaISO));
  return capitalizar(texto.replace(/[.,]/g, "").replace(/\s+de\s+/g, " "));
}

/** «9:00 a. m.» a partir de «09:00» */
export function formatearHora12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const periodo = h >= 12 ? "p. m." : "a. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${periodo}`;
}

/** «Viernes, 9 de octubre» de un INSTANTE (fecha ISO con hora, ej. el `inicio` de una cita), en hora de Colombia. */
export function formatearFechaLargaDeInstante(iso: string): string {
  return capitalizar(new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" }).format(new Date(iso)));
}

/** «10:00 a. m.» de un INSTANTE, en hora de Colombia. */
export function formatearHoraDeInstante(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(new Date(iso));
}
