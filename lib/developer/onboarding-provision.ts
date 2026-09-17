import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer V1 -- provisión de onboarding. Envuelve el RPC atómico
// dulabs_dev_provisionar_onboarding (crea cuenta DEVELOPER + workspace +
// membership OWNER de forma idempotente). Reutiliza los mismos RPCs/tablas de
// Fase 11; no crea arquitectura paralela. El caller (ruta) ya validó la
// identidad humana con auth.getUser: el userId que se pasa es de confianza.

export type ResultadoProvision = { workspaceId: string; created: boolean };

export async function provisionarOnboardingDeveloper(
  supabase: SupabaseClient,
  userId: string
): Promise<ResultadoProvision> {
  const { data, error } = await supabase.rpc("dulabs_dev_provisionar_onboarding", {
    p_owner_user_id: userId,
  });
  if (error) throw new Error(`[developer/onboarding] error provisionando workspace: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila?.workspace_id) throw new Error("[developer/onboarding] provisionar_onboarding no devolvió workspace_id");
  return { workspaceId: fila.workspace_id as string, created: Boolean(fila.created) };
}
