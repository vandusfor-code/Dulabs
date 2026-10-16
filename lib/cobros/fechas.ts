/** Hoy en Colombia (YYYY-MM-DD), que es la fecha con la que se comparan las fechas de cobro (el servidor corre en UTC: a las 8 p. m. de Bogotá ya es «mañana» allá). */
export function hoyBogota(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}
