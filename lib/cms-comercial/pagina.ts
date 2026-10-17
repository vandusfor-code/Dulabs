/**
 * CMS comercial — las PÁGINAS de la tienda pública (tema "joyeria"): política de privacidad, términos y condiciones, cambios y garantías… escritas por la administradora dentro de su tienda. PURO: sin I/O.
 *
 * Una página se escribe como se escribe un mensaje: una línea en blanco separa los párrafos, «## » al principio de una línea hace un subtítulo y «- » al principio de una línea, un elemento de lista.
 * Aquí ese texto se convierte en BLOQUES —lo que se guarda en el CMS y lo que dibuja la tienda— y de vuelta. Lo publicado es estructura de texto plano, nunca HTML: lo que parezca una etiqueta se
 * rechaza al guardar y React lo mostraría como texto de todos modos.
 */
import { bloquePaginaSchema, caracteresDePagina, MAX_BLOQUES_PAGINA, MAX_CARACTERES_PAGINA, MAX_PAGINAS_EN_MENU, MENSAJE_PAGINA_CON_MUCHOS_BLOQUES, MENSAJE_PAGINA_LARGA, textoDeMenuDePagina, type BloquePagina } from "@/lib/cms-comercial/esquemas";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";

/** Las páginas viven bajo /catalogo/{tienda}/p/{código}. */
export const SEGMENTO_PAGINAS = "p";
export const rutaPagina = (basePath: string, clave: string): string => `${basePath}/${SEGMENTO_PAGINAS}/${clave}`;

/** ¿Es un código de página válido (el mismo formato que exige la base de datos para cualquier elemento)? Se comprueba antes de buscar nada. */
export const esClavePagina = (valor: string): boolean => /^[a-z0-9][a-z0-9-]{0,79}$/.test(valor);

const SUBTITULO = /^#{1,3}[ \t]+(\S.*)$/;
const ELEMENTO = /^[ \t]*[-•*][ \t]+(\S.*)$/;

/**
 * El texto que escribió la administradora → bloques. Línea a línea: una línea en blanco cierra lo que se estaba armando; «## algo» es un subtítulo; «- algo» (o «• algo», «* algo») un elemento de lista
 * (los seguidos forman UNA lista); el resto son párrafos (varias líneas seguidas, sin línea en blanco, quedan en el mismo párrafo con su salto de línea). No altera la entrada.
 */
export function bloquesDeTexto(entrada: string): BloquePagina[] {
  const bloques: BloquePagina[] = [];
  let parrafo: string[] = [];
  let elementos: string[] = [];
  const cerrarParrafo = () => {
    if (parrafo.length > 0) bloques.push({ tipo: "parrafo", texto: parrafo.join("\n") });
    parrafo = [];
  };
  const cerrarLista = () => {
    if (elementos.length > 0) bloques.push({ tipo: "lista", items: elementos });
    elementos = [];
  };
  for (const cruda of entrada.replace(/\r\n?/g, "\n").split("\n")) {
    const linea = cruda.replace(/[ \t]+$/, "");
    if (linea.trim() === "") {
      cerrarParrafo();
      cerrarLista();
      continue;
    }
    const subtitulo = SUBTITULO.exec(linea);
    if (subtitulo) {
      cerrarParrafo();
      cerrarLista();
      bloques.push({ tipo: "subtitulo", texto: subtitulo[1].trim() });
      continue;
    }
    const elemento = ELEMENTO.exec(linea);
    if (elemento) {
      cerrarParrafo();
      elementos.push(elemento[1].trim());
      continue;
    }
    cerrarLista();
    parrafo.push(linea.trim());
  }
  cerrarParrafo();
  cerrarLista();
  return bloques;
}

/** Los bloques → el texto con el que se edita (lo inverso de `bloquesDeTexto`): una línea en blanco entre bloque y bloque. */
export function textoDeBloques(bloques: readonly BloquePagina[]): string {
  return bloques
    .map((b) => {
      if (b.tipo === "subtitulo") return `## ${b.texto}`;
      if (b.tipo === "parrafo") return b.texto;
      return b.items.map((i) => `- ${i}`).join("\n");
    })
    .join("\n\n");
}

