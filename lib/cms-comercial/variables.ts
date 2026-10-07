/**
 * CMS comercial — VARIABLES CONTROLADAS de los textos. PURO.
 *
 * Un dato comercial que ya existe en la configuración del negocio (el mínimo de la compra inicial mayorista, la dirección de la tienda, el nombre) NO se
 * escribe a mano en un texto: se escribe `{{minimo_mayorista}}` y el backend lo reemplaza al entregarlo. Así el número existe una sola vez y ningún texto
 * puede contradecirlo (única fuente de verdad).
 *
 * La lista es CERRADA. Una variable desconocida, o una conocida cuyo valor el negocio no configuró, hace que el texto NO se entregue (jamás sale con las
 * llaves a la vista ni con un valor inventado) y que no se pueda publicar.
 */

export const VARIABLES = ["minimo_mayorista", "direccion_tienda", "nombre_negocio"] as const;
export type VariableId = (typeof VARIABLES)[number];

/** Valores ya formateados para mostrar (p. ej. «$750.000»). Una variable sin valor no está configurada. */
export type ValoresVariables = Partial<Record<VariableId, string>>;

const RE_VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Todas las variables escritas en un texto (en orden, sin repetir), conocidas o no. */
export function variablesEn(texto: string): string[] {
  const vistas = new Set<string>();
  for (const m of texto.matchAll(RE_VARIABLE)) vistas.add(m[1]);
  return [...vistas];
}

export const esVariable = (nombre: string): nombre is VariableId => (VARIABLES as readonly string[]).includes(nombre);

/** Formato de pesos colombianos para una variable monetaria: $750.000 */
export function formatearPesos(valor: number): string {
  return `$${Math.round(valor).toLocaleString("es-CO")}`;
}

export type ResultadoVariables = { ok: true; texto: string } | { ok: false; desconocidas: string[]; sinValor: VariableId[] };

/**
 * Reemplaza las variables de un texto. Fail-closed: si alguna es desconocida o no tiene valor, devuelve el detalle y NO un texto parcial.
 * Un valor que contenga llaves se rechaza (un valor no puede introducir otra variable ni confundir a quien lo lea).
 */
export function resolverVariables(texto: string, valores: ValoresVariables): ResultadoVariables {
  const desconocidas: string[] = [];
  const sinValor: VariableId[] = [];
  for (const nombre of variablesEn(texto)) {
    if (!esVariable(nombre)) desconocidas.push(nombre);
    else if (typeof valores[nombre] !== "string" || valores[nombre] === "" || /[{}]/.test(valores[nombre])) sinValor.push(nombre);
  }
  if (desconocidas.length > 0 || sinValor.length > 0) return { ok: false, desconocidas, sinValor };
  return { ok: true, texto: texto.replace(RE_VARIABLE, (_todo, nombre: string) => valores[nombre as VariableId] as string) };
}

/** ¿Escribió a mano el valor de una variable monetaria (p. ej. «750.000» o «$750000») en vez de usar la variable? */
export function escribioMontoAMano(texto: string, monto: number): boolean {
  const miles = Math.round(monto).toLocaleString("es-CO"); // 750.000
  const crudo = String(Math.round(monto)); // 750000
  const limpio = texto.replace(/\{\{[^{}]*\}\}/g, " ");
  return new RegExp(`(?<![\\d.,])(?:${escapar(miles)}|${escapar(crudo)})(?!\\d|[.,]\\d)`).test(limpio);
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
