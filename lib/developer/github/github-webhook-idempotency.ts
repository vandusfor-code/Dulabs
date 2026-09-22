import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// Idempotencia del webhook de GitHub por X-GitHub-Delivery (id único por
// entrega). GitHub reintenta entregas; nunca se debe procesar dos veces la
// misma. Se inserta el delivery_id; si ya existía (23505), es un reintento.

/**
 * Registra el delivery. Devuelve true si es NUEVO (procesar), false si ya se
 * había visto (reintento => ignorar). Un delivery_id ausente se trata como
 * nuevo pero no se puede deduplicar (GitHub siempre lo envía).
 */
export async function registrarDeliveryGithub(
  supabase: SupabaseClient,
  params: { deliveryId: string | null; evento: string | null }
): Promise<boolean> {
  if (!params.deliveryId) return true;
  const { error } = await supabase
    .from("dulabs_dev_github_webhook_deliveries")
    .insert({ delivery_id: params.deliveryId, evento: params.evento });
  if (!error) return true;
  if (error.code === "23505") return false; // ya procesado
  throw new Error(`[github/webhook-idempotency] error registrando delivery: ${error.message}`);
}
