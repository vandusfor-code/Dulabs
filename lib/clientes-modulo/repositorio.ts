/**
 * Módulo Clientes — acceso a datos. TODA consulta va acotada por:
 *   1. id_tenant de la sesión (nunca del request), y
 *   2. los números de WhatsApp que pertenecen a ese tenant
 *      (dulabs_clientes_config.id_tenant).
 * La unicidad de dulabs_clientes_conocidos es (phone_number_id,
 * telefono_cliente), no por tenant: por eso se exigen AMBOS filtros, así una
 * fila vieja de un número que cambió de tenant nunca se filtra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPOS, type FilaContacto } from "@/lib/clientes-modulo/modelo";

const COLUMNAS = "id, id_tenant, phone_number_id, telefono_cliente, nombre, custom_fields, created_at, updated_at";
/** Tope defensivo de clientes leídos por consulta (la paginación y la búsqueda van sobre este conjunto). */
export const TOPE_CLIENTES = 2000;

/** Nodo final del Flow tras transferir a la asesora (lib/flows/publibordados.flow.ts). */
const NODO_TRANSFERIDO = "end-transferido";

export interface MiembroEquipo {
  id: number;
  nombre: string | null;
  email: string | null;
  estado: string;
}

export interface ClientesRepositorio {
  numerosDelTenant(tenantId: string): Promise<string[]>;
  listarContactos(tenantId: string, numeros: string[]): Promise<FilaContacto[]>;
  obtenerContacto(tenantId: string, numeros: string[], id: number): Promise<FilaContacto | null>;
  miembrosDelTenant(tenantId: string): Promise<MiembroEquipo[]>;
  ultimoContacto(numero: string, telefono: string): Promise<string | null>;
  ultimaSolicitud(tenantId: string, numero: string, telefono: string): Promise<string | null>;
  /** Escribe custom_fields SOLO si la fila no cambió desde que se leyó (updated_at); true si se escribió. */
  actualizarCustomFields(
    tenantId: string,
    numeros: string[],
    id: number,
    leidoEn: string,
    customFields: Record<string, unknown>,
  ): Promise<FilaContacto | null>;
}

function fallo(contexto: string, error: { message: string }): never {
  throw new Error(`[clientes] ${contexto}: ${error.message}`);
}

export function crearRepositorioClientes(supabase: SupabaseClient): ClientesRepositorio {
  return {
    async numerosDelTenant(tenantId) {
      const { data, error } = await supabase.from("dulabs_clientes_config").select("phone_number_id").eq("id_tenant", tenantId);
      if (error) fallo("números del tenant", error);
      return ((data ?? []) as Array<{ phone_number_id: string | null }>).map((f) => f.phone_number_id).filter((n): n is string => !!n);
    },

    async listarContactos(tenantId, numeros) {
      if (numeros.length === 0) return [];
      const { data, error } = await supabase
        .from("dulabs_clientes_conocidos")
        .select(COLUMNAS)
        .eq("id_tenant", tenantId)
        .in("phone_number_id", numeros)
        .not(`custom_fields->>${CAMPOS.estado}`, "is", null)
        .order("updated_at", { ascending: false })
        .limit(TOPE_CLIENTES);
      if (error) fallo("listar clientes", error);
      return (data ?? []) as FilaContacto[];
    },

    async obtenerContacto(tenantId, numeros, id) {
      if (numeros.length === 0) return null;
      const { data, error } = await supabase
        .from("dulabs_clientes_conocidos")
        .select(COLUMNAS)
        .eq("id", id)
        .eq("id_tenant", tenantId)
        .in("phone_number_id", numeros)
        .maybeSingle();
      if (error) fallo("obtener cliente", error);
      return (data as FilaContacto | null) ?? null;
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

    async ultimoContacto(numero, telefono) {
      const { data, error } = await supabase
        .from("dulabs_mensajes_log")
        .select("created_at")
        .eq("phone_number_id", numero)
        .eq("telefono_cliente", telefono)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) fallo("último contacto", error);
      return ((data ?? []) as Array<{ created_at: string }>)[0]?.created_at ?? null;
    },

    async ultimaSolicitud(tenantId, numero, telefono) {
      const { data, error } = await supabase
        .from("dulabs_flow_executions")
        .select("last_activity_at")
        .eq("tenant_id", tenantId)
        .eq("phone_number_id", numero)
        .eq("telefono_cliente", telefono)
        .eq("current_node_id", NODO_TRANSFERIDO)
        .order("last_activity_at", { ascending: false })
        .limit(1);
      if (error) fallo("última solicitud", error);
      return ((data ?? []) as Array<{ last_activity_at: string }>)[0]?.last_activity_at ?? null;
    },

    async actualizarCustomFields(tenantId, numeros, id, leidoEn, customFields) {
      if (numeros.length === 0) return null;
      const { data, error } = await supabase
        .from("dulabs_clientes_conocidos")
        .update({ custom_fields: customFields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("id_tenant", tenantId)
        .in("phone_number_id", numeros)
        .eq("updated_at", leidoEn)
        .select(COLUMNAS);
      if (error) fallo("actualizar cliente", error);
      return ((data ?? []) as FilaContacto[])[0] ?? null;
    },
  };
}
