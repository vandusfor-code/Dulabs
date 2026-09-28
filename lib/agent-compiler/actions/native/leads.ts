// DuLabs Business — Business Agent 2.0, FASE 8 — captura de interesados (lead capture).
//
// Fuente de verdad: el CONTACTO del negocio (dulabs_clientes_conocidos), la MISMA tabla donde el grafo guarda los
// datos del cliente (save_data / custom_fields). No se crea otra fuente de verdad. A diferencia de los helpers del
// grafo (que nunca fallan en voz alta), este store FALLA si no pudo escribir: el agente nunca dice "guardé tus datos"
// sin haberlos guardado.
//
// PII: los valores solo viajan al store; el resultado de la acción, las trazas y el registro de ejecuciones guardan
// únicamente CUÁNTOS campos se guardaron.

import type { SupabaseClient } from "@supabase/supabase-js";
import { siguienteMarcaDeTiempo } from "@/lib/clientes-conocidos";

export interface LeadRecord {
  tenantId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  /** nombreCliente → columna nombre; correoCliente → columna correo; el resto → custom_fields. */
  fields: Readonly<Record<string, string>>;
  interest: string | null;
  capturedAt: string;
}

export interface LeadContactPort {
  save(lead: LeadRecord): Promise<{ saved: number }>;
}

const NAME_KEY = "nombreCliente";
const EMAIL_KEY = "correoCliente";
const MAX_ATTEMPTS = 4;

/** Campos que se guardan: SOLO las claves configuradas por el negocio (lead_capture.fieldKeys), no vacíos, acotados. */
export function leadFieldsToSave(data: Readonly<Record<string, unknown>>, fieldKeys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of fieldKeys) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}

export function createSupabaseLeadContactStore(supabase: SupabaseClient): LeadContactPort {
  return {
    async save(lead) {
      const custom: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(lead.fields)) if (k !== NAME_KEY && k !== EMAIL_KEY) custom[k] = v;
      if (lead.interest) custom.ba_interes = lead.interest;
      custom.ba_lead_capturado_en = lead.capturedAt;
      const columns: Record<string, string> = {};
      if (lead.fields[NAME_KEY]) columns.nombre = lead.fields[NAME_KEY]!;
      if (lead.fields[EMAIL_KEY]) columns.correo = lead.fields[EMAIL_KEY]!;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const { data: existing, error: readError } = await supabase
          .from("dulabs_clientes_conocidos")
          .select("id_tenant, custom_fields, updated_at")
          .eq("phone_number_id", lead.phoneNumberId)
          .eq("telefono_cliente", lead.telefonoCliente)
          .maybeSingle();
        if (readError) throw new Error(`lead_read_failed:${readError.code ?? "unknown"}`);
        if (!existing) {
          const { error } = await supabase.from("dulabs_clientes_conocidos").insert({
            id_tenant: lead.tenantId,
            phone_number_id: lead.phoneNumberId,
            telefono_cliente: lead.telefonoCliente,
            nombre: columns.nombre ?? lead.telefonoCliente,
            ...(columns.correo ? { correo: columns.correo } : {}),
            custom_fields: custom,
          });
          if (!error) return { saved: Object.keys(lead.fields).length };
          if (error.code !== "23505") throw new Error(`lead_insert_failed:${error.code ?? "unknown"}`);
          continue;
        }
        // El contacto de ese número es de OTRO tenant: nunca se escribe (aislamiento multi-tenant).
        if (existing.id_tenant && existing.id_tenant !== lead.tenantId) throw new Error("lead_tenant_mismatch");
        const merged = { ...((existing.custom_fields as Record<string, unknown> | null) ?? {}), ...custom };
        const read = existing.updated_at as string;
        const { data: written, error: writeError } = await supabase
          .from("dulabs_clientes_conocidos")
          .update({ ...columns, custom_fields: merged, updated_at: siguienteMarcaDeTiempo(read) })
          .eq("phone_number_id", lead.phoneNumberId)
          .eq("telefono_cliente", lead.telefonoCliente)
          .eq("id_tenant", lead.tenantId)
          .eq("updated_at", read)
          .select("id");
        if (writeError) throw new Error(`lead_write_failed:${writeError.code ?? "unknown"}`);
        if ((written ?? []).length > 0) return { saved: Object.keys(lead.fields).length };
      }
      throw new Error("lead_write_conflict");
    },
  };
}
