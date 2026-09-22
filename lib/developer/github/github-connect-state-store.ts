import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// Nonce single-use que liga la redirección de instalación con el workspace/
// usuario que la inició (anti-CSRF). Se crea en una request autenticada
// (OWNER/ADMIN) y se consume una sola vez en el callback (que llega sin sesión).

const TTL_MS = 15 * 60 * 1000; // 15 min: suficiente para instalar; corto para no acumular.

/** Crea un state y devuelve su id (uuid). El backend corre con service_role. */
export async function crearConnectState(
  supabase: SupabaseClient,
  params: { workspaceId: string; userId: string; ahoraMs?: number }
): Promise<string> {
  const expira = new Date((params.ahoraMs ?? Date.now()) + TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("dulabs_dev_github_connect_states")
    .insert({ workspace_id: params.workspaceId, user_id: params.userId, expires_at: expira })
    .select("state")
    .single();
  if (error) throw new Error(`[github/connect-state] error creando state: ${error.message}`);
  return data.state as string;
}

export type ConnectStateConsumido = { workspaceId: string; userId: string };

/**
 * Consume un state: lo borra y devuelve su (workspace, user) SOLO si existía y
 * no había expirado. Single-use por el DELETE ... returning (una segunda
 * llamada con el mismo state devuelve null). null = inválido/expirado/ya usado.
 */
export async function consumirConnectState(
  supabase: SupabaseClient,
  params: { state: string; ahoraMs?: number }
): Promise<ConnectStateConsumido | null> {
  // Validación de forma: si no es un uuid, ni siquiera tocamos la tabla.
  if (!/^[0-9a-f-]{36}$/i.test(params.state)) return null;
  const { data, error } = await supabase
    .from("dulabs_dev_github_connect_states")
    .delete()
    .eq("state", params.state)
    .select("workspace_id, user_id, expires_at")
    .maybeSingle();
  if (error) throw new Error(`[github/connect-state] error consumiendo state: ${error.message}`);
  if (!data) return null;
  const ahora = params.ahoraMs ?? Date.now();
  if (new Date(data.expires_at as string).getTime() < ahora) return null; // expirado (ya quedó borrado)
  return { workspaceId: data.workspace_id as string, userId: data.user_id as string };
}

/** Limpieza oportunista de states vencidos (no crítica; el consumo ya valida expiry). */
export async function limpiarConnectStatesVencidos(supabase: SupabaseClient, ahoraMs?: number): Promise<void> {
  const ahora = new Date(ahoraMs ?? Date.now()).toISOString();
  await supabase.from("dulabs_dev_github_connect_states").delete().lt("expires_at", ahora);
}
