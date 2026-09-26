/**
 * Bloque 29 — marca con la REFERENCIA del producto sobre sus fotos (módulo por negocio
 * `marca_referencia` en dulabs_tenant_modulos; apagado para todos por defecto).
 *
 * Para qué: si el cliente reenvía o hace captura de una foto del catálogo, la referencia viaja en
 * la imagen y puede escribirla ("DL-000123"); el agente nunca tiene que adivinar qué joya es.
 *
 * - Se aplica AL SERVIR (JPEG de WhatsApp y descarga desde el panel): el archivo original en Storage
 *   no se toca, así que la marca se cambia o se quita sin perder nada, y sirve para las fotos ya subidas.
 * - Las letras son TRAZOS VECTORIALES propios (no texto): no dependen de las fuentes del servidor
 *   (en Vercel no hay fuentes del sistema y un <text> en SVG saldría vacío o con cuadros).
 * - Esquina inferior derecha, en una etiqueta semitransparente, con un tamaño proporcional a la foto
 *   para que siga legible tras la compresión de WhatsApp sin tapar la pieza.
 */

type Punto = readonly [number, number];
type Trazo = readonly Punto[];

// Cuadrícula de 4 × 6 (y hacia abajo). Solo lo que puede tener una referencia (REFERENCE_PATTERN: A-Z, dígitos y guion).
const O: Trazo = [[1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0]];
const P: Trazo = [[0, 6], [0, 0], [3, 0], [4, 1], [4, 2.5], [3, 3.5], [0, 3.5]];
const GLIFOS: Readonly<Record<string, readonly Trazo[]>> = {
  "0": [O, [[3.5, 0.8], [0.5, 5.2]]],
  "1": [[[1, 1], [2, 0], [2, 6]], [[1, 6], [3, 6]]],
  "2": [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [0, 6], [4, 6]]],
  "3": [[[0, 0], [4, 0], [2, 2.5], [3, 2.5], [4, 3.5], [4, 5], [3, 6], [1, 6], [0, 5]]],
  "4": [[[3, 6], [3, 0], [0, 4], [4, 4]]],
  "5": [[[4, 0], [0, 0], [0, 2.5], [3, 2.5], [4, 3.5], [4, 5], [3, 6], [0, 6]]],
  "6": [[[3.5, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3.5], [3, 2.5], [0, 2.5]]],
  "7": [[[0, 0], [4, 0], [1.5, 6]]],
  "8": [[[1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0]], [[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3]]],
  "9": [[[4, 3.5], [1, 3.5], [0, 2.5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [0.5, 6]]],
  "-": [[[0.5, 3], [3.5, 3]]],
  A: [[[0, 6], [0, 1.5], [1.5, 0], [2.5, 0], [4, 1.5], [4, 6]], [[0, 3.5], [4, 3.5]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[0, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  C: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5]]],
  D: [[[0, 0], [0, 6], [2.5, 6], [4, 4.5], [4, 1.5], [2.5, 0], [0, 0]]],
  E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]],
  F: [[[4, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]],
  G: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3.5], [2.5, 3.5]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 0], [3, 0]], [[2, 0], [2, 6]], [[1, 6], [3, 6]]],
  J: [[[1, 0], [4, 0]], [[3, 0], [3, 5], [2, 6], [1, 6], [0, 5]]],
  K: [[[0, 0], [0, 6]], [[4, 0], [0, 3.5]], [[1.2, 2.8], [4, 6]]],
  L: [[[0, 0], [0, 6], [4, 6]]],
  M: [[[0, 6], [0, 0], [2, 3], [4, 0], [4, 6]]],
  N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
  O: [O],
  P: [P],
  Q: [O, [[2.5, 4.5], [4, 6]]],
  R: [P, [[2, 3.5], [4, 6]]],
  S: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 2], [1, 3], [3, 3], [4, 4], [4, 5], [3, 6], [1, 6], [0, 5]]],
  T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  U: [[[0, 0], [0, 5], [1, 6], [3, 6], [4, 5], [4, 0]]],
  V: [[[0, 0], [2, 6], [4, 0]]],
  W: [[[0, 0], [1, 6], [2, 3], [3, 6], [4, 0]]],
  X: [[[0, 0], [4, 6]], [[4, 0], [0, 6]]],
  Y: [[[0, 0], [2, 3], [4, 0]], [[2, 3], [2, 6]]],
  Z: [[[0, 0], [4, 0], [0, 6], [4, 6]]],
};

const AVANCE = 5.6; // ancho de un glifo (4) + espacio entre letras, en unidades de la cuadrícula
const ALTO = 6;

/** Texto que se estampa: solo caracteres con glifo (una referencia válida los tiene todos). */
export function textoDeMarca(reference: string): string {
  return [...reference.toUpperCase()].filter((c) => c in GLIFOS).join("").slice(0, 24);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * SVG del tamaño de la foto con la etiqueta de la referencia en la esquina inferior derecha.
 * Alto de las letras: 4 % del lado menor (entre 14 y 56 px). null si no hay nada que estampar.
 */
export function svgMarcaReferencia(width: number, height: number, reference: string): string | null {
  const texto = textoDeMarca(reference);
  if (!texto || width < 60 || height < 60) return null;
  const alto = Math.max(14, Math.min(56, Math.round(Math.min(width, height) * 0.04)));
  const u = alto / ALTO;
  const pad = alto * 0.5;
  const anchoTexto = (texto.length * AVANCE - (AVANCE - 4)) * u;
  const w = anchoTexto + pad * 2;
  const h = alto + pad * 2;
  const margen = alto * 0.6;
  const x0 = width - margen - w;
  const y0 = height - margen - h;
  if (x0 < 0 || y0 < 0) return null;
  const trazos: string[] = [];
  [...texto].forEach((c, i) => {
    const ox = x0 + pad + i * AVANCE * u;
    const oy = y0 + pad;
    for (const t of GLIFOS[c]) trazos.push(t.map(([x, y], j) => `${j === 0 ? "M" : "L"}${r1(ox + x * u)} ${r1(oy + y * u)}`).join(" "));
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="${r1(x0)}" y="${r1(y0)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(h / 2)}" fill="#000" fill-opacity="0.5"/>` +
    `<path d="${trazos.join(" ")}" fill="none" stroke="#fff" stroke-opacity="0.95" stroke-width="${r1(u * 0.85)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}
