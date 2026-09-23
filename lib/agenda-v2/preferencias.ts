/**
 * AGENDA V2 -- datos que la clienta YA dijo pero que todavía no se pueden aplicar porque falta un paso anterior.
 *
 * Causa raíz que corrige: "¿tienes disponibilidad mañana?" o "quiero con Cristal" dichos antes de elegir el servicio se
 * perdían -- el menú de profesionales/días se mostraba como si nada, y la clienta tenía que repetirlo. Ahora esos datos
 * se guardan en la sesión (columna `slot_seleccionado`, que ANTES de S5_CONFIRMAR no se usa para nada; toda transición a
 * S5 la sobrescribe con el slot real) y se aplican en cuanto hay servicio. Aplicarlos NUNCA salta la validación real:
 * la profesional se resuelve contra las elegibles del servicio y la fecha contra los días REALES de su agenda.
 *
 * Todo es puro y determinista (sin IA).
 */
import { normalizarFrase } from "@/lib/agenda-v2/seleccion-natural";
import { parseFechaColombia } from "@/lib/parse-fecha-colombia";

export interface PreferenciasReserva {
  /** Nombre de profesional tal como se resolvió contra las profesionales REALES del salón (nunca texto crudo de la clienta). */
  profesionalNombre?: string;
  /** Fecha ya resuelta (YYYY-MM-DD) en el momento en que la clienta la dijo. */
  fechaIso?: string;
  /** Hora en texto crudo ("a las 4"), se valida contra los horarios reales de ese día al aplicarla. */
  horaMencion?: string;
}

export function hayPreferencias(p: PreferenciasReserva | null | undefined): p is PreferenciasReserva {
  return !!p && !!(p.profesionalNombre || p.fechaIso || p.horaMencion);
}

/** Lee las preferencias guardadas en `slot_seleccionado` (solo en S1/S2). Cualquier otra forma (el slot real de S5) devuelve `{}`. */
export function leerPreferencias(slot: unknown): PreferenciasReserva {
  if (!slot || typeof slot !== "object" || !("preferencias" in slot)) return {};
  const p = (slot as { preferencias: unknown }).preferencias;
  if (!p || typeof p !== "object") return {};
  const { profesionalNombre, fechaIso, horaMencion } = p as Record<string, unknown>;
  return {
    ...(typeof profesionalNombre === "string" && profesionalNombre ? { profesionalNombre } : {}),
    ...(typeof fechaIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fechaIso) ? { fechaIso } : {}),
    ...(typeof horaMencion === "string" && horaMencion ? { horaMencion } : {}),
  };
}

/** Valor a guardar en `slot_seleccionado`; `null` si no hay nada que recordar. */
export function valorPreferencias(p: PreferenciasReserva): { preferencias: PreferenciasReserva } | null {
  return hayPreferencias(p) ? { preferencias: p } : null;
}

/** Lo más reciente gana: un dato nuevo reemplaza al anterior del mismo tipo. */
export function combinarPreferencias(anteriores: PreferenciasReserva, nuevas: PreferenciasReserva): PreferenciasReserva {
  return { ...anteriores, ...Object.fromEntries(Object.entries(nuevas).filter(([, v]) => v)) };
}

const DIAS = new Set(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]);
/** "mañana" precedida de estas palabras es la franja ("en la mañana", "por la mañana"), no el día. */
const ANTES_DE_MANANA_FRANJA = new Set(["la", "las", "esta"]);

/**
 * Busca una fecha concreta DENTRO de una frase ("¿tienes disponibilidad mañana?", "quiero con Cristal el viernes",
 * "uñas para el 30 de septiembre"), con el mismo parser determinista de siempre (parseFechaColombia) aplicado desde cada
 * palabra que puede iniciar una fecha. `null` si no hay ninguna o es ambigua/pasada.
 */
export function buscarFechaEnFrase(mensaje: string, hoyIso: string): string | null {
  const t = normalizarFrase(mensaje).split(" ").filter(Boolean);
  for (let i = 0; i < t.length; i++) {
    const w = t[i]!;
    const inicia =
      w === "hoy" ||
      (w === "manana" && !ANTES_DE_MANANA_FRANJA.has(t[i - 1] ?? "")) ||
      (w === "pasado" && t[i + 1] === "manana") ||
      DIAS.has(w) ||
      ((w === "proximo" || w === "este") && DIAS.has(t[i + 1] ?? "")) ||
      (/^\d{1,2}$/.test(w) && t[i + 1] === "de");
    if (!inicia) continue;
    // El parser exige que la fecha empiece la frase y tolera texto después solo en algunos formatos: se prueba desde
    // esta palabra con el resto, y con la forma mínima ("30 de septiembre") por si sigue más texto.
    const candidatos = [t.slice(i).join(" "), t.slice(i, i + 3).join(" ")];
    for (const c of candidatos) {
      const r = parseFechaColombia(c, hoyIso);
      if (r.ok) return r.fecha;
    }
  }
  return null;
}

// --- Preguntas durante la reserva ----------------------------------------------------------------------------------

export type PreguntaDeCatalogo = "precio" | "duracion";

/** ¿Pregunta por precio o duración? (vocabulario cerrado). */
export function detectarPreguntaDeCatalogo(mensaje: string): PreguntaDeCatalogo | null {
  const n = ` ${normalizarFrase(mensaje)} `;
  if (/ (cuanto|que) (cuesta|vale|sale|cobran|valor)\b| precio | precios | valor | costo /.test(n)) return "precio";
  if (/ cuanto (dura|demora|tarda|se demora|tiempo)\b| duracion | cuanto tiempo /.test(n)) return "duracion";
  return null;
}

const INICIOS_PREGUNTA = ["cuanto", "cuanta", "cuantos", "que", "cual", "cuales", "como", "donde", "hacen", "tienen", "manejan", "ustedes", "puedo", "se puede", "me puedes", "incluye", "es "];

/** Mensaje con forma de pregunta (signo de interrogación o inicio interrogativo). Solo decide si VALE LA PENA intentar responderla; nunca elige nada. */
export function pareceUnaPregunta(mensaje: string): boolean {
  if (mensaje.includes("?") || mensaje.includes("¿")) return true;
  const n = normalizarFrase(mensaje);
  return INICIOS_PREGUNTA.some((p) => n === p.trim() || n.startsWith(p.endsWith(" ") ? p : `${p} `));
}
