/** Formatos de presentación del módulo Clientes (hora de Colombia). */

const FECHA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", year: "numeric" });
const FECHA_HORA = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function fecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : FECHA.format(d);
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : FECHA_HORA.format(d);
}

/** 573148127388 → +57 314 812 7388 (otros formatos se muestran tal cual con "+"). */
export function telefono(t: string): string {
  const m = /^57(\d{3})(\d{3})(\d{4})$/.exec(t);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : `+${t}`;
}
