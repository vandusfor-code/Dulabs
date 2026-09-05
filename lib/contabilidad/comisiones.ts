import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfigComision, FilaCitaCompletada, IngresoPorProfesional } from "./tipos";

type FilaConfig = { especialista_id: number; tipo: "porcentaje" | "valor_fijo"; valor: number };

// Contabilidad (Fase 10, genérico, autorizado) — lee la configuración de
// comisión (dulabs_comisiones_especialista, Fase 10). Sin fila para un
// especialista => "no_configurada", NUNCA se asume un porcentaje.
export async function obtenerComisionesActivas(
  supabase: SupabaseClient,
  idTenant: string
): Promise<Map<number, { tipo: "porcentaje" | "valor_fijo"; valor: number }>> {
  const { data, error } = await supabase
    .from("dulabs_comisiones_especialista")
    .select("especialista_id, tipo, valor")
    .eq("id_tenant", idTenant)
    .eq("activo", true);
  if (error) throw error;

  const mapa = new Map<number, { tipo: "porcentaje" | "valor_fijo"; valor: number }>();
  for (const fila of (data ?? []) as FilaConfig[]) {
    mapa.set(fila.especialista_id, { tipo: fila.tipo, valor: fila.valor });
  }
  return mapa;
}

function calcularComision(
  ingresoGenerado: number,
  cantidadServicios: number,
  config: { tipo: "porcentaje" | "valor_fijo"; valor: number } | undefined
): ConfigComision {
  if (!config) return { estado: "no_configurada" };
  const monto = config.tipo === "porcentaje" ? (ingresoGenerado * config.valor) / 100 : config.valor * cantidadServicios;
  return { estado: "configurada", tipo: config.tipo, valor: config.valor, monto };
}

export function agruparPorProfesional(
  filas: FilaCitaCompletada[],
  comisiones: Map<number, { tipo: "porcentaje" | "valor_fijo"; valor: number }>
): IngresoPorProfesional[] {
  const porId = new Map<number, { profesional: string; cantidad: number; ingresos: number }>();
  for (const f of filas) {
    const actual = porId.get(f.especialistaId) ?? { profesional: f.profesionalNombre, cantidad: 0, ingresos: 0 };
    actual.cantidad += 1;
    actual.ingresos += f.precio ?? 0;
    porId.set(f.especialistaId, actual);
  }
  return Array.from(porId.entries())
    .map(([especialistaId, v]) => ({
      especialistaId,
      profesional: v.profesional,
      cantidad: v.cantidad,
      ingresos: v.ingresos,
      comision: calcularComision(v.ingresos, v.cantidad, comisiones.get(especialistaId)),
    }))
    .sort((a, b) => b.ingresos - a.ingresos);
}
