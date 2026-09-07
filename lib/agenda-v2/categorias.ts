/**
 * AGENDA V2 (autorizado) — ajuste de UX de la Fase 2: antes de mostrar los
 * servicios, se muestra primero la CATEGORÍA real (dulabs_servicios.categoria,
 * ya usada por listarCatalogoServiciosReal -- ver lib/catalogo-servicios-flow-adaptador.ts).
 * Verificado contra el catálogo real de AMORE (28 servicios activos) antes de
 * escribir este archivo: las 6 categorías (Cabello, Cejas, Depilación,
 * Maquillaje, Pestañas, Uñas) están pobladas al 100% -- ningún servicio activo
 * tiene categoria null/vacía -- así que nunca hace falta inventar una
 * categoría "Sin clasificar".
 *
 * Deliberadamente sin ningún campo `step` nuevo: el paso sigue siendo
 * S1_SERVICIO tanto mientras se muestran categorías como mientras se muestran
 * los servicios de una categoría ya elegida -- la sub-fase se distingue por la
 * FORMA de `opcionesMostradas` (ver esOpcionCategoria), nunca por un valor de
 * `step` nuevo. Esto evita tocar el CHECK constraint de
 * dulabs_agenda_v2_sesiones.step (y por lo tanto no requiere migración).
 */
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";

export interface OpcionCategoriaAgendaV2 {
  numero: number;
  categoria: string;
}

/** Categorías reales, únicas, en el mismo orden de aparición del catálogo (ya viene ordenado por categoria) -- nunca inventadas. */
export function construirOpcionesCategoria(catalogo: ServicioCatalogoReal[]): OpcionCategoriaAgendaV2[] {
  const vistas = new Set<string>();
  const categorias: string[] = [];
  for (const s of catalogo) {
    const categoria = s.categoria?.trim();
    if (!categoria || vistas.has(categoria)) continue;
    vistas.add(categoria);
    categorias.push(categoria);
  }
  return categorias.map((categoria, i) => ({ numero: i + 1, categoria }));
}

function listaOpciones(opciones: OpcionCategoriaAgendaV2[]): string {
  return opciones.map((o) => `${o.numero}. ${o.categoria}`).join("\n");
}

export function renderizarMenuCategoria(opciones: OpcionCategoriaAgendaV2[]): string {
  return `Perfecto 💗 ¿Qué tipo de servicio te gustaría agendar?\n\n${listaOpciones(opciones)}`;
}

export function textoSeleccionInvalidaCategoria(opciones: OpcionCategoriaAgendaV2[]): string {
  return `No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n${listaOpciones(opciones)}`;
}

/** Misma regla que resolverSeleccionServicio -- solo número exacto contra lo ya mostrado, nunca fuzzy ni nombre de categoría en texto libre. */
export function resolverSeleccionCategoria(mensaje: string, opciones: OpcionCategoriaAgendaV2[]): OpcionCategoriaAgendaV2 | undefined {
  const texto = mensaje.trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const numero = Number(texto);
  return opciones.find((o) => o.numero === numero);
}

/**
 * Discrimina la forma de un elemento de `opcionesMostradas` guardado en la
 * sesión: una opción de categoría nunca tiene `servicioId` (solo `categoria`),
 * una opción de servicio (Fase 2, ya en producción) siempre lo tiene. Esto
 * hace que cualquier sesión ya creada antes de este ajuste (con opciones de
 * servicio "planas") se siga interpretando correctamente como opciones de
 * servicio -- nunca se rompe una sesión real en curso.
 */
export function esOpcionCategoria(opcion: unknown): opcion is OpcionCategoriaAgendaV2 {
  return (
    typeof opcion === "object" &&
    opcion !== null &&
    "categoria" in opcion &&
    !("servicioId" in opcion)
  );
}
