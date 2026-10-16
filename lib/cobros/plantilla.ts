/**
 * Plantilla de Meta `pendiente_pago` (es_CO, categoría Utilidad), la del recordatorio de pago:
 *   «Hola, {nombre} 👋 ⚠️ Tu Agente IA está desactivado debido al vencimiento de tu suscripción. 💳 Para reactivarlo, recuerda realizar el pago de tu mensualidad por ${monto} …»
 *
 * Lógica PURA (sin red): decide qué valor va en cada variable. No se asume cómo la creó el negocio en Meta: puede usar variables numéricas ({{1}}, {{2}}) o con nombre
 * ({{nombre}}, {{monto}}) y el «$» puede estar en el texto o en el valor. Se lee la plantilla REAL antes de cada envío y, si no calza con «nombre + monto», NO se manda nada.
 */
export const PLANTILLA_PENDIENTE_PAGO = { nombre: "pendiente_pago", idioma: "es_CO" } as const;

const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const PISTAS_MONTO = /(monto|valor|precio|mensualidad|pago|importe|amount|price|total|cobro)/i;
const PISTAS_NOMBRE = /(nombre|name|cliente|negocio|empresa)/i;

/** 39990 → "39.990" (puntos de miles, sin decimales: así se escribe el dinero en Colombia). */
export function formatearMontoCop(monto: number): string {
  return String(Math.round(monto)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Un valor de variable de plantilla no admite saltos de línea ni tabuladores, ni espacios repetidos (Meta rechaza el envío con #132018). */
export function limpiarValorVariable(texto: string, maximo = 60): string {
  return texto.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, maximo).trim();
}

/** Variables distintas del cuerpo, en orden de aparición, con la posición de su primera aparición. */
export function variablesDelCuerpo(cuerpo: string): { nombre: string; indice: number }[] {
  const vistas = new Set<string>();
  const resultado: { nombre: string; indice: number }[] = [];
  for (const m of cuerpo.matchAll(VARIABLE)) {
    const nombre = m[1]!;
    if (vistas.has(nombre)) continue;
    vistas.add(nombre);
    resultado.push({ nombre, indice: m.index ?? 0 });
  }
  return resultado;
}

export type ParametrosPlantilla =
  | { ok: true; tipo: "posicionales"; valores: string[]; resumen: string }
  | { ok: true; tipo: "nombrados"; variables: { nombre: string; valor: string }[]; resumen: string }
  | { ok: false; motivo: "variables_no_coinciden"; detalle: string };

export function resolverParametrosPlantilla(cuerpo: string, datos: { nombre: string; montoCop: number }): ParametrosPlantilla {
  const variables = variablesDelCuerpo(cuerpo);
  if (variables.length !== 2) {
    return { ok: false, motivo: "variables_no_coinciden", detalle: `la plantilla tiene ${variables.length} variable(s) y se esperaban 2 (nombre y monto)` };
  }

  const numericas = variables.every((v) => /^\d+$/.test(v.nombre));
  let idxMonto: number;
  if (numericas) {
    // {{1}} = nombre, {{2}} = monto, sin importar en qué orden aparezcan en el texto.
    idxMonto = Number(variables[0]!.nombre) > Number(variables[1]!.nombre) ? 0 : 1;
  } else {
    const monto = variables.map((v) => PISTAS_MONTO.test(v.nombre) && !PISTAS_NOMBRE.test(v.nombre));
    const nombre = variables.map((v) => PISTAS_NOMBRE.test(v.nombre) && !PISTAS_MONTO.test(v.nombre));
    if (monto[0] !== monto[1]) idxMonto = monto[0] ? 0 : 1;
    else if (nombre[0] !== nombre[1]) idxMonto = nombre[0] ? 1 : 0;
    else idxMonto = 1; // sin pistas en los nombres: primero el nombre, después el monto
  }
  const nombreNegocio = limpiarValorVariable(datos.nombre) || "tu negocio";
  // Si el «$» ya está escrito justo antes de la variable en la plantilla, el valor va solo con el número; si no, el valor lleva el «$».
  const antesDelMonto = cuerpo.slice(0, variables[idxMonto]!.indice).trimEnd();
  const montoTexto = antesDelMonto.endsWith("$") ? formatearMontoCop(datos.montoCop) : `$${formatearMontoCop(datos.montoCop)}`;
  const valorDe = (i: number) => (i === idxMonto ? montoTexto : nombreNegocio);
  const resumen = `nombre=${nombreNegocio} · monto=${montoTexto}`;

  if (numericas) {
    const ordenadas = [...variables].sort((a, b) => Number(a.nombre) - Number(b.nombre));
    return { ok: true, tipo: "posicionales", valores: ordenadas.map((v) => valorDe(variables.indexOf(v))), resumen };
  }
  return { ok: true, tipo: "nombrados", variables: variables.map((v, i) => ({ nombre: v.nombre, valor: valorDe(i) })), resumen };
}
