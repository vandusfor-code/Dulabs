/**
 * Autorización centralizada para acciones internas (Fase 4.1.2).
 * Verifica ownership tenant → recurso antes de I/O.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActivacionPorId } from "@/lib/marketplace-store";

export interface InternalActionAuthorizer {
  assertActivacionOwnedByTenant(tenantId: string, activacionId: number): Promise<boolean>;
  assertPhoneNumberOwnedByTenant(tenantId: string, phoneNumberId: string): Promise<boolean>;
}

export function createSupabaseInternalActionAuthorizer(
  supabase: SupabaseClient,
): InternalActionAuthorizer {
  return {
    async assertActivacionOwnedByTenant(tenantId, activacionId) {
      if (!activacionId || !tenantId) return false;
      const activacion = await getActivacionPorId(supabase, activacionId);
      if (!activacion) return false;
      return activacion.id_tenant === tenantId;
    },

    async assertPhoneNumberOwnedByTenant(tenantId, phoneNumberId) {
      if (!phoneNumberId || !tenantId) return false;
      const { data, error } = await supabase
        .from("dulabs_clientes_config")
        .select("id_tenant")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (error || !data) return false;
      return String(data.id_tenant) === tenantId;
    },
  };
}
