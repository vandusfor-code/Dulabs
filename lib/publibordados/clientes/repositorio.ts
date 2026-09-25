/**
 * Publi Bordados · módulo Clientes — acceso a datos.
 *
 * Todo pasa por las funciones SQL de 20261120000000_dulabs_pb_solicitudes.sql, que filtran por el
 * tenant recibido (el de la SESIÓN, nunca el del request) y por los números que ese tenant tiene
 * en dulabs_clientes_config. Búsqueda, filtros y paginación se resuelven en la base de datos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteDb, ClienteDetalleDb, SolicitudDb } from "@/lib/publibordados/clientes/modelo";

export interface MiembroEquipo {
  id: number;
  nombre: string | null;
  email: string | null;
  estado: string;
}

export interface Pagina<T> {
  total: number;
  filas: T[];
}

export type ResultadoActualizacion =
  | { resultado: "ok"; solicitud: SolicitudDb }
  | { resultado: "no_encontrada" | "conflicto" | "asesor_invalido" };

export interface ClientesRepositorio {
  listarClientes(tenantId: string, filtro: Record<string, unknown>): Promise<Pagina<ClienteDb>>;
  obtenerCliente(tenantId: string, clienteId: number): Promise<ClienteDetalleDb | null>;
  listarSolicitudes(tenantId: string, filtro: Record<string, unknown>): Promise<Pagina<SolicitudDb>>;
  obtenerSolicitud(tenantId: string, solicitudId: number): Promise<SolicitudDb | null>;
  actualizarSolicitud(tenantId: string, solicitudId: number, version: number, cambio: Record<string, unknown>): Promise<ResultadoActualizacion>;
  miembrosDelTenant(tenantId: string): Promise<MiembroEquipo[]>;
}

function fallo(contexto: string, error: { message: string }): never {
  throw new Error(`[publibordados/clientes] ${contexto}: ${error.message}`);
}

function comoPagina<T>(data: unknown): Pagina<T> {
  const d = (data ?? {}) as { total?: unknown; filas?: unknown };
  return { total: Number(d.total ?? 0), filas: Array.isArray(d.filas) ? (d.filas as T[]) : [] };
}

export function crearRepositorioClientes(supabase: SupabaseClient): ClientesRepositorio {
  return {
    async listarClientes(tenantId, filtro) {
      const { data, error } = await supabase.rpc("dulabs_pb_listar_clientes", { p_tenant: tenantId, p_filtro: filtro });
      if (error) fallo("listar clientes", error);
      return comoPagina<ClienteDb>(data);
    },

    async obtenerCliente(tenantId, clienteId) {
      const { data, error } = await supabase.rpc("dulabs_pb_obtener_cliente", { p_tenant: tenantId, p_contacto: clienteId });
      if (error) fallo("obtener cliente", error);
      return (data as ClienteDetalleDb | null) ?? null;
    },

    async listarSolicitudes(tenantId, filtro) {
      const { data, error } = await supabase.rpc("dulabs_pb_listar_solicitudes", { p_tenant: tenantId, p_filtro: filtro });
      if (error) fallo("listar solicitudes", error);
      return comoPagina<SolicitudDb>(data);
    },

    async obtenerSolicitud(tenantId, solicitudId) {
      const { data, error } = await supabase.rpc("dulabs_pb_obtener_solicitud", { p_tenant: tenantId, p_id: solicitudId });
      if (error) fallo("obtener solicitud", error);
      return (data as SolicitudDb | null) ?? null;
    },

    async actualizarSolicitud(tenantId, solicitudId, version, cambio) {
      const { data, error } = await supabase.rpc("dulabs_pb_actualizar_solicitud", {
        p_tenant: tenantId,
        p_id: solicitudId,
        p_version: version,
        p_cambio: cambio,
      });
      if (error) fallo("actualizar solicitud", error);
      return data as ResultadoActualizacion;
    },

    async miembrosDelTenant(tenantId) {
      const { data, error } = await supabase
        .from("dulabs_miembros_equipo")
        .select("id, nombre, email, estado")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true });
      if (error) fallo("equipo", error);
      return (data ?? []) as MiembroEquipo[];
    },
  };
}
