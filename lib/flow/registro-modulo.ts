/**
 * Contrato GENÉRICO de la acción `registrar_en_modulo` (ver RegistrarEnModuloActionConfig).
 *
 * El motor no sabe qué guarda cada módulo: verifica tenant, número y módulo habilitado y
 * delega en el manejador que el módulo registró en lib/modulos/registros-flow.ts. El
 * manejador debe ser IDEMPOTENTE por `flowExecutionId` (una ejecución real → un registro):
 * es lo que hace seguros los reintentos y la conciliación (lib/flow/registro-modulo-*.ts).
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

/** Valores que viajan al módulo: solo primitivos; cualquier otra cosa (o ausente) llega como null. */
export function valoresDeCampos(campos: Record<string, string>, variables: Record<string, unknown>): Record<string, ValorCampoModulo> {
  const valores: Record<string, ValorCampoModulo> = {};
  for (const [campo, variable] of Object.entries(campos)) {
    const valor = variables[variable];
    valores[campo] = typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean" ? valor : null;
  }
  return valores;
}

// ---------------------------------------------------------------------------
// Respaldo / conciliación (tabla dulabs_registros_modulo)
// ---------------------------------------------------------------------------

export type EstadoRegistroModulo = "pendiente" | "registrado" | "fallido";

/** Fila reclamada por el conciliador, con las variables de su ejecución ORIGINAL. */
export interface RegistroModuloReclamado {
  id: number;
  tenantId: string;
  modulo: string;
  flowExecutionId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  campos: Record<string, string>;
  intentos: number;
  /** null: la ejecución ya no existe o no coincide en tenant, número y teléfono. */
  variables: Record<string, unknown> | null;
}

export interface ResumenRegistrosModulo {
  pendientes: number;
  fallidos: number;
  filas: Array<{
    id: number;
    estado: EstadoRegistroModulo;
    telefono: string;
    flowExecutionId: string;
    intentos: number;
    ultimoError: string | null;
    proximoIntentoAt: string;
    createdAt: string;
  }>;
}

/** Almacenamiento del respaldo. Todas las operaciones lanzan si la BD falla. */
export interface RegistrosModuloStore {
  abrir(input: {
    tenantId: string;
    modulo: string;
    flowExecutionId: string;
    phoneNumberId: string;
    telefonoCliente: string;
    nodeId: string;
    campos: Record<string, string>;
    graciaSegundos: number;
  }): Promise<{ id: number; estado: EstadoRegistroModulo; intentos: number }>;
  resolver(input: {
    tenantId: string;
    id: number;
    estado: EstadoRegistroModulo;
    registroId?: string | number | null;
    error?: string | null;
    reintentarEnSegundos?: number;
  }): Promise<{ actualizado: boolean }>;
  reclamar(input: { limite: number; tenantId?: string | null; leaseSegundos: number }): Promise<RegistroModuloReclamado[]>;
  resumen(tenantId: string, modulo: string): Promise<ResumenRegistrosModulo>;
  reencolar(tenantId: string, id: number): Promise<boolean>;
}
