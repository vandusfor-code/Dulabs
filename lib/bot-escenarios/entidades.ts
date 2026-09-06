/**
 * Extracción de entidades 100% determinista (nunca IA) para el banco de
 * escenarios -- ver lib/bot-escenarios/tipos.ts. Reutiliza normalizeText
 * (lib/flow-triggers/normalize-text.ts), la MISMA normalización que ya usa
 * el Trigger Router.
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";
import type { EntidadesDetectadas } from "@/lib/bot-escenarios/tipos";

/** Vocabulario cerrado de español (función gramatical, no dato de negocio -- por eso vive en código). */
const AFIRMACIONES_CORTAS = [
  "si", "sii", "siii", "claro", "claro que si", "dale", "ok", "okay", "vale",
  "perfecto", "listo", "de una", "eso", "eso si", "por favor", "obvio",
];
const NEGACIONES_CORTAS = ["no", "no gracias", "nel", "no por ahora", "todavia no", "no por el momento"];

const PRESUPUESTO_PATTERNS = [
  /(?:maximo|max\.?|hasta|menos de)\s*\$?\s*([\d.,]+)\s*(mil|k)?/i,
  /\$\s*([\d.,]+)\s*(mil|k)?/i,
  /([\d.,]+)\s*(mil|k)\b/i,
];

function parseMontoCop(digitos: string, sufijo?: string): number {
  const limpio = digitos.replace(/[.,]/g, "");
  const base = Number(limpio);
  if (!Number.isFinite(base)) return NaN;
  if (sufijo && /mil|k/i.test(sufijo) && base < 10000) return base * 1000;
  return base;
}

function extraerPresupuestoMax(textoNormalizado: string): number | undefined {
  for (const pattern of PRESUPUESTO_PATTERNS) {
    const m = textoNormalizado.match(pattern);
    if (m) {
      const monto = parseMontoCop(m[1]!, m[2]);
      if (Number.isFinite(monto) && monto > 0) return monto;
    }
  }
  return undefined;
}

const DURACION_PATTERNS: Array<{ re: RegExp; minutos: (m: RegExpMatchArray) => number }> = [
  { re: /menos de\s*(\d+)\s*hora/i, minutos: (m) => Number(m[1]) * 60 },
  { re: /menos de\s*(\d+)\s*min/i, minutos: (m) => Number(m[1]) },
  { re: /(?:maximo|solo tengo|tengo)\s*(\d+)\s*hora/i, minutos: (m) => Number(m[1]) * 60 },
  { re: /(?:maximo|solo tengo|tengo)\s*(\d+)\s*min/i, minutos: (m) => Number(m[1]) },
  { re: /(?:tengo|solo tengo)\s*(?:solo\s*)?una hora/i, minutos: () => 60 },
  { re: /(?:tengo|solo tengo)\s*media hora/i, minutos: () => 30 },
];

function extraerDuracionMaxMin(textoNormalizado: string): number | undefined {
  for (const { re, minutos } of DURACION_PATTERNS) {
    const m = textoNormalizado.match(re);
    if (m) {
      const valor = minutos(m);
      if (Number.isFinite(valor) && valor > 0) return valor;
    }
  }
  return undefined;
}

/** Servicio real más específico (nombre más largo) cuyo nombre aparece dentro del mensaje. */
function detectarServicio(
  textoNormalizado: string,
  catalogo: ServicioCatalogoReal[],
): { id: string; nombre: string; categoria: string | null } | undefined {
  let mejor: ServicioCatalogoReal | undefined;
  for (const servicio of catalogo) {
    const nombreNormalizado = normalizeText(servicio.nombre);
    if (!nombreNormalizado) continue;
    if (textoNormalizado.includes(nombreNormalizado)) {
      if (!mejor || nombreNormalizado.length > normalizeText(mejor.nombre).length) mejor = servicio;
    }
  }
  return mejor ? { id: mejor.id, nombre: mejor.nombre, categoria: mejor.categoria } : undefined;
}

/** Categoría real (de las que existen en el catálogo) mencionada en el mensaje, vía sinónimos configurados por escenario. */
function detectarCategoria(
  textoNormalizado: string,
  categoriasReales: Set<string>,
  sinonimosPorCategoria: Map<string, string[]>,
): string | undefined {
  for (const [categoria, sinonimos] of sinonimosPorCategoria.entries()) {
    if (!categoriasReales.has(categoria)) continue;
    if (sinonimos.some((s) => textoNormalizado.includes(normalizeText(s)))) return categoria;
  }
  return undefined;
}

export function extraerEntidades(params: {
  mensaje: string;
  catalogo: ServicioCatalogoReal[];
  /** categoria real -> sinónimos configurados en dulabs_bot_escenarios (config.filtroNombreContiene de escenarios categoria_detectada). */
  sinonimosPorCategoria: Map<string, string[]>;
}): EntidadesDetectadas {
  const textoNormalizado = normalizeText(params.mensaje);
  const categoriasReales = new Set(
    params.catalogo.map((s) => s.categoria).filter((c): c is string => Boolean(c)),
  );

  const servicio = detectarServicio(textoNormalizado, params.catalogo);
  const categoria = detectarCategoria(textoNormalizado, categoriasReales, params.sinonimosPorCategoria) ?? servicio?.categoria ?? undefined;

  return {
    servicioId: servicio?.id,
    servicioNombre: servicio?.nombre,
    categoria: categoria ?? undefined,
    presupuestoMax: extraerPresupuestoMax(textoNormalizado),
    duracionMaxMin: extraerDuracionMaxMin(textoNormalizado),
    esAfirmacionCorta: AFIRMACIONES_CORTAS.some((a) => textoNormalizado === normalizeText(a)),
    esNegacionCorta: NEGACIONES_CORTAS.some((n) => textoNormalizado === normalizeText(n)),
  };
}
