/**
 * CMS comercial — la PÁGINA «Mayoristas» de la tienda pública (tema "joyeria", /catalogo/{tienda}/mayoristas). PURO: sin I/O.
 *
 * Qué muestra: lo PUBLICADO en el CMS (Tienda → Contenido) con tema «Mayoristas» para el público de la tienda al detal. Usa las mismas reglas que ARIA porque usa la misma función
 * (`contenidosPara`): la audiencia debe incluir al cliente (un texto «mayorista» JAMÁS llega a esta página), el texto debe estar vigente y todas sus variables ({{minimo_mayorista}}…) deben
 * poder resolverse (si no, ese texto no se muestra). Un dato (el mínimo, los envíos, los pagos) se escribe UNA vez en el CMS y lo ven la página y ARIA.
 *
 * La configuración de la tienda solo decide la FORMA, nunca los datos: cuál entrada hace de introducción (se muestra bajo el título), cuáles NO son para clientes (por ejemplo un texto
 * escrito como instrucción para ARIA) y qué entradas de OTROS temas (envíos, pagos, garantías…) acompañan a las preguntas, por su código. Sin nada publicado la página no inventa nada:
 * quedan el título y el botón de WhatsApp.
 */
import type { TemaContenido } from "@/lib/cms-comercial/contrato";
import { contenidosPara, type VistaContenido } from "@/lib/cms-comercial/evaluacion";
import type { VariablesNegocio } from "@/lib/cms-comercial/puertos";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";

/** El tema de las entradas que forman la página. */
export const TEMA_PAGINA_MAYORISTAS: TemaContenido = "mayoristas";

export interface OpcionesPaginaMayoristas {
  /** Código de la entrada que hace de introducción bajo el título (si no está publicada, la página usa el texto de la tienda). */
  intro?: string;
  /** Códigos de entradas del tema «Mayoristas» que NO se muestran (p. ej. un texto escrito como instrucción para ARIA, no para clientes). */
  omitir?: readonly string[];
  /** Códigos de entradas de OTROS temas (envíos, pagos, garantías…) que se suman al final de las preguntas, en este orden. Solo si están publicadas y aplican al público. */
  tambien?: readonly string[];
}

export interface PreguntaMayoristas {
  /** Código público de la entrada (clave de lista y ancla). */
  clave: string;
  /** La pregunta o el título del tema. */
  titulo: string;
  /** La respuesta, con las variables ya reemplazadas. */
  texto: string;
}

export interface PaginaMayoristas {
  intro: { titulo: string; texto: string } | null;
  preguntas: PreguntaMayoristas[];
}

const vista = (v: VistaContenido): PreguntaMayoristas => ({ clave: v.clave, titulo: v.titulo, texto: v.texto });

/**
 * Arma lo que muestra la página. `ahora` en milisegundos (reloj inyectado). El canal es SIEMPRE el del público de la tienda al detal: esta página nunca se arma para un cliente mayorista.
 * No altera lo que recibe.
 */
export function paginaMayoristas(snap: InstantaneaCms, negocio: VariablesNegocio, ahora: number, opciones: OpcionesPaginaMayoristas = {}): PaginaMayoristas {
  const { items } = contenidosPara({ snap, canal: "retail", ahora }, negocio.variables);
  const omitir = new Set(opciones.omitir ?? []);
  const introduccion = opciones.intro ? (items.find((i) => i.clave === opciones.intro) ?? null) : null;
  const usadas = new Set<string>(introduccion ? [introduccion.clave] : []);

  const preguntas: PreguntaMayoristas[] = [];
  for (const i of items) {
    if (i.tema !== TEMA_PAGINA_MAYORISTAS || usadas.has(i.clave) || omitir.has(i.clave)) continue;
    usadas.add(i.clave);
    preguntas.push(vista(i));
  }
  for (const clave of opciones.tambien ?? []) {
    if (usadas.has(clave) || omitir.has(clave)) continue;
    const i = items.find((x) => x.clave === clave);
    if (!i) continue;
    usadas.add(clave);
    preguntas.push(vista(i));
  }

  return { intro: introduccion ? { titulo: introduccion.titulo, texto: introduccion.texto } : null, preguntas };
}

/** Un texto del CMS en párrafos: una línea en blanco (o un salto de línea) separa uno de otro; nunca queda un párrafo vacío. */
export function parrafosDe(texto: string): string[] {
  return texto
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}
