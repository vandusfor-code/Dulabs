/**
 * Servicios estructurados del Business Agent (autoservicio).
 *
 * REUTILIZA la tabla EXISTENTE `dulabs_servicios` (migración
 * 20260904030000_daniela_reservas_modelo_v1.sql) -- la MISMA que ya leen las
 * acciones de catálogo del Runtime (listar_catalogo_servicios /
 * resolver_servicio_catalogo, ver lib/catalogo-servicios-flow-adaptador.ts).
 * No se crea otra tabla: el precio y la duración son datos ESTRUCTURADOS, nunca
 * texto en un prompt. Solo se exponen los campos genéricos (nombre, categoría,
 * descripción, duración, precio COP, activo); las columnas específicas de AMORE
 * (comisiones, asociación N:N con especialistas) no las toca el Business Agent.
 *
 * Este archivo es lógica PURA (validación + normalización), sin I/O: los routes
 * (app/api/business-agent/services/*) la usan y son adaptadores delgados,
 * testeables sin red.
 */

/** Proyección pública de un servicio (lo que ve el cliente / la UI). */
export interface BusinessAgentService {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  duracionMin: number;
  /** Pesos colombianos enteros (COP), o null si el servicio no tiene precio fijo. */
  precio: number | null;
  activo: boolean;
}

/** Fila cruda de dulabs_servicios (subconjunto genérico que usa el Business Agent). */
export interface ServicioRow {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  duracion_min: number;
  precio: number | null;
  activo: boolean;
}

export function rowToService(r: ServicioRow): BusinessAgentService {
  return {
    id: r.id,
    nombre: r.nombre,
    categoria: r.categoria,
    descripcion: r.descripcion,
    duracionMin: r.duracion_min,
    precio: r.precio,
    activo: r.activo,
  };
}

// Topes de tamaño (hardening de payload; mismos criterios generosos que el resto
// del Business Agent). Muy por encima de cualquier servicio real.
export const SERVICE_LIMITS = {
  nombre: 120,
  categoria: 60,
  descripcion: 1000,
  precioMax: 1_000_000_000, // 1.000 millones COP -- tope defensivo, no de negocio
  duracionMinMax: 24 * 60, // 24 h
} as const;

/** Valores normalizados listos para persistir en dulabs_servicios. */
export interface NormalizedServiceInput {
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  duracionMin: number;
  precio: number | null;
  activo: boolean;
}

export type ServiceValidation =
  | { ok: true; value: NormalizedServiceInput }
  | { ok: false; error: string };

/**
 * Valida y normaliza el body de crear/editar un servicio. Acepta tanto
 * `duracionMin`/`duracion_min` como `precio` numérico o vacío. El precio es
 * OPCIONAL (algunos servicios no tienen precio fijo); la duración es
 * OBLIGATORIA y debe ser un entero de minutos > 0 (igual que el CHECK real de
 * la tabla `duracion_min > 0`).
 */
export function validateServiceInput(raw: unknown): ServiceValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Cuerpo de la solicitud inválido." };
  }
  const b = raw as Record<string, unknown>;

  const nombre = typeof b.nombre === "string" ? b.nombre.trim() : "";
  if (!nombre) return { ok: false, error: "El nombre del servicio es obligatorio." };
  if (nombre.length > SERVICE_LIMITS.nombre) return { ok: false, error: "El nombre del servicio es demasiado largo." };

  const duracionRaw = b.duracionMin ?? b.duracion_min;
  const duracionMin = Number(duracionRaw);
  if (!Number.isInteger(duracionMin) || duracionMin <= 0) {
    return { ok: false, error: "La duración debe ser un número entero de minutos mayor a 0." };
  }
  if (duracionMin > SERVICE_LIMITS.duracionMinMax) {
    return { ok: false, error: "La duración es demasiado larga." };
  }

  let precio: number | null = null;
  if (b.precio !== null && b.precio !== undefined && b.precio !== "") {
    const n = Number(b.precio);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: "El precio no es válido." };
    if (n > SERVICE_LIMITS.precioMax) return { ok: false, error: "El precio es demasiado alto." };
    precio = Math.round(n);
  }

  const categoria = typeof b.categoria === "string" && b.categoria.trim() ? b.categoria.trim().slice(0, SERVICE_LIMITS.categoria) : null;
  const descripcion = typeof b.descripcion === "string" && b.descripcion.trim() ? b.descripcion.trim().slice(0, SERVICE_LIMITS.descripcion) : null;
  const activo = typeof b.activo === "boolean" ? b.activo : true;

  return { ok: true, value: { nombre, categoria, descripcion, duracionMin, precio, activo } };
}
