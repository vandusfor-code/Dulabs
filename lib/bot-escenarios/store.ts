/**
 * Lectura real de dulabs_bot_escenarios (autorizado). Único punto que sabe
 * el nombre de columnas/tabla -- el resolver (resolver.ts) solo conoce
 * EscenarioRow, nunca SQL.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfigEscenario, EscenarioRow, ModoEscenario, VarianteActivacion } from "@/lib/bot-escenarios/tipos";

interface FilaDb {
  tenant_id: string;
  id: string;
  codigo: string;
  nombre: string;
  modo: string;
  prioridad: number;
  activo: boolean;
  variantes: unknown;
  respuestas: unknown;
  config: unknown;
}

function mapearFila(fila: FilaDb): EscenarioRow {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    modo: fila.modo as ModoEscenario,
    prioridad: fila.prioridad,
    activo: fila.activo,
    variantes: Array.isArray(fila.variantes) ? (fila.variantes as VarianteActivacion[]) : [],
    respuestas: Array.isArray(fila.respuestas) ? (fila.respuestas as string[]) : [],
    config: (fila.config && typeof fila.config === "object" ? fila.config : {}) as ConfigEscenario,
  };
}

/** Todos los escenarios (activos e inactivos) de un tenant -- el filtro `activo` lo aplica el matcher, así el fallback/portal reservados se pueden encontrar aunque estén desactivados temporalmente. */
export async function cargarEscenariosReal(supabase: SupabaseClient, tenantId: string): Promise<EscenarioRow[]> {
  const { data, error } = await supabase
    .from("dulabs_bot_escenarios")
    .select("tenant_id, id, codigo, nombre, modo, prioridad, activo, variantes, respuestas, config")
    .eq("tenant_id", tenantId);
  if (error) throw error;
  return ((data ?? []) as FilaDb[]).map(mapearFila);
}
