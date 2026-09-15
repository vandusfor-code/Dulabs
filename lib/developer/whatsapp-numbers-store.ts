import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrarSecretoDev, descifrarSecretoDev } from "@/lib/developer/secure-crypto";

// DuLabs Developer V1 -- Fase 2 (autorizado, sección 7 del brief). Números
// de WhatsApp de los clientes de un desarrollador. El token de Meta nunca
// se persiste en claro -- pasa siempre por secure-crypto (fail-closed).

export type NumeroWhatsAppFila = {
  id: string;
  workspace_id: string;
  phone_number_id: string;
  whatsapp_business_account_id: string | null;
  display_name: string | null;
  estado: "pendiente" | "conectado" | "desconectado" | "error";
  created_at: string;
  updated_at: string;
};

const CAMPOS_PUBLICOS = "id, workspace_id, phone_number_id, whatsapp_business_account_id, display_name, estado, created_at, updated_at";

export type ResultadoRegistroNumero = { ok: true; fila: NumeroWhatsAppFila } | { ok: false; motivo: "numero_ya_conectado_a_otro_workspace" };

/**
 * Registra (o reconecta) un número. phone_number_id es único GLOBAL (ver
 * migración) -- si ya pertenece a OTRO workspace, esto se rechaza
 * explícitamente en vez de dejar que el constraint de Postgres lance un
 * error genérico de duplicado que el caller tendría que interpretar.
 */
export async function registrarNumero(
  supabase: SupabaseClient,
  params: { workspaceId: string; phoneNumberId: string; wabaId?: string | null; displayName?: string | null; metaToken?: string | null }
): Promise<ResultadoRegistroNumero> {
  const { data: existente } = await supabase
    .from("dulabs_dev_whatsapp_numbers")
    .select("workspace_id")
    .eq("phone_number_id", params.phoneNumberId)
    .maybeSingle();
  if (existente && existente.workspace_id !== params.workspaceId) {
    return { ok: false, motivo: "numero_ya_conectado_a_otro_workspace" };
  }

  const cambios: Record<string, unknown> = {
    workspace_id: params.workspaceId,
    phone_number_id: params.phoneNumberId,
    whatsapp_business_account_id: params.wabaId ?? null,
    display_name: params.displayName ?? null,
    estado: "conectado",
    updated_at: new Date().toISOString(),
  };
  if (params.metaToken) cambios.meta_token_cifrado = await cifrarSecretoDev(params.metaToken);

  const { data, error } = await supabase
    .from("dulabs_dev_whatsapp_numbers")
    .upsert(cambios, { onConflict: "phone_number_id" })
    .select(CAMPOS_PUBLICOS)
    .single();
  if (error) throw new Error(`[developer/whatsapp-numbers-store] error registrando número: ${error.message}`);
  return { ok: true, fila: data as NumeroWhatsAppFila };
}

export async function listarNumeros(supabase: SupabaseClient, workspaceId: string): Promise<NumeroWhatsAppFila[]> {
  const { data, error } = await supabase
    .from("dulabs_dev_whatsapp_numbers")
    .select(CAMPOS_PUBLICOS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[developer/whatsapp-numbers-store] error listando números: ${error.message}`);
  return (data ?? []) as NumeroWhatsAppFila[];
}

/** Obtiene el número YA VERIFICADO como perteneciente a ese workspace exacto -- nunca resuelve un número sin el workspace_id como parte del filtro. */
export async function obtenerNumeroDelWorkspace(supabase: SupabaseClient, params: { workspaceId: string; numeroId: string }): Promise<NumeroWhatsAppFila | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_whatsapp_numbers")
    .select(CAMPOS_PUBLICOS)
    .eq("id", params.numeroId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (error) throw new Error(`[developer/whatsapp-numbers-store] error obteniendo número: ${error.message}`);
  return (data as NumeroWhatsAppFila) ?? null;
}

/** Descifra el token de Meta de un número -- función separada a propósito (nunca se devuelve por defecto en las consultas de arriba, solo cuando el caller explícitamente lo necesita para llamar a la Graph API). */
export async function obtenerTokenMetaDelNumero(supabase: SupabaseClient, params: { workspaceId: string; numeroId: string }): Promise<string | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_whatsapp_numbers")
    .select("meta_token_cifrado")
    .eq("id", params.numeroId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (error) throw new Error(`[developer/whatsapp-numbers-store] error obteniendo token: ${error.message}`);
  if (!data?.meta_token_cifrado) return null;
  return await descifrarSecretoDev(data.meta_token_cifrado);
}
