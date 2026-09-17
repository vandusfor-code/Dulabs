import type { SupabaseClient } from "@supabase/supabase-js";
import { generarApiKey, verificarApiKey, hashearApiKey, type ApiKeyGenerada } from "@/lib/developer/api-keys";

// DuLabs Developer V1 -- Fase 2 (autorizado, sección 6 del brief). Capa de
// persistencia sobre lib/developer/api-keys.ts (que se queda pura, sin
// tocar -- no romper Fase 1). Nunca guarda ni devuelve la clave en claro
// salvo en el momento exacto de creación (crearApiKey), como exige el
// brief.

export type ApiKeyFila = {
  id: string;
  workspace_id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

// DuLabs Developer V1 -- Fase 19 (Controlled Beta, 19.5). Cap de API keys
// ACTIVAS por workspace: evita la creación masiva (abuso/ruido) durante la beta.
// Es un tope "suave" (cuenta + inserta): una carrera extrema podría dejar +1,
// aceptable para un control anti-abuso (no es un límite de facturación).
export const MAX_API_KEYS_ACTIVAS = 20;

export class ErrorLimiteApiKeys extends Error {
  constructor(public readonly limite: number) {
    super(`limite_api_keys:${limite}`);
    this.name = "ErrorLimiteApiKeys";
  }
}

/** Cuenta las API keys NO revocadas de un workspace. */
export async function contarApiKeysActivas(supabase: SupabaseClient, workspaceId: string): Promise<number> {
  const { count, error } = await supabase
    .from("dulabs_dev_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);
  if (error) throw new Error(`[developer/api-keys-store] error contando API keys: ${error.message}`);
  return count ?? 0;
}

export async function crearApiKey(
  supabase: SupabaseClient,
  params: { workspaceId: string; name: string }
): Promise<{ fila: ApiKeyFila; claveEnClaro: string }> {
  // Fase 19: tope anti creación masiva. Se cuenta ANTES de crear.
  if ((await contarApiKeysActivas(supabase, params.workspaceId)) >= MAX_API_KEYS_ACTIVAS) {
    throw new ErrorLimiteApiKeys(MAX_API_KEYS_ACTIVAS);
  }
  const generada: ApiKeyGenerada = generarApiKey();
  const prefix = generada.claveEnClaro.slice(0, 12); // "dl_live_XXXX" -- suficiente para que el desarrollador reconozca la key en una lista, insuficiente para reconstruirla.

  const { data, error } = await supabase
    .from("dulabs_dev_api_keys")
    .insert({ workspace_id: params.workspaceId, name: params.name, key_hash: generada.hash, prefix })
    .select("id, workspace_id, name, prefix, created_at, last_used_at, revoked_at")
    .single();
  if (error) throw new Error(`[developer/api-keys-store] error creando API key: ${error.message}`);

  return { fila: data as ApiKeyFila, claveEnClaro: generada.claveEnClaro };
}

export type ResultadoAutenticacion =
  | { autenticado: true; workspaceId: string; apiKeyId: string; apiKeyPrefix: string; apiKeyName: string }
  | { autenticado: false; motivo: "no_encontrada" | "revocada" };

/**
 * Autentica una request entrante por su API key. Busca por key_hash
 * (índice único global, O(1) -- ver migración), NUNCA compara contra cada
 * fila en memoria con verificarApiKey uno por uno (eso sería O(n) y
 * expondría timing entre filas). Registra last_used_at como efecto
 * secundario -- best effort, un fallo ahí nunca bloquea la autenticación
 * real.
 *
 * Fase 4 (autorizado, capa de autenticación de la Developer API) -- ahora
 * también devuelve `prefix`/`name` (ya se seleccionaban implícitamente por
 * columna, solo faltaba incluirlos en el resultado) para que
 * GET /api/v1/me pueda identificar la key sin exponer nunca el secreto --
 * la lógica criptográfica/de comparación no cambia en absoluto.
 */
export async function autenticarApiKey(supabase: SupabaseClient, claveRecibida: string): Promise<ResultadoAutenticacion> {
  const hash = hashearApiKey(claveRecibida);
  const { data, error } = await supabase
    .from("dulabs_dev_api_keys")
    .select("id, workspace_id, key_hash, revoked_at, prefix, name")
    .eq("key_hash", hash)
    .maybeSingle();
  if (error || !data) return { autenticado: false, motivo: "no_encontrada" };

  // Comparación en tiempo constante final, aunque el lookup ya fue por
  // hash exacto -- defensa en profundidad barata, nunca confiar en que el
  // índice de Postgres es el único punto de verificación.
  if (!verificarApiKey(claveRecibida, data.key_hash)) return { autenticado: false, motivo: "no_encontrada" };
  if (data.revoked_at) return { autenticado: false, motivo: "revocada" };

  supabase
    .from("dulabs_dev_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(
      () => {},
      () => {}
    );

  return {
    autenticado: true,
    workspaceId: data.workspace_id as string,
    apiKeyId: data.id as string,
    apiKeyPrefix: data.prefix as string,
    apiKeyName: data.name as string,
  };
}

/** Revoca una key -- SIEMPRE scoped por workspace_id (nunca confía en que el caller ya validó ownership por fuera). */
export async function revocarApiKey(supabase: SupabaseClient, params: { workspaceId: string; apiKeyId: string }): Promise<{ revocada: boolean }> {
  const { data, error } = await supabase
    .from("dulabs_dev_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", params.apiKeyId)
    .eq("workspace_id", params.workspaceId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`[developer/api-keys-store] error revocando API key: ${error.message}`);
  return { revocada: Boolean(data) };
}

export type ResultadoRotacion =
  | { ok: true; fila: ApiKeyFila; claveEnClaro: string }
  | { ok: false; motivo: "old_no_encontrada_o_ya_revocada" };

/**
 * Fase 8 (autorizado, D6) -- rota una API key: revoca la vieja y crea una
 * nueva en UNA transacción atómica (función dulabs_dev_rotar_api_key), para
 * que el workspace nunca quede sin key por una falla a mitad de camino ni
 * con dos keys activas. La clave en claro se genera acá (TS) y solo su hash
 * viaja a la DB; se devuelve la clave completa UNA sola vez, igual que en la
 * creación. Scoped por workspace_id -- jamás rota una key de otro workspace.
 */
export async function rotarApiKey(supabase: SupabaseClient, params: { workspaceId: string; apiKeyId: string }): Promise<ResultadoRotacion> {
  const generada: ApiKeyGenerada = generarApiKey();
  const prefix = generada.claveEnClaro.slice(0, 12);

  const { data, error } = await supabase.rpc("dulabs_dev_rotar_api_key", {
    p_workspace_id: params.workspaceId,
    p_old_id: params.apiKeyId,
    p_key_hash: generada.hash,
    p_prefix: prefix,
  });
  if (error) throw new Error(`[developer/api-keys-store] error rotando API key: ${error.message}`);

  const filaRpc = Array.isArray(data) ? data[0] : data;
  if (!filaRpc || filaRpc.resultado !== "rotada") return { ok: false, motivo: "old_no_encontrada_o_ya_revocada" };

  const fila: ApiKeyFila = {
    id: filaRpc.new_id as string,
    workspace_id: params.workspaceId,
    name: filaRpc.new_name as string,
    prefix,
    created_at: filaRpc.new_created_at as string,
    last_used_at: null,
    revoked_at: null,
  };
  return { ok: true, fila, claveEnClaro: generada.claveEnClaro };
}

export async function listarApiKeys(supabase: SupabaseClient, workspaceId: string): Promise<ApiKeyFila[]> {
  const { data, error } = await supabase
    .from("dulabs_dev_api_keys")
    .select("id, workspace_id, name, prefix, created_at, last_used_at, revoked_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[developer/api-keys-store] error listando API keys: ${error.message}`);
  return (data ?? []) as ApiKeyFila[];
}
