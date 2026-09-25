/**
 * `registrar_en_modulo` — RESPALDO y CONCILIACIÓN (genérico, sin negocio concreto).
 *
 * - crearRegistrosModuloStore: RPC sobre dulabs_registros_modulo
 *   (supabase/migrations/20261121000000_dulabs_registros_modulo.sql).
 * - conciliarRegistrosDeModulo: toma filas "pendiente" vencidas (reclamo con SKIP LOCKED + lease),
 *   reconstruye los valores desde las variables de la EJECUCIÓN ORIGINAL, vuelve a pasar TODAS
 *   las barreras (número del tenant, módulo conocido y habilitado, manejador) y llama al
 *   manejador del módulo, idempotente por la ejecución. Seguro de correr varias veces y en
 *   paralelo: el reclamo evita trabajo doble y, aun si ocurriera, el registro no se duplica
 *   (UNIQUE del módulo por ejecución).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  valoresDeCampos,
  type EstadoRegistroModulo,
  type RegistroModuloReclamado,
  type RegistrosModuloStore,
  type ResumenRegistrosModulo,
} from "@/lib/flow/registro-modulo";
import {
  intentarRegistroEnModulo,
  POLITICA_CONCILIACION,
  type ProcesadorRegistroDeps,
  type ResultadoIntentoRegistro,
} from "@/lib/flow/registro-modulo-procesador";

async function rpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`[registro-modulo] ${fn}: ${error.message}`);
  return data as T;
}

export function crearRegistrosModuloStore(supabase: SupabaseClient): RegistrosModuloStore {
  return {
    abrir: (i) =>
      rpc(supabase, "dulabs_registro_modulo_abrir", {
        p_tenant: i.tenantId,
        p_modulo: i.modulo,
        p_flow_execution_id: i.flowExecutionId,
        p_phone_number_id: i.phoneNumberId,
        p_telefono: i.telefonoCliente,
        p_node_id: i.nodeId,
        p_campos: i.campos,
        p_gracia_segundos: i.graciaSegundos,
      }),
    resolver: (i) =>
      rpc(supabase, "dulabs_registro_modulo_resolver", {
        p_tenant: i.tenantId,
        p_id: i.id,
        p_estado: i.estado,
        p_registro_id: i.registroId === undefined || i.registroId === null ? null : String(i.registroId),
        p_error: i.error ?? null,
        p_reintentar_en_segundos: i.reintentarEnSegundos ?? null,
      }),
    reclamar: async (i) =>
      ((await rpc<RegistroModuloReclamado[] | null>(supabase, "dulabs_registro_modulo_reclamar", {
        p_limite: i.limite,
        p_tenant: i.tenantId ?? null,
        p_lease_segundos: i.leaseSegundos,
      })) ?? []),
    resumen: (tenantId, modulo) => rpc<ResumenRegistrosModulo>(supabase, "dulabs_registro_modulo_resumen", { p_tenant: tenantId, p_modulo: modulo }),
    reencolar: async (tenantId, id) =>
      Boolean((await rpc<{ reencolado: boolean }>(supabase, "dulabs_registro_modulo_reencolar", { p_tenant: tenantId, p_id: id }))?.reencolado),
  };
}

export interface ConciliacionDeps extends ProcesadorRegistroDeps {
  store: RegistrosModuloStore;
}

export interface ResultadoConciliacion {
  procesados: number;
  registrados: number;
  fallidos: number;
  pendientes: number;
  errores: number;
}

/** Decide cómo queda la fila tras una ronda del conciliador. */
function cierre(fila: RegistroModuloReclamado, r: ResultadoIntentoRegistro): {
  estado: EstadoRegistroModulo;
  registroId?: string | number;
  error?: string;
  reintentarEnSegundos?: number;
} {
  switch (r.tipo) {
    case "registrado":
      return { estado: "registrado", registroId: r.registroId };
    case "permanente":
    case "rechazado":
      return { estado: "fallido", error: r.motivo };
    case "transitorio": {
      const ronda = fila.intentos + 1;
      if (ronda >= POLITICA_CONCILIACION.maxRondas) return { estado: "fallido", error: `reintentos_agotados:${r.motivo}` };
      return { estado: "pendiente", error: r.motivo, reintentarEnSegundos: POLITICA_CONCILIACION.esperaSegundos(ronda) };
    }
  }
}

/**
 * Reprocesa hasta `limite` filas vencidas (de todos los tenants, o solo de `tenantId` cuando lo
 * dispara el dashboard de ese tenant). Nunca lanza por una fila: la deja reintentable.
 */
export async function conciliarRegistrosDeModulo(
  deps: ConciliacionDeps,
  opts: { tenantId?: string | null; limite?: number; leaseSegundos?: number; presupuestoMs?: number; ahoraMs?: () => number } = {},
): Promise<ResultadoConciliacion> {
  const resultado: ResultadoConciliacion = { procesados: 0, registrados: 0, fallidos: 0, pendientes: 0, errores: 0 };
  const ahora = opts.ahoraMs ?? Date.now;
  const limiteTiempo = ahora() + (opts.presupuestoMs ?? 40_000);
  const filas = await deps.store.reclamar({ limite: opts.limite ?? 50, tenantId: opts.tenantId ?? null, leaseSegundos: opts.leaseSegundos ?? 120 });
  for (const fila of filas) {
    // Presupuesto de tiempo (función serverless): las filas no procesadas conservan su lease y
    // otra ronda las retoma cuando vence. Nunca se procesan a medias.
    if (ahora() >= limiteTiempo) break;
    resultado.procesados++;
    try {
      // La ejecución original es la única fuente de los datos: sin ella no se inventa nada.
      const r: ResultadoIntentoRegistro = fila.variables
        ? await intentarRegistroEnModulo(deps, {
            tenantId: fila.tenantId,
            phoneNumberId: fila.phoneNumberId,
            telefonoCliente: fila.telefonoCliente,
            flowExecutionId: fila.flowExecutionId,
            modulo: fila.modulo,
            campos: valoresDeCampos(fila.campos, fila.variables),
          })
        : { tipo: "permanente", motivo: "ejecucion_inexistente" };
      const c = cierre(fila, r);
      await deps.store.resolver({ tenantId: fila.tenantId, id: fila.id, ...c });
      if (c.estado === "registrado") resultado.registrados++;
      else if (c.estado === "fallido") resultado.fallidos++;
      else resultado.pendientes++;
      if (c.estado !== "registrado") {
        console.warn(
          `[registro-modulo] CONCILIACION_${c.estado.toUpperCase()} tenant=${fila.tenantId} modulo=${fila.modulo} ejecucion=${fila.flowExecutionId} registro=${fila.id} motivo=${c.error}`,
        );
      }
    } catch (err) {
      // No se pudo ni cerrar la fila: el lease vence y otra ronda la retoma.
      resultado.errores++;
      console.error(`[registro-modulo] CONCILIACION_ERROR registro=${fila.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return resultado;
}
