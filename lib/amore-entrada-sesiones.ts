/**
 * AMORE (autorizado, Fase 9 + Fase 1 atención humana) — acceso a la única
 * fuente de verdad del modo conversacional del puente
 * bienvenida/Gemini/Agenda V2/atención humana: dulabs_amore_entrada (ver
 * migraciones 20260919000000_amore_entrada_conversacional.sql y
 * 20260920000000_amore_atencion_humana.sql). Mismo patrón exacto que
 * lib/agenda-v2/sesiones.ts -- deliberadamente sin ninguna dependencia de
 * Flow Engine ni de Agenda V2.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ModoEntradaAmore =
  | "inicio"
  | "gemini"
  | "atencion_humana"
  | "registro_nombre"
  | "registro_dia"
  | "registro_mes"
  | "compra_producto_opcion"
  | "compra_esperando_pago";

export interface EntradaAmore {
  id: number;
  tenantId: string;
  telefonoCliente: string;
  modo: ModoEntradaAmore;
  ultimoWamidProcesado: string | null;
  /** Fase 1 (atención humana) -- true en cuanto ya se notificó realmente a Jessica para esta conversación. */
  notificadoAJessica: boolean;
  /** Fase 3 (compra de producto) -- nombre del producto detectado mientras modo está en compra_producto_opcion/compra_esperando_pago. null fuera de ese flujo. */
  productoInteresNombre: string | null;
}

interface FilaDb {
  id: number;
  tenant_id: string;
  telefono_cliente: string;
  modo: ModoEntradaAmore;
  ultimo_wamid_procesado: string | null;
  notificado_a_jessica: boolean;
  producto_interes_nombre: string | null;
}

const TABLA = "dulabs_amore_entrada";
// Deliberadamente SIN atencion_humana_desde (migración 20260924010000,
// autorizado): este SELECT lo usan los 4 gates del puente en CADA mensaje
// (ver amore-entrada-router.ts) -- si esa columna todavía no existe en un
// entorno donde este código ya se desplegó, este select NUNCA debe fallar
// para los otros 3 gates (registro/compra/entrada principal) solo porque
// atención humana quiera un campo nuevo. Ver obtenerAtencionHumanaDesde
// más abajo -- lectura AISLADA y defensiva, solo para quien de verdad la usa.
const COLUMNAS = "id, tenant_id, telefono_cliente, modo, ultimo_wamid_procesado, notificado_a_jessica, producto_interes_nombre";

// Códigos reales confirmados contra Supabase real (autorizado, verificado
// empíricamente): un INSERT/UPDATE con una columna que el schema cache de
// PostgREST todavía no conoce responde "PGRST204" (Could not find the
// column ... in the schema cache) -- NUNCA el "42703" (undefined_column) de
// Postgres crudo, que solo aparece en un SELECT/WHERE directo sobre SQL.
// Se comprueban ambos por robustez (distintas rutas de Supabase-js podrían
// reportar uno u otro), nunca asumido de memoria.
const CODIGOS_COLUMNA_INEXISTENTE = new Set(["PGRST204", "42703"]);

function mapearFila(fila: FilaDb): EntradaAmore {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    telefonoCliente: fila.telefono_cliente,
    modo: fila.modo,
    ultimoWamidProcesado: fila.ultimo_wamid_procesado,
    notificadoAJessica: fila.notificado_a_jessica,
    productoInteresNombre: fila.producto_interes_nombre ?? null,
  };
}

export async function buscarEntradaAmore(supabase: SupabaseClient, tenantId: string, telefonoCliente: string): Promise<EntradaAmore | null> {
  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq("tenant_id", tenantId)
    .eq("telefono_cliente", telefonoCliente)
    .maybeSingle();
  if (error) throw error;
  return data ? mapearFila(data as FilaDb) : null;
}

