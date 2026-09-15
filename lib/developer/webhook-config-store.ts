import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { cifrarSecretoDev } from "@/lib/developer/secure-crypto";
import { validarUrlWebhookSegura } from "@/lib/developer/ssrf-guard";

// DuLabs Developer V1 -- Fase 2 (autorizado, sección 8 del brief). La URL
// SIEMPRE se valida contra ssrf-guard ANTES de tocar la base de datos --
// nunca se persiste una configuración peligrosa "para validarla después".

export type WebhookConfigFila = {
  id: string;
  workspace_id: string;
  whatsapp_number_id: string;
  url: string;
  estado: "activo" | "pausado";
  created_at: string;
  updated_at: string;
  rotated_at: string | null;
};

const CAMPOS_PUBLICOS = "id, workspace_id, whatsapp_number_id, url, estado, created_at, updated_at, rotated_at";

export type ResultadoConfigurarWebhook = { ok: true; fila: WebhookConfigFila; secreto: string } | { ok: false; motivo: "url_no_permitida"; detalle: string };

function generarSecretoWebhook(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

/** Crea o reemplaza la configuración de webhook de un número. El secreto se genera server-side, se muestra UNA vez en la respuesta (igual que una API key), y se persiste cifrado. */
export async function configurarWebhook(
  supabase: SupabaseClient,
  params: { workspaceId: string; whatsappNumberId: string; url: string }
): Promise<ResultadoConfigurarWebhook> {
  const validacion = await validarUrlWebhookSegura(params.url);
  if (!validacion.permitido) {
    return { ok: false, motivo: "url_no_permitida", detalle: validacion.motivo };
  }

  const secreto = generarSecretoWebhook();
  const { data, error } = await supabase
    .from("dulabs_dev_webhook_configs")
    .upsert(
      {
        workspace_id: params.workspaceId,
        whatsapp_number_id: params.whatsappNumberId,
        url: params.url,
        secret_cifrado: await cifrarSecretoDev(secreto),
        estado: "activo",
        updated_at: new Date().toISOString(),
        rotated_at: new Date().toISOString(),
      },
      { onConflict: "whatsapp_number_id" }
    )
    .select(CAMPOS_PUBLICOS)
    .single();
  if (error) throw new Error(`[developer/webhook-config-store] error configurando webhook: ${error.message}`);

  return { ok: true, fila: data as WebhookConfigFila, secreto };
}

export async function obtenerWebhookDelNumero(supabase: SupabaseClient, params: { workspaceId: string; whatsappNumberId: string }): Promise<WebhookConfigFila | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_webhook_configs")
    .select(CAMPOS_PUBLICOS)
    .eq("whatsapp_number_id", params.whatsappNumberId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (error) throw new Error(`[developer/webhook-config-store] error obteniendo webhook: ${error.message}`);
  return (data as WebhookConfigFila) ?? null;
}
