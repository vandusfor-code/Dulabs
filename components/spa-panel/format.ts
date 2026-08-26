export function formatearHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatearFechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
}

export function formatearFechaLarga(d: Date) {
  const texto = d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function esHoy(iso: string, referencia = new Date()) {
  return new Date(iso).toDateString() === referencia.toDateString();
}

export function mismoDia(iso: string, d: Date) {
  return new Date(iso).toDateString() === d.toDateString();
}

export function minutosEntre(inicioIso: string, finIso: string) {
  return Math.round((new Date(finIso).getTime() - new Date(inicioIso).getTime()) / 60000);
}

export function formatearDuracion(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${h}h` : `${h}h ${resto}min`;
}

// El bot reconoce a una clienta por el número tal como llega de WhatsApp:
// indicativo de país + número, solo dígitos (ej. "573001234567"). Si
// Daniela escribe el celular "a la colombiana" (10 dígitos, empieza en 3),
// le agregamos el 57 -- así no depende de que ella lo escriba en el formato
// exacto para que el vínculo funcione.
export function normalizarTelefono(valor: string): string | undefined {
  const digitos = valor.replace(/\D/g, "");
  if (!digitos) return undefined;
  if (digitos.length === 10 && digitos.startsWith("3")) return `57${digitos}`;
  return digitos;
}

export function inicialesDe(nombre: string) {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}

export function fechaComoInputDate(d: Date) {
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}