/** El comienzo de un bloque, para decirle a la administradora de cuál se trata sin hacerla contar bloques: «Cuando tu pedido llega…». */
export function inicioDeBloque(b: BloquePagina): string {
  const texto = (b.tipo === "lista" ? (b.items[0] ?? "") : b.texto).replace(/\s+/g, " ").trim();
  return texto.length > 40 ? `${texto.slice(0, 40).trimEnd()}…` : texto;
}

/**
 * Los problemas del texto que se está escribiendo, ya en lenguaje de la administradora y con el comienzo del bloque que los causa. Usa el MISMO esquema con el que se valida al publicar, así que no hay
 * dos reglas que puedan diferir; el panel los muestra mientras escribe, antes de «Revisar». Vacío = nada que corregir.
 */
export function problemasDeBloques(bloques: readonly BloquePagina[]): string[] {
  const problemas: string[] = [];
  if (bloques.length > MAX_BLOQUES_PAGINA) problemas.push(MENSAJE_PAGINA_CON_MUCHOS_BLOQUES);
  if (caracteresDePagina(bloques) > MAX_CARACTERES_PAGINA) problemas.push(MENSAJE_PAGINA_LARGA);
  for (const b of bloques) {
    const r = bloquePaginaSchema.safeParse(b);
    if (r.success) continue;
    for (const mensaje of new Set(r.error.issues.map((x) => x.message))) problemas.push(`«${inicioDeBloque(b)}»: ${mensaje}`);
  }
  return problemas;
}

/**
 * Los bloques de un borrador, tolerando lo que no sea un bloque (el borrador puede estar incompleto o venir de otra herramienta): lo que no tenga la forma de un subtítulo, un párrafo o una lista se
 * deja fuera, sin romper el formulario. Nunca devuelve un bloque con campos de más.
 */
export function bloquesDeBorrador(valor: unknown): BloquePagina[] {
  if (!Array.isArray(valor)) return [];
  const salida: BloquePagina[] = [];
  for (const b of valor) {
    if (typeof b !== "object" || b === null) continue;
    const { tipo, texto, items } = b as { tipo?: unknown; texto?: unknown; items?: unknown };
    if ((tipo === "subtitulo" || tipo === "parrafo") && typeof texto === "string") salida.push({ tipo, texto });
    else if (tipo === "lista" && Array.isArray(items) && items.every((i) => typeof i === "string")) salida.push({ tipo: "lista", items: items as string[] });
  }
  return salida;
}

/** ¿Dos listas de bloques dicen lo mismo? (por lo que dicen, no por el orden interno de sus claves) */
export const mismosBloques = (a: readonly BloquePagina[], b: readonly BloquePagina[]): boolean => a.length === b.length && a.every((x, i) => huellaDe(x) === huellaDe(b[i]));

/** Cómo se reconoce un bloque al comparar dos versiones de una página: por lo que dice (no por el orden interno de sus claves). */
const huellaDe = (b: BloquePagina): string => (b.tipo === "lista" ? `lista\u0000${b.items.join("\u0001")}` : `${b.tipo}\u0000${b.texto}`);

/**
 * Qué cambió entre dos versiones del texto de una página, dicho para el historial y para el diálogo de publicar: «12 bloques → 13 bloques, 2 con cambios». null = es el mismo texto. Un bloque «con cambios»
 * es uno que se agregó, se quitó o se modificó (se compara lo que dice cada bloque, no su posición: insertar un párrafo al principio no hace que parezca que todo cambió).
 */
export function resumenDeCambiosDeBloques(antes: readonly BloquePagina[] | null | undefined, despues: readonly BloquePagina[] | null | undefined): { antes: string; despues: string } | null {
  const a = (antes ?? []).map(huellaDe);
  const d = (despues ?? []).map(huellaDe);
  // Subsucesión común más larga: lo que se conserva, en el mismo orden.
  const tabla: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(d.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = d.length - 1; j >= 0; j--) tabla[i][j] = a[i] === d[j] ? tabla[i + 1][j + 1] + 1 : Math.max(tabla[i + 1][j], tabla[i][j + 1]);
  const iguales = tabla[0][0];
  const quitados = a.length - iguales;
  const nuevos = d.length - iguales;
  if (quitados === 0 && nuevos === 0) return null;
  const cambiados = Math.max(quitados, nuevos);
  const bloquesDe = (n: number) => (n === 0 ? "—" : n === 1 ? "1 bloque" : `${n} bloques`);
  return { antes: bloquesDe(a.length), despues: `${bloquesDe(d.length)}, ${cambiados} con cambios` };
}

