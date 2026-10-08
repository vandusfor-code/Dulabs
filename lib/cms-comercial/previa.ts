/**
 * CMS comercial — VISTA PREVIA de lo que el cliente vería. PURO (apto para el navegador): usa las MISMAS funciones de evaluación que la tienda, el pedido y ARIA
 * (precio efectivo, combos, variables), así que lo que la administradora ve en la vista previa es lo que el backend calcularía. Nada de reglas propias.
 *
 * El borrador puede estar incompleto: si no cumple el esquema todavía, la vista previa lo dice en vez de inventar un resultado.
 */
import type { Canal, Modalidad } from "@/lib/cms-comercial/contrato";
import { ofertaSchema, comboSchema, contenidoSchema, type Combo, type Oferta } from "@/lib/cms-comercial/esquemas";
import { ofertaAlcanzaProducto, precioEfectivo, textoBeneficio, vistaCombo, type ContextoEvaluacion, type ProductoParaCombo, type VistaCombo } from "@/lib/cms-comercial/evaluacion";
import type { PublicadaCms } from "@/lib/cms-comercial/publicado";
import { instantaneaVacia } from "@/lib/cms-comercial/publicado";
import { describirVigencia, estadoDeVigencia, type EstadoVigencia } from "@/lib/cms-comercial/tiempo";
import { resolverVariables, type ValoresVariables } from "@/lib/cms-comercial/variables";

export interface ProductoPrevia {
  referencia: string;
  nombre: string;
  categoriaId: string | null;
  activo: boolean;
  agotado: boolean;
  precioDetal: number | null;
  precioMayor: number | null;
  miniatura?: string | null;
}

export const canalesDe = (m: Modalidad): Canal[] => (m === "detal" ? ["retail"] : m === "mayorista" ? ["wholesale"] : ["retail", "wholesale"]);
export const nombreCanal = (c: Canal) => (c === "retail" ? "Detal" : "Mayorista");
const precioDe = (p: ProductoPrevia, c: Canal) => (c === "retail" ? p.precioDetal : p.precioMayor);

/** Envuelve un contenido como si estuviera publicado, para poder usar las funciones de evaluación sobre un borrador. */
function envolver<T>(contenido: T): PublicadaCms & { contenido: T } {
  return { id: "vista-previa", clave: "vista-previa", version: 0, publicadaAt: "1970-01-01T00:00:00.000Z", creadaAt: "1970-01-01T00:00:00.000Z", contenido } as PublicadaCms & { contenido: T };
}

const contextoDe = (canal: Canal, ahora: number): ContextoEvaluacion => ({ snap: instantaneaVacia("vista-previa"), canal, ahora });

export type PreviaNoLista = { lista: false; motivo: string };

// ---------------------------------------------------------------------------
// Oferta
// ---------------------------------------------------------------------------

export interface EjemploPrecio {
  producto: ProductoPrevia;
  canal: Canal;
  precioLista: number;
  precioFinal: number;
  ahorro: number;
}

export interface PreviaOferta {
  lista: true;
  nombre: string;
  descripcion: string | null;
  modalidad: Modalidad;
  textosBeneficio: Array<{ canal: Canal; texto: string }>;
  textoVigencia: string | null;
  estadoVigencia: EstadoVigencia;
  condiciones: string | null;
  /** Productos de la muestra a los que la oferta SÍ les cambia el precio, por canal. */
  ejemplos: EjemploPrecio[];
  /** Productos de la muestra a los que la oferta NO les aplica (precio fuera de rango, sin precio en ese canal…). */
  sinEfecto: ProductoPrevia[];
}

