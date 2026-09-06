/**
 * Extracción de entidades 100% determinista (nunca IA) para el banco de
 * escenarios -- ver lib/bot-escenarios/tipos.ts. Reutiliza normalizeText
 * (lib/flow-triggers/normalize-text.ts), la MISMA normalización que ya usa
 * el Trigger Router, para TODO excepto la detección de servicio puntual
 * (ver nota en normalizarPreservandoEnie).
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

/**
 * BUG REAL encontrado (prueba real de WhatsApp, autorizado) — normalizeText
 * (lib/flow-triggers/normalize-text.ts) descompone "ñ" en "n" (NFD +
 * remoción de marcas combinantes), así que "Uña" y "uñas" normalizan a
 * "una"/"unas" -- "una" además COLISIONA con el artículo indefinido español
 * ("quiero una cita"). Detectar el servicio "Uña" por simple substring sobre
 * ese texto hacía que CUALQUIER mención de la categoría "uñas" (plural)
 * resolviera automáticamente al servicio puntual "Uña" (singular), porque
 * "unas" contiene "una" como prefijo.
 *
 * Esta normalización alterna preserva "ñ" como letra propia (nunca la
 * convierte en "n") y solo pliega los demás acentos vocálicos -- así "uña"
 * y "unas"/"una" dejan de colisionar. Se usa EXCLUSIVAMENTE para resolver
 * qué servicio puntual del catálogo aparece en el mensaje; el resto del
 * motor (categorías, FAQ, escenarios generales) sigue usando normalizeText
 * sin cambios, para no alterar ningún comportamiento ya probado.
 */
function normalizarPreservandoEnie(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/\s+/g, " ");
}

/** Tokeniza en palabras reales (letras + ñ), sin cortar "ñ" a la mitad como haría \b en JS (ASCII-only). */
function tokenizarPalabras(texto: string): string[] {
  return texto.match(/[a-z0-9ñ]+/g) ?? [];
}

/** true si `frase` (ya tokenizada) aparece como subsecuencia CONTIGUA dentro de `texto` (ya tokenizado). */
function contieneSecuencia(tokensTexto: string[], tokensFrase: string[]): boolean {
  if (tokensFrase.length === 0) return false;
  for (let i = 0; i <= tokensTexto.length - tokensFrase.length; i++) {
    if (tokensFrase.every((t, j) => tokensTexto[i + j] === t)) return true;
  }
  return false;
}

/**
 * TODOS los servicios reales cuyo nombre aparece como palabra(s) completa(s)
 * dentro del mensaje (nunca como substring de una palabra más larga -- ver
 * normalizarPreservandoEnie arriba). Ordenados por aparición en el texto,
 * sin duplicados. Necesario para detectar comparaciones ("Dipping vs Press
 * On" debe encontrar AMBOS, no solo el de nombre más largo).
 */
function detectarTodosLosServicios(
  mensaje: string,
  catalogo: ServicioCatalogoReal[],
): Array<{ id: string; nombre: string; categoria: string | null; posicion: number }> {
  const tokensTexto = tokenizarPalabras(normalizarPreservandoEnie(mensaje));
  const encontrados: Array<{ id: string; nombre: string; categoria: string | null; posicion: number }> = [];

  for (const servicio of catalogo) {
    const tokensNombre = tokenizarPalabras(normalizarPreservandoEnie(servicio.nombre));
    if (tokensNombre.length === 0) continue;
    if (contieneSecuencia(tokensTexto, tokensNombre)) {
      const posicion = tokensTexto.findIndex((_, i) => tokensNombre.every((t, j) => tokensTexto[i + j] === t));
      encontrados.push({ id: servicio.id, nombre: servicio.nombre, categoria: servicio.categoria, posicion });
    }
  }

  // Si un servicio es substring de nombres de OTRO servicio más largo YA
  // encontrado en la MISMA posición (ej. catálogos con "Manos" y "Caballero
  // Manos Semi"), se prefiere el más específico -- nunca se reporta el mismo
  // fragmento de texto como dos servicios distintos.
  const sinSolapados = encontrados.filter((a) => !encontrados.some((b) => b !== a && b.posicion === a.posicion && b.nombre.length > a.nombre.length));

  return sinSolapados.sort((a, b) => a.posicion - b.posicion);
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

  const serviciosDetectados = detectarTodosLosServicios(params.mensaje, params.catalogo).map((s) => ({
    id: s.id,
    nombre: s.nombre,
    categoria: s.categoria,
  }));
  // servicioId/servicioNombre solo se llenan cuando hay EXACTAMENTE un
  // servicio puntual real en el mensaje -- con 0 (nada real mencionado) o 2+
  // (comparación) queda vacío a propósito, para que resolver.ts nunca
  // resuelva por accidente al primero como si fuera la única intención.
  const servicioUnico = serviciosDetectados.length === 1 ? serviciosDetectados[0] : undefined;
  const categoria = detectarCategoria(textoNormalizado, categoriasReales, params.sinonimosPorCategoria) ?? servicioUnico?.categoria ?? undefined;

  return {
    servicioId: servicioUnico?.id,
    servicioNombre: servicioUnico?.nombre,
    serviciosDetectados,
    categoria: categoria ?? undefined,
    presupuestoMax: extraerPresupuestoMax(textoNormalizado),
    duracionMaxMin: extraerDuracionMaxMin(textoNormalizado),
    esAfirmacionCorta: AFIRMACIONES_CORTAS.some((a) => textoNormalizado === normalizeText(a)),
    esNegacionCorta: NEGACIONES_CORTAS.some((n) => textoNormalizado === normalizeText(n)),
  };
}