/** Lo que dibuja la tienda de una página publicada. */
export interface PaginaVista {
  clave: string;
  titulo: string;
  bloques: readonly BloquePagina[];
  /** Cuándo se publicó la versión que se está mostrando (ISO). */
  actualizadaAt: string;
}

/** La página publicada con ese código, o null si no hay (nunca publicada, pausada, despublicada o archivada: para la tienda no existe). */
export function paginaDesdeCms(snap: InstantaneaCms | null, clave: string): PaginaVista | null {
  const p = snap?.paginas.find((x) => x.clave === clave);
  return p ? { clave: p.clave, titulo: p.contenido.titulo, bloques: p.contenido.bloques, actualizadaAt: p.publicadaAt } : null;
}

/** Los códigos de las páginas publicadas: con ellos el pie decide a cuáles puede enlazar (un enlace nunca lleva a una página que no existe). */
export const clavesDePaginas = (snap: InstantaneaCms | null): string[] => (snap?.paginas ?? []).map((p) => p.clave);

/** Una página propia que la administradora puso en el menú de arriba de la tienda. */
export interface PaginaDeMenu {
  clave: string;
  /** Lo que dice el enlace del menú: el texto que ella escribió para el menú o, si no escribió ninguno, el título de la página. */
  texto: string;
}

/**
 * Lo que el marco de la tienda hace con las páginas publicadas: los enlaces del menú de arriba y las rutas «aparte» de la barra inferior del celular, que son las de TODAS las páginas propias y la de
 * «Mayoristas» (`mayoristaHref`, si la hay): en ellas ninguna pestaña debe quedar marcada, porque no son el inicio ni el catálogo. Sin ninguna, `rutasAparte` es undefined y la barra se comporta como siempre.
 */
export function enlacesDePaginas(
  basePath: string,
  datos: { menu: readonly PaginaDeMenu[]; paginas: readonly string[] },
  mayoristaHref?: string,
): { menu: Array<{ texto: string; href: string }>; rutasAparte: string[] | undefined } {
  const rutasAparte = [...(mayoristaHref ? [mayoristaHref] : []), ...datos.paginas.map((clave) => rutaPagina(basePath, clave))];
  return { menu: datos.menu.map((p) => ({ texto: p.texto, href: rutaPagina(basePath, p.clave) })), rutasAparte: rutasAparte.length > 0 ? rutasAparte : undefined };
}

/**
 * Las páginas PUBLICADAS que la administradora puso en el menú de arriba, en el orden en que las creó (la más antigua primero: así el orden no cambia al editarlas ni al volver a publicarlas) y hasta
 * `MAX_PAGINAS_EN_MENU`. El panel ya no deja publicar una más cuando el menú está lleno; este tope solo protege la cabecera de lo que el panel no revisa (reanudar una página que estaba en pausa).
 * Una página pausada, despublicada o archivada no está en la instantánea y, por lo tanto, tampoco en el menú: nunca un enlace a una página que no existe.
 */
export function paginasDelMenu(snap: InstantaneaCms | null): PaginaDeMenu[] {
  return (snap?.paginas ?? [])
    .filter((p) => p.contenido.en_menu === true)
    .sort((a, b) => Date.parse(a.creadaAt) - Date.parse(b.creadaAt) || a.clave.localeCompare(b.clave))
    .slice(0, MAX_PAGINAS_EN_MENU)
    .map((p) => ({ clave: p.clave, texto: textoDeMenuDePagina(p.contenido) }));
}

const FECHA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" });

/** «15 de octubre de 2026» (hora de Bogotá). */
export function fechaDePagina(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? FECHA.format(new Date(ms)) : "";
}
