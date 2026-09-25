import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Módulos del dashboard habilitables por tenant (tabla dulabs_tenant_modulos,
 * migración 20261105000000). Mecanismo GENÉRICO: ningún negocio se identifica
 * por nombre en el código -- un módulo se enciende insertando una fila para el
 * tenant. Agregar un módulo nuevo = agregar su id a MODULOS.
 */
export const MODULOS = ["catalogo", "publibordados_clientes", "pedidos"] as const;
export type ModuloId = (typeof MODULOS)[number];

export function esModuloId(valor: unknown): valor is ModuloId {
  return typeof valor === "string" && (MODULOS as readonly string[]).includes(valor);
}

const TABLA = "dulabs_tenant_modulos";

/**
 * Módulos habilitados del tenant, para PRESENTACIÓN (menú del dashboard).
 * Best-effort a propósito, igual que estado_conexion en /api/dashboard/me: si
 * la migración aún no se aplicó (tabla inexistente) o la consulta falla, se
 * devuelve [] y el dashboard de TODOS los tenants sigue funcionando. Nunca se
 * usa para autorizar -- para eso está moduloHabilitado().
 */
export async function modulosHabilitados(supabase: SupabaseClient, tenantId: string): Promise<ModuloId[]> {
  const { data, error } = await supabase.from(TABLA).select("modulo").eq("id_tenant", tenantId).eq("habilitado", true);
  if (error) {
    console.warn("[tenant-modulos] no se pudieron leer los módulos (se asume ninguno):", error.message);
    return [];
  }
  return ((data ?? []) as Array<{ modulo: string }>).map((f) => f.modulo).filter(esModuloId);
}

/**
 * Verificación ESTRICTA para AUTORIZAR una operación del módulo. Un error de
 * infraestructura se PROPAGA (throw): "no pude verificar" nunca se confunde
 * con "habilitado" (fail-closed) ni con "no habilitado" (el caller responde
 * 500, no un 403 engañoso).
 */
export async function moduloHabilitado(supabase: SupabaseClient, tenantId: string, modulo: ModuloId): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLA)
    .select("habilitado")
    .eq("id_tenant", tenantId)
    .eq("modulo", modulo)
    .maybeSingle();
  if (error) throw new Error(`[tenant-modulos] error verificando el módulo ${modulo}: ${error.message}`);
  return Boolean((data as { habilitado?: boolean } | null)?.habilitado);
}