/** `muestra`: productos de ejemplo (los elegidos por la administradora y, si hacen falta, los más recientes). */
export function previaOferta(borrador: unknown, muestra: readonly ProductoPrevia[], ahora: number, maxEjemplos = 3): PreviaOferta | PreviaNoLista {
  const parseo = ofertaSchema.safeParse(borrador);
  if (!parseo.success) return { lista: false, motivo: "Completa los datos de la oferta para ver cómo se vería." };
  const o: Oferta = parseo.data;
  const envuelta = envolver(o);
  const enAlcance = muestra.filter((p) => ofertaAlcanzaProducto(o, { referencia: p.referencia, categoriaId: p.categoriaId, precioLista: null }));
  const ejemplos: EjemploPrecio[] = [];
  const sinEfecto: ProductoPrevia[] = [];
  for (const p of enAlcance) {
    let aplico = false;
    for (const canal of canalesDe(o.modalidad)) {
      const lista = precioDe(p, canal);
      if (lista === null) continue;
      const r = precioEfectivo(contextoDe(canal, ahora), { referencia: p.referencia, categoriaId: p.categoriaId, precioLista: lista }, [envuelta as PublicadaCms<"oferta">]);
      if (r.oferta && r.precioFinal !== null && r.precioLista !== null) {
        aplico = true;
        if (ejemplos.filter((e) => e.canal === canal).length < maxEjemplos) ejemplos.push({ producto: p, canal, precioLista: r.precioLista, precioFinal: r.precioFinal, ahorro: r.oferta.ahorro });
      }
    }
    if (!aplico) sinEfecto.push(p);
  }
  return {
    lista: true,
    nombre: o.nombre,
    descripcion: o.descripcion ?? null,
    modalidad: o.modalidad,
    textosBeneficio: canalesDe(o.modalidad).map((canal) => ({ canal, texto: textoBeneficio(o.beneficio, canal) })),
    textoVigencia: describirVigencia(o.vigencia),
    estadoVigencia: estadoDeVigencia(o.vigencia, ahora),
    condiciones: o.condiciones ?? null,
    ejemplos,
    sinEfecto: sinEfecto.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Combo
// ---------------------------------------------------------------------------

export interface PreviaCombo {
  lista: true;
  nombre: string;
  descripcion: string | null;
  modalidad: Modalidad;
  porCanal: Array<{ canal: Canal; vista: VistaCombo | null }>;
  textoVigencia: string | null;
  estadoVigencia: EstadoVigencia;
}

export function previaCombo(borrador: unknown, productos: readonly ProductoPrevia[], ahora: number): PreviaCombo | PreviaNoLista {
  const parseo = comboSchema.safeParse(borrador);
  if (!parseo.success) return { lista: false, motivo: "Completa los datos del combo para ver cómo se vería." };
  const c: Combo = parseo.data;
  const envuelto = envolver(c) as PublicadaCms<"combo">;
  return {
    lista: true,
    nombre: c.nombre,
    descripcion: c.descripcion ?? null,
    modalidad: c.modalidad,
    textoVigencia: describirVigencia(c.vigencia),
    estadoVigencia: estadoDeVigencia(c.vigencia, ahora),
    porCanal: canalesDe(c.modalidad).map((canal) => {
      const mapa = new Map<string, ProductoParaCombo>(
        productos.map((p) => [p.referencia, { referencia: p.referencia, nombre: p.nombre, activo: p.activo, disponibilidad: p.agotado ? "sold_out" : "available", maxCantidad: null, precioLista: precioDe(p, canal) }]),
      );
      // El combo se evalúa como si ya estuviera activo: la vista previa muestra su precio, ahorro y disponibilidad aunque aún no empiece.
      return { canal, vista: vistaCombo(contextoDe(canal, ahora), envuelto, mapa, [envuelto]) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------

export interface PreviaContenido {
  lista: true;
  titulo: string;
  texto: string;
  /** Variables que todavía no tienen valor configurado (el texto no se podría publicar ni entregar). */
  sinValor: string[];
  desconocidas: string[];
}

export function previaContenido(borrador: unknown, valores: ValoresVariables): PreviaContenido | PreviaNoLista {
  const parseo = contenidoSchema.safeParse(borrador);
  if (!parseo.success) return { lista: false, motivo: "Escribe la pregunta y la respuesta para ver cómo se vería." };
  const { titulo, texto } = parseo.data;
  const t = resolverVariables(titulo, valores);
  const x = resolverVariables(texto, valores);
  const sinValor = [...(!t.ok ? t.sinValor : []), ...(!x.ok ? x.sinValor : [])];
  const desconocidas = [...(!t.ok ? t.desconocidas : []), ...(!x.ok ? x.desconocidas : [])];
  return { lista: true, titulo: t.ok ? t.texto : titulo, texto: x.ok ? x.texto : texto, sinValor: [...new Set(sinValor)], desconocidas: [...new Set(desconocidas)] };
}

// ---------------------------------------------------------------------------
// Alcance en palabras
// ---------------------------------------------------------------------------

/** «Toda la tienda» o «3 productos y 1 categoría», para las listas. */
export function textoAlcance(alcance: { todos?: boolean; referencias?: readonly unknown[]; categorias?: readonly unknown[] } | undefined): string {
  if (!alcance) return "Sin productos";
  if (alcance.todos) return "Toda la tienda";
  const p = alcance.referencias?.length ?? 0;
  const c = alcance.categorias?.length ?? 0;
  const partes = [p > 0 ? `${p} ${p === 1 ? "producto" : "productos"}` : null, c > 0 ? `${c} ${c === 1 ? "categoría" : "categorías"}` : null].filter(Boolean);
  return partes.length > 0 ? partes.join(" y ") : "Sin productos";
}
