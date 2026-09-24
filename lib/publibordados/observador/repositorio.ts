/**
 * Única capa del observador que habla con Supabase. Solo LECTURAS de tablas compartidas
 * (dulabs_clientes_config, dulabs_mensajes_log) y escrituras EXCLUSIVAMENTE en tablas propias de
 * Publi Bordados (vía la RPC dulabs_pb_observar).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Observacion, OrigenesWamid } from "./extraer";

export interface ConfigObservador {
  phoneNumberId: string;
  idTenant: string;
}

export interface ObservadorStore {
  /** Config HABILITADA en shadow para el número, o null (sin fila, deshabilitada o tabla ausente). */
  configDe(phoneNumberId: string): Promise<ConfigObservador | null>;
  /** Tenant real del número según dulabs_clientes_config (identidad del webhook). */
  tenantDelNumero(phoneNumberId: string): Promise<string | null>;
  origenesDe(phoneNumberId: string, wamids: string[]): Promise<OrigenesWamid>;
  guardar(filas: Observacion[]): Promise<{ nuevas: number; repetidas: number }>;
}

export function createSupabaseObservadorStore(supabase: SupabaseClient): ObservadorStore {
  return {
    async configDe(phoneNumberId) {
      const { data, error } = await supabase
        .from("dulabs_pb_config")
        .select("phone_number_id, id_tenant, enabled, shadow_mode")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (error) throw new Error(`config: ${error.code ?? ""} ${error.message}`);
      if (!data || data.enabled !== true || data.shadow_mode !== true) return null;
      return { phoneNumberId: String(data.phone_number_id), idTenant: String(data.id_tenant) };
    },
    async tenantDelNumero(phoneNumberId) {
      const { data, error } = await supabase.from("dulabs_clientes_config").select("id_tenant").eq("phone_number_id", phoneNumberId).maybeSingle();
      if (error) throw new Error(`tenant: ${error.code ?? ""} ${error.message}`);
      return data?.id_tenant ? String(data.id_tenant) : null;
    },
    async origenesDe(phoneNumberId, wamids) {
      const pb = new Set<string>();
      const plataforma = new Map<string, string>();
      if (wamids.length === 0) return { pb, plataforma };
      const enviados = await supabase.from("dulabs_pb_mensajes_enviados").select("wamid").eq("phone_number_id", phoneNumberId).in("wamid", wamids);
      if (enviados.error) throw new Error(`enviados: ${enviados.error.code ?? ""} ${enviados.error.message}`);
      for (const r of enviados.data ?? []) pb.add(String(r.wamid));
      const log = await supabase
        .from("dulabs_mensajes_log")
        .select("wamid, origen")
        .eq("phone_number_id", phoneNumberId)
        .eq("direccion", "saliente")
        .in("wamid", wamids);
      if (log.error) throw new Error(`log: ${log.error.code ?? ""} ${log.error.message}`);
      for (const r of log.data ?? []) plataforma.set(String(r.wamid), String(r.origen));
      return { pb, plataforma };
    },
    async guardar(filas) {
      if (filas.length === 0) return { nuevas: 0, repetidas: 0 };
      const { data, error } = await supabase.rpc("dulabs_pb_observar", { p_filas: filas });
      if (error) throw new Error(`guardar: ${error.code ?? ""} ${error.message}`);
      const res = (data ?? []) as { nueva: boolean }[];
      const nuevas = res.filter((r) => r.nueva).length;
      return { nuevas, repetidas: res.length - nuevas };
    },
  };
}
