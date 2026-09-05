import type { ComparacionIngresos, FilaCitaCompletada, IngresoPorServicio, Movimiento } from "./tipos";

// Contabilidad (Fase 10, genérico, autorizado) — agregaciones PURAS sobre
// las filas ya consultadas (ver consultas.ts). Nada acá toca Supabase.

/** Ignora precios nulos (cita sin servicio_id o servicio sin precio) -- nunca inventa un valor, solo no suma. */
export function calcularIngresoTotal(filas: FilaCitaCompletada[]): number {
  return filas.reduce((total, f) => total + (f.precio ?? 0), 0);
}

export function compararConAnterior(actual: number, anterior: number): ComparacionIngresos {
  const variacionPorcentual = anterior === 0 ? (actual === 0 ? 0 : null) : ((actual - anterior) / anterior) * 100;
  return { actual, anterior, variacionPorcentual };
}

export function agruparPorServicio(filas: FilaCitaCompletada[]): IngresoPorServicio[] {
  const porId = new Map<string, IngresoPorServicio>();
  for (const f of filas) {
    const clave = f.servicioId ?? `__sin_servicio__${f.servicioTexto}`;
    const nombre = f.servicioNombre ?? f.servicioTexto;
    const actual = porId.get(clave) ?? { servicioId: f.servicioId, servicio: nombre, cantidad: 0, ingresos: 0 };
    actual.cantidad += 1;
    actual.ingresos += f.precio ?? 0;
    porId.set(clave, actual);
  }
  return Array.from(porId.values()).sort((a, b) => b.ingresos - a.ingresos);
}

export function construirMovimientos(filas: FilaCitaCompletada[]): Movimiento[] {
  return filas.map((f) => ({
    id: f.id,
    fecha: f.inicio,
    cliente: f.nombreCliente,
    servicio: f.servicioNombre ?? f.servicioTexto,
    profesional: f.profesionalNombre,
    valor: f.precio,
    estado: f.estado,
  }));
}
