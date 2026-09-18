// DuLabs Business — Agent Compiler (Fase 1), Pilar 1.
//
// Extractor de catálogo DETERMINISTA (sin LLM): convierte el texto comercial
// (prompt + conocimiento) en ExtractedCatalogItem[] con trazabilidad
// (sourceEvidence), detectando ambigüedad, duplicados, moneda inválida y
// precio ausente. El LLM NUNCA es la fuente de verdad de precios; esta capa
// produce los datos que luego se persisten en las tablas estructuradas
// existentes (dulabs_servicios / dulabs_inventario_productos).

import type {
  CatalogExtractionResult,
  CatalogItemType,
  CompilerInput,
  CompilerIssue,
  ExtractedCatalogItem,
} from "@/lib/agent-compiler/types";

const MONEDA_CANONICA = "COP";
const DURACION_MIN_DEFECTO = 60; // dulabs_servicios.duracion_min es NOT NULL > 0

/** Quita acentos y normaliza para comparar nombres (nunca para mostrar). */
function normalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Limpia viñetas/numeración inicial y espacios de un nombre de ítem. */
function limpiarNombre(bruto: string): string {
  return bruto
    .replace(/^[\s]*[-*•·►▪◦]\s*/, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

type MonedaDetectada = { moneda: string; canonica: boolean };

/** Detecta la moneda de un fragmento. COP por defecto (símbolo $ o "pesos"). */
function detectarMoneda(fragmento: string): MonedaDetectada {
  const f = fragmento.toLowerCase();
  if (/\b(usd|us\$|d[oó]lar(?:es)?)\b/.test(f) || /us\$/.test(f)) return { moneda: "USD", canonica: false };
  if (/€|\beur\b/.test(f)) return { moneda: "EUR", canonica: false };
  if (/£|\bgbp\b/.test(f)) return { moneda: "GBP", canonica: false };
  // $ solo, "cop" o "pesos" => COP (moneda del negocio).
  return { moneda: MONEDA_CANONICA, canonica: true };
}

type MontoParseado = { amount: number; moneda: MonedaDetectada; evidence: string };

/**
 * Extrae el PRIMER monto de una cadena. COP no tiene decimales, así que puntos
 * y comas se tratan como separadores de miles y se eliminan. Devuelve null si
 * no hay un número monetario reconocible.
 */
function parsearMonto(texto: string): MontoParseado | null {
  // Itera TODOS los números y devuelve el primero con SEÑAL monetaria (símbolo,
  // sufijo de moneda, separador de miles o >= 4 dígitos). Así "Paquete 1:
  // $350.000" no se queda con el "1" del nombre, sino con "$350.000".
  const re = /(us\$|\$|€|£)?\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,}|\d+)\s?(cop|usd|eur|gbp|pesos|d[oó]lares?)?/gi;
  for (const m of texto.matchAll(re)) {
    const simbolo = m[1] ?? "";
    const digitos = m[2] ?? "";
    const sufijo = m[3] ?? "";
    const teniaSeparador = /[.,]/.test(digitos);
    const soloDigitos = digitos.replace(/[.,\s]/g, "");
    const amount = Number.parseInt(soloDigitos, 10);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const haySenalMonetaria = Boolean(simbolo || sufijo || teniaSeparador || soloDigitos.length >= 4);
    if (!haySenalMonetaria) continue; // ej. el "1" de "Paquete 1", "2 horas"
    return { amount, moneda: detectarMoneda(`${simbolo} ${sufijo}`), evidence: m[0].trim() };
  }
  return null;
}

/** Separa una línea en {nombre, resto tras el delimitador, monto}. */
type LineaParseada = {
  original: string;
  nombre: string;
  tieneDelimitador: boolean;
  /** true si tras el delimitador no hay contenido (precio olvidado). */
  restoVacio: boolean;
  monto: MontoParseado | null;
};

const DELIMITADOR = /[:=–—]|(?:\s-\s)|→|\.\.\.+/;

function parsearLinea(linea: string): LineaParseada | null {
  const original = linea.trim();
  if (!original) return null;
  const monto = parsearMonto(original);

  // Nombre = lo que está antes del delimitador o del monto.
  let nombre = original;
  let restoVacio = false;
  const mDelim = DELIMITADOR.exec(original);
  if (mDelim) {
    nombre = original.slice(0, mDelim.index);
    restoVacio = original.slice(mDelim.index + mDelim[0].length).trim() === "";
  } else if (monto) {
    nombre = original.slice(0, original.indexOf(monto.evidence));
  }
  nombre = limpiarNombre(nombre);

  return { original, nombre, tieneDelimitador: Boolean(mDelim), restoVacio, monto };
}

