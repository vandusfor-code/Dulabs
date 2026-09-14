// Fase 10 (Analytics, autorizado) -- parseo/validación común del filtro de
// fecha para todos los endpoints de analytics. Reutilizado por
// /api/dashboard/analytics, /api/dashboard/analytics/flows y
// /api/dashboard/analytics/inbox para que "hoy" / "7d" / "30d" / rango
// personalizado signifiquen EXACTAMENTE lo mismo en toda la plataforma.

export type Periodo = { desde: Date; hasta: Date; etiqueta: string };

const MS_DIA = 24 * 60 * 60 * 1000;
// Tope defensivo de rango personalizado -- sección 6 del spec F10 pide
// explícitamente "NO permitir rangos absurdos sin protección". 1 año es
// generoso para cualquier reporte real de negocio sin permitir un scan de
// "toda la tabla desde el inicio de los tiempos" por accidente.
const MAX_DIAS_RANGO_PERSONALIZADO = 366;

export type ResultadoPeriodo = { ok: true; periodo: Periodo } | { ok: false; error: string };

// `searchParams` acepta: periodo=today|7d|30d|custom (default "30d"),
// y si periodo=custom, desde=YYYY-MM-DD&hasta=YYYY-MM-DD (ambos requeridos).
export function resolverPeriodo(searchParams: URLSearchParams): ResultadoPeriodo {
  const periodo = searchParams.get("periodo") ?? "30d";
  const ahora = new Date();

  if (periodo === "today") {
    const desde = new Date(ahora);
    desde.setHours(0, 0, 0, 0);
    return { ok: true, periodo: { desde, hasta: ahora, etiqueta: "today" } };
  }
  if (periodo === "7d") {
    return { ok: true, periodo: { desde: new Date(ahora.getTime() - 7 * MS_DIA), hasta: ahora, etiqueta: "7d" } };
  }
  if (periodo === "30d") {
    return { ok: true, periodo: { desde: new Date(ahora.getTime() - 30 * MS_DIA), hasta: ahora, etiqueta: "30d" } };
  }
  if (periodo === "custom") {
    const desdeStr = searchParams.get("desde");
    const hastaStr = searchParams.get("hasta");
    if (!desdeStr || !hastaStr) {
      return { ok: false, error: "periodo=custom requiere 'desde' y 'hasta' (YYYY-MM-DD)" };
    }
    const desde = new Date(`${desdeStr}T00:00:00.000Z`);
    const hasta = new Date(`${hastaStr}T23:59:59.999Z`);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
      return { ok: false, error: "'desde'/'hasta' inválidos, formato esperado YYYY-MM-DD" };
    }
    if (desde > hasta) {
      return { ok: false, error: "'desde' no puede ser posterior a 'hasta'" };
    }
    const diasRango = (hasta.getTime() - desde.getTime()) / MS_DIA;
    if (diasRango > MAX_DIAS_RANGO_PERSONALIZADO) {
      return { ok: false, error: `El rango personalizado no puede superar ${MAX_DIAS_RANGO_PERSONALIZADO} días` };
    }
    return { ok: true, periodo: { desde, hasta, etiqueta: "custom" } };
  }

  return { ok: false, error: "periodo inválido, use: today | 7d | 30d | custom" };
}
