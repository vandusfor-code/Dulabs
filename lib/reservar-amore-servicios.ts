/**
 * Portal público de AMORE (/reservar/amore) — lógica PURA de la selección de servicios de UNA cita (ej. uñas de manos + uñas de pies). Sin React ni red: la
 * pantalla solo la usa para decidir qué mostrar; el backend vuelve a validar todo (existencia, una misma profesional para todos, disponibilidad) al reservar.
 */

export type ServicioDelPortal = {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  duracion_min: number;
  precio: number | null;
  imagen_url: string | null;
};

/** Tope de servicios por cita si el servidor no dice otra cosa (el servidor manda: ver `maxServiciosPorCita` del catálogo). */
export const MAX_SERVICIOS_POR_DEFECTO = 3;

/** Los servicios sin categoría se agrupan bajo este nombre. */
export const CATEGORIA_SIN_NOMBRE = "Otros";

export function categoriaDelServicio(servicio: Pick<ServicioDelPortal, "categoria">): string {
  return servicio.categoria?.trim() || CATEGORIA_SIN_NOMBRE;
}

/**
 * Categorías en el orden de las pestañas: primero la que más servicios tiene (para un salón, la principal), el resto de mayor a menor y, en empate, por
 * orden alfabético; «Otros» (los sin categoría) siempre al final.
 */
export function ordenarCategorias(servicios: Pick<ServicioDelPortal, "categoria">[]): string[] {
  const cantidades = new Map<string, number>();
  for (const s of servicios) {
    const categoria = categoriaDelServicio(s);
    cantidades.set(categoria, (cantidades.get(categoria) ?? 0) + 1);
  }
  return [...cantidades.entries()]
    .sort(([a, cantidadA], [b, cantidadB]) => {
      if (a === CATEGORIA_SIN_NOMBRE) return b === CATEGORIA_SIN_NOMBRE ? 0 : 1;
      if (b === CATEGORIA_SIN_NOMBRE) return -1;
      return cantidadB - cantidadA || a.localeCompare(b, "es");
    })
    .map(([categoria]) => categoria);
}

export type ResumenServicios = {
  cantidad: number;
  /** «A + B», en el orden elegido. */
  nombre: string;
  /** Suma de las duraciones: es el bloque continuo que se reserva. */
  duracionMin: number;
  /** Suma de los precios; null si ALGÚN servicio no tiene precio fijo (nunca se inventa un total). */
  precioTotal: number | null;
};

export function resumirServicios(servicios: Pick<ServicioDelPortal, "nombre" | "duracion_min" | "precio">[]): ResumenServicios {
  const todosConPrecio = servicios.length > 0 && servicios.every((s) => s.precio != null);
  return {
    cantidad: servicios.length,
    nombre: servicios.map((s) => s.nombre).join(" + "),
    duracionMin: servicios.reduce((total, s) => total + s.duracion_min, 0),
    precioTotal: todosConPrecio ? servicios.reduce((total, s) => total + (s.precio as number), 0) : null,
  };
}

/** Marca o desmarca un servicio. Al marcar conserva el orden de elección; si ya hay `max`, no deja agregar otro (devuelve la misma lista). */
export function alternarServicio(ids: readonly string[], id: string, max: number): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (ids.length >= max) return [...ids];
  return [...ids, id];
}

/** Los servicios del catálogo que corresponden a los ids, en el orden de los ids; ignora repetidos y los que ya no existen. */
export function serviciosDeIds<T extends Pick<ServicioDelPortal, "id">>(ids: readonly string[], catalogo: readonly T[]): T[] {
  const vistos = new Set<string>();
  const resultado: T[] = [];
  for (const id of ids) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    const servicio = catalogo.find((s) => s.id === id);
    if (servicio) resultado.push(servicio);
  }
  return resultado;
}

/** Misma lista de servicios y en el mismo orden (el primero es el servicio principal de la cita). */
export function mismosServicios(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Lista de ids para la URL de las consultas del portal: `servicioIds=a,b`. */
export function parametroServicioIds(ids: readonly string[]): string {
  return ids.join(",");
}