/**
 * Expiración de atención humana (autorizado) -- lectura AISLADA y defensiva
 * de atencion_humana_desde, separada del select genérico de arriba a
 * propósito: si la migración 20260924010000 todavía no se aplicó en este
 * entorno, esto devuelve null (mismo efecto que "fila legacy, nunca ha
 * tenido este campo" -- ver interceptarAtencionHumanaAmore, que ante null
 * simplemente le da un punto de partida nuevo, JAMÁS expira nada de golpe)
 * en vez de romper el select principal que los otros 3 gates del puente
 * necesitan en cada mensaje.
 */
export async function obtenerAtencionHumanaDesde(supabase: SupabaseClient, id: number): Promise<string | null> {
  try {
    const { data, error } = await supabase.from(TABLA).select("atencion_humana_desde").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as { atencion_humana_desde: string | null } | null)?.atencion_humana_desde ?? null;
  } catch {
    return null;
  }
}

export async function crearEntradaAmore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    telefonoCliente: string;
    wamid: string;
    modo: ModoEntradaAmore;
    notificadoAJessica?: boolean;
    productoInteresNombre?: string | null;
    /** Expiración de atención humana (autorizado) -- ver obtenerAtencionHumanaDesde. Si la migración aún no corrió, se reintenta sin este campo (nunca rompe la creación real de la fila). */
    atencionHumanaDesde?: string | null;
  },
): Promise<EntradaAmore> {
  const base = {
    tenant_id: params.tenantId,
    telefono_cliente: params.telefonoCliente,
    modo: params.modo,
    ultimo_wamid_procesado: params.wamid,
    ...(params.notificadoAJessica !== undefined ? { notificado_a_jessica: params.notificadoAJessica } : {}),
    ...(params.productoInteresNombre !== undefined ? { producto_interes_nombre: params.productoInteresNombre } : {}),
  };
  const conAtencion = params.atencionHumanaDesde !== undefined ? { ...base, atencion_humana_desde: params.atencionHumanaDesde } : base;

  let { data, error } = await supabase.from(TABLA).insert(conAtencion).select(COLUMNAS).single();
  if (error && CODIGOS_COLUMNA_INEXISTENTE.has(error.code) && conAtencion !== base) {
    // Migración 20260924010000 (expiración de atención humana) todavía no
    // aplicada -- reintenta sin ese campo. activarAtencionHumana (el único
    // llamador real) sigue funcionando exactamente igual que antes de esta
    // mejora hasta que la migración corra.
    ({ data, error } = await supabase.from(TABLA).insert(base).select(COLUMNAS).single());
  }
  if (error) throw error;
  return mapearFila(data as FilaDb);
}

export async function actualizarEntradaAmore(
  supabase: SupabaseClient,
  id: number,
  cambios: {
    modo?: ModoEntradaAmore;
    ultimoWamidProcesado?: string;
    notificadoAJessica?: boolean;
    productoInteresNombre?: string | null;
    /** Expiración de atención humana (autorizado) -- ver obtenerAtencionHumanaDesde. Si la migración aún no corrió, se reintenta sin este campo (nunca rompe la actualización real de la fila). */
    atencionHumanaDesde?: string | null;
  },
): Promise<void> {
  const base: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (cambios.modo !== undefined) base.modo = cambios.modo;
  if (cambios.ultimoWamidProcesado !== undefined) base.ultimo_wamid_procesado = cambios.ultimoWamidProcesado;
  if (cambios.notificadoAJessica !== undefined) base.notificado_a_jessica = cambios.notificadoAJessica;
  if (cambios.productoInteresNombre !== undefined) base.producto_interes_nombre = cambios.productoInteresNombre;
  const conAtencion =
    cambios.atencionHumanaDesde !== undefined ? { ...base, atencion_humana_desde: cambios.atencionHumanaDesde } : base;

  let { error } = await supabase.from(TABLA).update(conAtencion).eq("id", id);
  if (error && CODIGOS_COLUMNA_INEXISTENTE.has(error.code) && conAtencion !== base) {
    // Mismo criterio que crearEntradaAmore -- reintenta sin el campo nuevo.
    ({ error } = await supabase.from(TABLA).update(base).eq("id", id));
  }
  if (error) throw error;
}
