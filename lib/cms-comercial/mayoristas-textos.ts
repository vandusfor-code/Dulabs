/**
 * CMS comercial — los TEXTOS del bloque «Compras por mayor» de la tienda de joyería (el del inicio y la banda de /mayoristas). PURO (sin I/O).
 *
 * La tienda trae sus textos de siempre (el registro de la tienda, `vitrina.ts`). Lo que la administradora publica en «Fotos y videos» los REEMPLAZA uno por uno: la etiqueta, el título, el texto corto, el
 * botón y el mensaje que llega al WhatsApp del negocio. Reglas que no se negocian:
 *   - un texto que no se publicó (o que llegó vacío) conserva el de siempre: nunca un hueco;
 *   - nada publicado => se devuelve EXACTAMENTE lo de siempre (la misma referencia: la tienda se ve idéntica a hoy);
 *   - solo se reemplaza un texto que la tienda YA tiene (no se inventan campos que su diseño no trae);
 *   - los textos son datos planos: solo se usan cadenas de los cinco campos conocidos.
 */
import { CAMPOS_TEXTO_MAYORISTAS, type CampoTextoMayoristas, type TextosMayoristas } from "@/lib/cms-comercial/contrato";
import type { MayoristasJoyeria } from "@/lib/catalogo/vitrina";

/** Los textos publicados que se pueden usar (todos o solo algunos). */
export type TextosMayoristasPublicados = Partial<Record<CampoTextoMayoristas, string>>;

/** Los textos con los que la tienda se ve hoy (los del registro de la tienda): el panel los muestra como «el de siempre» y permite volver a ellos. null si la tienda no tiene el bloque. */
export function textosDeSiempre(m: Pick<MayoristasJoyeria, CampoTextoMayoristas> | null | undefined): TextosMayoristas | null {
  if (!m) return null;
  return { etiqueta: m.etiqueta, titulo: m.titulo, texto: m.texto, boton: m.boton, mensaje: m.mensaje };
}

/** De lo publicado, solo las cadenas con contenido de los campos conocidos. undefined si no queda ninguna (lo demás se ignora: el contenido ya se validó al publicar, esto no depende de eso). */
export function textosPublicados(contenido: unknown): TextosMayoristasPublicados | undefined {
  if (typeof contenido !== "object" || contenido === null || Array.isArray(contenido)) return undefined;
  const salida: TextosMayoristasPublicados = {};
  for (const campo of CAMPOS_TEXTO_MAYORISTAS) {
    const valor = (contenido as Record<string, unknown>)[campo];
    if (typeof valor === "string" && valor.trim() !== "") salida[campo] = valor;
  }
  return Object.keys(salida).length > 0 ? salida : undefined;
}

/**
 * El bloque (o la página) de mayoristas con los textos que la administradora publicó en lugar de los de siempre. Solo cambia los campos que el bloque ya tiene y que de verdad cambian: sin ningún
 * cambio devuelve el MISMO objeto.
 */
export function aplicarTextosMayoristas<T extends Partial<Record<CampoTextoMayoristas, string>>>(m: T, textos: TextosMayoristasPublicados | undefined): T {
  if (!textos) return m;
  const sig: Record<string, unknown> = { ...m };
  let cambio = false;
  for (const campo of CAMPOS_TEXTO_MAYORISTAS) {
    const nuevo = textos[campo];
    if (typeof nuevo !== "string" || nuevo.trim() === "" || !(campo in m) || m[campo] === nuevo) continue;
    sig[campo] = nuevo;
    cambio = true;
  }
  return cambio ? (sig as T) : m;
}