/** ¿Parece el nombre de un ítem de catálogo (no una oración de prosa)? */
function pareceNombreDeItem(nombre: string): boolean {
  if (nombre.length < 2 || nombre.length > 70) return false;
  // Prosa: demasiadas palabras o termina en signos de oración.
  const palabras = nombre.split(/\s+/).length;
  if (palabras > 8) return false;
  if (/[.!?]$/.test(nombre)) return false;
  return true;
}

function issue(code: CompilerIssue["code"], severity: CompilerIssue["severity"], message: string, evidence?: string): CompilerIssue {
  return { code, severity, message, evidence };
}

export interface OpcionesExtraccion {
  tipoPorDefecto?: CatalogItemType;
}

/**
 * Extrae el catálogo del prompt + conocimiento. Determinista y sin efectos
 * secundarios (no persiste). La persistencia idempotente es un paso aparte.
 */
export function extraerCatalogo(input: CompilerInput, opciones: OpcionesExtraccion = {}): CatalogExtractionResult {
  const tipoPorDefecto: CatalogItemType = opciones.tipoPorDefecto ?? input.config?.defaultCatalogType ?? "service";
  const texto = [input.prompt ?? "", input.knowledge ?? ""].join("\n");
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const issues: CompilerIssue[] = [];
  const items: ExtractedCatalogItem[] = [];
  const nombresCandidatos: string[] = []; // todo nombre-de-ítem visto (con o sin precio)

  for (const linea of lineas) {
    const p = parsearLinea(linea);
    if (!p) continue;
    if (p.nombre && pareceNombreDeItem(p.nombre)) nombresCandidatos.push(p.nombre);

    if (p.monto) {
      if (!pareceNombreDeItem(p.nombre)) continue; // hay un número pero no es una línea de catálogo
      if (!p.monto.moneda.canonica) {
        issues.push(
          issue("CATALOG_INVALID_CURRENCY", "block", `Moneda no soportada (${p.monto.moneda.moneda}) para "${p.nombre}". El catálogo se persiste en COP; convierte o corrige.`, p.original),
        );
        continue; // no se persiste un precio en moneda no canónica
      }
      items.push({
        name: p.nombre,
        type: tipoPorDefecto,
        currency: MONEDA_CANONICA,
        priceCop: p.monto.amount,
        durationMin: tipoPorDefecto === "service" ? DURACION_MIN_DEFECTO : undefined,
        sourceEvidence: p.original,
        confidence: /\$|cop|pesos/i.test(p.original) ? 0.95 : 0.8,
      });
    } else if (p.tieneDelimitador && p.restoVacio && pareceNombreDeItem(p.nombre)) {
      // Nombre + delimitador con lado derecho VACÍO => precio olvidado. Si hay
      // texto tras el delimitador (config, "consultar", prosa) NO se marca, para
      // no bloquear por falsos positivos.
      issues.push(
        issue("CATALOG_ITEM_MISSING_PRICE", "block", `"${p.nombre}" parece un ítem de catálogo pero no tiene un precio.`, p.original),
      );
    }
  }

  // --- Duplicados: mismo nombre normalizado => conservar el primero, marcar.
  const vistos = new Map<string, ExtractedCatalogItem>();
  const deduplicados: ExtractedCatalogItem[] = [];
  for (const it of items) {
    const clave = `${it.type}:${normalizarNombre(it.name)}`;
    const previo = vistos.get(clave);
    if (previo) {
      issues.push(
        issue("CATALOG_DUPLICATE_ITEM", "block", `Ítem duplicado "${it.name}" (${previo.priceCop ?? "?"} vs ${it.priceCop ?? "?"}). Resuelve el duplicado antes de publicar.`, it.sourceEvidence),
      );
      continue;
    }
    vistos.set(clave, it);
    deduplicados.push(it);
  }

  // --- Ambigüedad: un ítem GENERAL con precio que tiene >=2 variantes más
  //     específicas (mismo prefijo + palabra extra). precisión > automatización.
  for (const it of deduplicados) {
    const base = normalizarNombre(it.name);
    const variantes = nombresCandidatos.filter((n) => {
      const nn = normalizarNombre(n);
      return nn !== base && nn.startsWith(base + " ");
    });
    const variantesUnicas = new Set(variantes.map(normalizarNombre));
    if (variantesUnicas.size >= 2) {
      issues.push(
        issue("AMBIGUOUS_CATALOG_ITEM", "block", `"${it.name}" es ambiguo: existen variantes más específicas (${[...variantesUnicas].join(", ")}). Asigna el precio a la variante correcta.`, it.sourceEvidence),
      );
    }
  }

  if (deduplicados.length === 0 && !issues.some((i) => i.code !== "CATALOG_EMPTY")) {
    issues.push(issue("CATALOG_EMPTY", "warn", "No se extrajo ningún ítem de catálogo con precio del texto proporcionado."));
  }

  return { items: deduplicados, issues };
}
