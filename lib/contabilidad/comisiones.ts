import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfigComision, FilaCitaCompletada, IngresoPorProfesional } from "./tipos";

// Contabilidad (NUEVA FASE, autorizado) — la comisión ahora se configura
// DIRECTAMENTE en cada servicio (dulabs_servicios.comision_tipo/comision_valor,
// ver 20260924000000_amore_comision_servicio.sql), no por especialista. Sin
// configuración en el servicio => "no_configurada", NUNCA se asume un valor.
// Reemplaza a la Fase 10 (dulabs_comisiones_especialista, que nunca tuvo UI
// real -- por eso Contabilidad siempre mostraba "No configurada"); esa tabla
// no se borra (evita perder datos ya escritos), simplemente deja de leerse.
export type ConfigComisionServicio = { tipo: "porcentaje" | "valor_fijo"; valor: number } | null;

type FilaServicio = { id: string; comision_tipo: "porcentaje" | "valor_fijo" | null; comision_valor: number | null };

export async function obtenerComisionesPorServicio(supabase: SupabaseClient, idTenant: string): Promise<Map<string, ConfigComisionServicio>> {
  const { data, error } = await supabase.from("dulabs_servicios").select("id, comision_tipo, comision_valor").eq("id_tenant", idTenant);
  if (error) throw error;

  const mapa = new Map<string, ConfigComisionServicio>();
  for (const fila of (data ?? []) as FilaServicio[]) {
    mapa.set(fila.id, fila.comision_tipo && fila.comision_valor !== null ? { tipo: fila.comision_tipo, valor: fila.comision_valor } : null);
  }
  return mapa;
}

export type LineaServicioCita = { servicioId: string; precio: number | null };

type FilaPuente = { cita_id: number; servicio_id: string; dulabs_servicios: { precio: number | null } | null };

// Fase 3 (multi-servicio, ya existente) -- una cita con 2 o 3 servicios
// reales tiene su detalle en dulabs_cita_servicios (ver
// 20260922000000_amore_multi_servicio.sql). Sin esto, la comisión de una
// cita multi-servicio se calcularía sobre precio_total con la config de UN
// solo servicio (el primero) -- incorrecto. Con esto, cada servicio real de
// la cita se calcula con SU PROPIA configuración de comisión, exactamente
// como pide el negocio (ej. Manicure 20% + Pedicure 10% + Cejas $5.000 fijo).
export async function obtenerLineasMultiServicioPorCita(
  supabase: SupabaseClient,
  idTenant: string,
  citaIds: number[]
): Promise<Map<number, LineaServicioCita[]>> {
  const mapa = new Map<number, LineaServicioCita[]>();
  if (citaIds.length === 0) return mapa;

  const { data, error } = await supabase
    .from("dulabs_cita_servicios")
    .select("cita_id, servicio_id, dulabs_servicios(precio)")
    .eq("id_tenant", idTenant)
    .in("cita_id", citaIds);
  if (error) throw error;

  for (const fila of (data ?? []) as unknown as FilaPuente[]) {
    const lista = mapa.get(fila.cita_id) ?? [];
    lista.push({ servicioId: fila.servicio_id, precio: fila.dulabs_servicios?.precio ?? null });
    mapa.set(fila.cita_id, lista);
  }
  return mapa;
}

function calcularMontoLinea(precio: number | null, config: ConfigComisionServicio): number | null {
  if (!config || precio === null) return null;
  return config.tipo === "porcentaje" ? (precio * config.valor) / 100 : config.valor;
}

/**
 * Para cada cita completada, resuelve sus servicios reales -- si tiene
 * detalle multi-servicio (dulabs_cita_servicios), usa ESE (uno o más
 * servicios, cada uno con su propio precio real); si no, es una cita de un
 * solo servicio y usa servicioId/precio ya resueltos por buscarCitasCompletadas
 * (comportamiento histórico, sin ningún cambio).
 */
function lineasDeCita(fila: FilaCitaCompletada, lineasMultiServicio: Map<number, LineaServicioCita[]>): LineaServicioCita[] {
  const lineas = lineasMultiServicio.get(fila.id);
  if (lineas && lineas.length > 0) return lineas;
  return fila.servicioId ? [{ servicioId: fila.servicioId, precio: fila.precio }] : [];
}

export function agruparPorProfesional(
  filas: FilaCitaCompletada[],
  comisionesPorServicio: Map<string, ConfigComisionServicio>,
  lineasMultiServicioPorCita: Map<number, LineaServicioCita[]>
): IngresoPorProfesional[] {
  const porId = new Map<number, { profesional: string; cantidad: number; ingresos: number; montoComision: number; algunaConfigurada: boolean }>();

  for (const f of filas) {
    const actual = porId.get(f.especialistaId) ?? { profesional: f.profesionalNombre, cantidad: 0, ingresos: 0, montoComision: 0, algunaConfigurada: false };
    actual.cantidad += 1;
    actual.ingresos += f.precio ?? 0;

    for (const linea of lineasDeCita(f, lineasMultiServicioPorCita)) {
      const monto = calcularMontoLinea(linea.precio, comisionesPorServicio.get(linea.servicioId) ?? null);
      if (monto !== null) {
        actual.montoComision += monto;
        actual.algunaConfigurada = true;
      }
    }

    porId.set(f.especialistaId, actual);
  }

  return Array.from(porId.entries())
    .map(([especialistaId, v]): IngresoPorProfesional => ({
      especialistaId,
      profesional: v.profesional,
      cantidad: v.cantidad,
      ingresos: v.ingresos,
      comision: v.algunaConfigurada ? ({ estado: "configurada", monto: v.montoComision } satisfies ConfigComision) : ({ estado: "no_configurada" } satisfies ConfigComision),
    }))
    .sort((a, b) => b.ingresos - a.ingresos);
}
