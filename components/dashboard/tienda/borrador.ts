/**
 * Administración de tienda — helpers PUROS del borrador que se edita en pantalla: leer y poner valores por ruta sin mutar, borradores iniciales, y saber si hay
 * cambios sin guardar (comparando con la MISMA normalización que usa el servidor al guardar).
 */
import type { TipoEntidad } from "@/lib/cms-comercial/contrato";
import { SECCIONES_HOME } from "@/lib/cms-comercial/contrato";
import { normalizarBorrador } from "@/lib/cms-comercial/esquemas";
import { jsonCanonico } from "@/lib/cms-comercial/json-canonico";

export type Draft = Record<string, unknown>;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const segmentos = (ruta: string) => ruta.split(".").filter(Boolean);

/** Lee `a.b.0.c` de un objeto; undefined si algún paso no existe. */
export function leer(obj: unknown, ruta: string): unknown {
  let actual: unknown = obj;
  for (const s of segmentos(ruta)) {
    if (Array.isArray(actual)) actual = actual[Number(s)];
    else if (esObjeto(actual)) actual = actual[s];
    else return undefined;
  }
  return actual;
}

/** ¿Es un valor «vacío» (se quita del borrador, igual que hace el servidor)? */
export const esVacio = (v: unknown) => v === undefined || v === null || v === "" || (typeof v === "number" && Number.isNaN(v));

/**
 * Devuelve una COPIA con `valor` en `ruta` (crea los objetos intermedios). Un valor vacío (undefined, null, «», NaN) QUITA la clave, y los objetos que
 * queden vacíos por eso también se quitan (ausente = sin valor). No muta el original.
 */
export function poner<T extends Draft>(obj: T, ruta: string, valor: unknown): T {
  const pasos = segmentos(ruta);
  if (pasos.length === 0) return obj;
  const aplicar = (actual: unknown, i: number): unknown => {
    const paso = pasos[i];
    const ultimo = i === pasos.length - 1;
    if (Array.isArray(actual)) {
      const copia = [...actual];
      const idx = Number(paso);
      if (ultimo) {
        if (esVacio(valor)) copia.splice(idx, 1);
        else copia[idx] = valor;
      } else copia[idx] = aplicar(copia[idx], i + 1);
      return copia;
    }
    const copia: Record<string, unknown> = { ...(esObjeto(actual) ? actual : {}) };
    if (ultimo) {
      if (esVacio(valor)) delete copia[paso];
      else copia[paso] = valor;
    } else {
      const hijo = aplicar(copia[paso], i + 1);
      if (esObjeto(hijo) && Object.keys(hijo).length === 0 && esVacio(valor)) delete copia[paso];
      else copia[paso] = hijo;
    }
    return copia;
  };
  return aplicar(obj, 0) as T;
}

/** Orden por defecto de las secciones de la página principal. */
export const SECCIONES_POR_DEFECTO = SECCIONES_HOME.map((tipo) => ({ tipo, visible: tipo === "portada" || tipo === "destacados" }));

/** Lo que se muestra al crear algo nuevo (la administradora completa el resto). */
export function borradorInicial(tipo: TipoEntidad): Draft {
  switch (tipo) {
    case "home":
      return { portada: { visible: true }, secciones: SECCIONES_POR_DEFECTO.map((s) => ({ ...s })), categorias_destacadas: [], productos_destacados: [] };
    case "oferta":
      return { modalidad: "ambas", beneficio: { tipo: "porcentaje" }, alcance: { todos: false, referencias: [], categorias: [] }, prioridad: 0 };
    case "combo":
      return { modalidad: "ambas", componentes: [], precio: {}, prioridad: 0 };
    case "campana":
      return { modalidad: "ambas", prioridad: 0, productos_destacados: [] };
    case "contenido":
      return { tema: "faq", audiencia: "todos", palabras_clave: [], orden: 0 };
  }
}

/** ¿Dos borradores son lo mismo para el servidor? (misma normalización: sin espacios sobrantes, sin vacíos, sin importar el orden de las claves). */
export function mismoContenido(tipo: TipoEntidad, a: unknown, b: unknown): boolean {
  const na = normalizarBorrador(tipo, a);
  const nb = normalizarBorrador(tipo, b);
  if (na.ok && nb.ok) return jsonCanonico(na.borrador) === jsonCanonico(nb.borrador);
  return jsonCanonico(a) === jsonCanonico(b);
}

/** Convierte lo escrito en un campo de número («15», «15 », «») en número o undefined. Un valor no numérico devuelve NaN (y se quita al poner). */
export function aNumero(texto: string): number | undefined {
  const limpio = texto.trim();
  if (limpio === "") return undefined;
  return Number(limpio.replace(/[.\s$]/g, "").replace(",", "."));
}

/** Mueve un elemento de una lista una posición (−1 arriba, +1 abajo) sin mutarla. */
export function mover<T>(lista: readonly T[], indice: number, delta: -1 | 1): T[] {
  const destino = indice + delta;
  if (indice < 0 || indice >= lista.length || destino < 0 || destino >= lista.length) return [...lista];
  const copia = [...lista];
  [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
  return copia;
}
