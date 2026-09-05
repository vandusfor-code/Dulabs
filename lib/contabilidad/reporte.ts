import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReporteContabilidad, TipoPeriodo } from "./tipos";
import { resolverRango, rangoAnteriorDe } from "./periodo";
import { buscarCitasCompletadas } from "./consultas";
import { calcularIngresoTotal, agruparPorServicio, compararConAnterior, construirMovimientos } from "./metricas";
import { obtenerComisionesActivas, agruparPorProfesional } from "./comisiones";

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

  const [filasActual, filasAnterior, comisiones] = await Promise.all([
    buscarCitasCompletadas(supabase, {
      idTenant: params.idTenant,
      rango,
      especialistaId: params.especialistaId,
      servicioId: params.servicioId,
    }),
    buscarCitasCompletadas(supabase, {
      idTenant: params.idTenant,
      rango: rangoAnteriorDe(params.periodo, rango, ahora),
      especialistaId: params.especialistaId,
      servicioId: params.servicioId,
    }),
    obtenerComisionesActivas(supabase, params.idTenant),
  ]);

  const ingresoActual = calcularIngresoTotal(filasActual);
  const ingresoAnterior = calcularIngresoTotal(filasAnterior);

  return {
    ok: true,
    reporte: {
      periodo: { tipo: params.periodo, desde: rango.desde.toISOString(), hasta: rango.hasta.toISOString() },
      ingresos: compararConAnterior(ingresoActual, ingresoAnterior),
      citasCompletadas: filasActual.length,
      porServicio: agruparPorServicio(filasActual),
      porProfesional: agruparPorProfesional(filasActual, comisiones),
      movimientos: construirMovimientos(filasActual),
    },
  };
}
