/**
 * Contrato GENÉRICO de la acción `registrar_en_modulo` (ver RegistrarEnModuloActionConfig).
 *
 * El motor no sabe qué guarda cada módulo: verifica tenant, número y módulo habilitado y
 * delega en el manejador que el módulo registró en lib/modulos/registros-flow.ts. El
 * manejador debe ser IDEMPOTENTE por `flowExecutionId` (una ejecución real → un registro).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ValorCampoModulo = string | number | boolean | null;

export interface RegistroModuloInput {
  supabase: SupabaseClient;
  tenantId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  /** dulabs_flow_executions.id de la ejecución REAL que dispara el registro. */
  flowExecutionId: string;
  /** campo del módulo → valor de la variable del flow declarada en `campos`. */
  campos: Record<string, ValorCampoModulo>;
}

export type RegistroModuloResultado =
  | { ok: true; registroId: string | number; creado: boolean }
  | { ok: false; motivo: string; reintentable: boolean };

export type ManejadorRegistroModulo = (input: RegistroModuloInput) => Promise<RegistroModuloResultado>;
