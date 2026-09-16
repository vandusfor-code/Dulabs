import type { SupabaseClient } from "@supabase/supabase-js";
import type { Movimiento, ReporteContabilidad, TipoPeriodo } from "./tipos";
import { resolverRango, rangoAnteriorDe } from "./periodo";
import { buscarCitasCompletadas } from "./consultas";
import { calcularIngresoTotal, agruparPorServicio, compararConAnterior, construirMovimientos, calcularIngresoVentas, construirMovimientosVenta } from "./metricas";
import { obtenerComisionesPorServicio, obtenerLineasMultiServicioPorCita, agruparPorProfesional } from "./comisiones";
import { listarVentasProductos } from "@/lib/amore-inventario-ventas";

export type ParametrosReporte = {
  idTenant: string;
  periodo: TipoPeriodo;
  ahora?: Date;
  personalizado?: { desde: string; hasta: string };
  especialistaId?: number;
  servicioId?: string;
};

// Contabilidad (Fase 10, genérico, autorizado) — orquestador único: resuelve
// el rango de fechas (America/Bogota), consulta las citas completadas del
// tenant (con sus filtros opcionales) y arma las 4 vistas que pide el panel
// (ingresos totales + comparación, por servicio, por profesional +
// comisión, movimientos). Ningún dato se inventa: una cita completada sin
// precio configurado aparece en movimientos con valor null, nunca se
// descarta ni se le asigna un número.
export async function generarReporteContabilidad(
  supabase: SupabaseClient,
  params: ParametrosReporte
): Promise<{ ok: true; reporte: ReporteContabilidad } | { ok: false; error: string }> {
  const ahora = params.ahora ?? new Date();
  const rango = resolverRango(params.periodo, ahora, params.personalizado);
  if (!rango) return { ok: false, error: "Rango de fechas inválido" };

  const rangoAnterior = rangoAnteriorDe(params.periodo, rango, ahora);

  // AMORE (autorizado, Inventario -- "Registrar venta") -- ventas reales de
  // producto SOLO se incluyen cuando NO hay filtro por especialista/servicio
  // (una venta de producto no tiene especialista ni servicio real, así que
  // nunca podría calzar con ese filtro -- incluirla igual inflaría el total
  // filtrado con algo que el filtro pedía excluir). Sin filtro, sí se
  // incluyen: es el reporte general de ingresos del negocio.
  const incluirVentas = params.especialistaId === undefined && params.servicioId === undefined;

  // Defensivo (mismo criterio EXACTO que la Fase 8 de Agenda V2 para una
  // migración reciente que puede no estar aplicada todavía en producción) --
  // Contabilidad EXISTÍA y funcionaba antes de "Registrar venta"
  // (dulabs_inventario_ventas es una tabla NUEVA, ver
  // 20261007000000_amore_inventario_ventas.sql). Mientras esa migración no
  // se haya corrido, el reporte de Contabilidad NUNCA debe romperse por
  // esto -- se trata exactamente igual que "sin ventas de producto todavía"
  // (array vacío), nunca como un error fatal del reporte completo.
  async function ventasSeguras(rangoVentas: { desde: Date; hasta: Date }) {
    if (!incluirVentas) return [];
    try {
      return await listarVentasProductos(supabase, { idTenant: params.idTenant, rango: rangoVentas });
    } catch (err) {
      console.error("[contabilidad] no se pudieron leer ventas de producto (¿migración de Inventario/Ventas pendiente?):", err instanceof Error ? err.message : err);
      return [];
    }
  }

  const [filasActual, filasAnterior, comisionesPorServicio, ventasActual, ventasAnterior] = await Promise.all([
    buscarCitasCompletadas(supabase, {
      idTenant: params.idTenant,
      rango,
      especialistaId: params.especialistaId,
      servicioId: params.servicioId,
    }),
    buscarCitasCompletadas(supabase, {
      idTenant: params.idTenant,
      rango: rangoAnterior,
      especialistaId: params.especialistaId,
      servicioId: params.servicioId,
    }),
    obtenerComisionesPorServicio(supabase, params.idTenant),
    ventasSeguras(rango),
    ventasSeguras(rangoAnterior),
  ]);
  const lineasMultiServicio = await obtenerLineasMultiServicioPorCita(
    supabase,
    params.idTenant,
    filasActual.map((f) => f.id)
  );

  const ingresoActual = calcularIngresoTotal(filasActual) + calcularIngresoVentas(ventasActual);
  const ingresoAnterior = calcularIngresoTotal(filasAnterior) + calcularIngresoVentas(ventasAnterior);

  // Línea de tiempo combinada (citas + ventas de producto), más reciente
  // primero -- cada fuente ya llega ordenada descendente por su propia
  // consulta, así que un merge simple por fecha alcanza (nunca hace falta
  // reordenar cada lista completa de nuevo).
  const movimientos: Movimiento[] = [...construirMovimientos(filasActual), ...construirMovimientosVenta(ventasActual)].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );

  return {
    ok: true,
    reporte: {
      periodo: { tipo: params.periodo, desde: rango.desde.toISOString(), hasta: rango.hasta.toISOString() },
      ingresos: compararConAnterior(ingresoActual, ingresoAnterior),
      citasCompletadas: filasActual.length,
      porServicio: agruparPorServicio(filasActual),
      porProfesional: agruparPorProfesional(filasActual, comisionesPorServicio, lineasMultiServicio),
      movimientos,
    },
  };
}
