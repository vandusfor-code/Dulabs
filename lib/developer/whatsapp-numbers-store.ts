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

export type ResultadoRegistroNumeroConLimite =
  | { ok: true; fila: NumeroWhatsAppFila; reconectado: boolean }
  | { ok: false; motivo: "numero_ya_conectado_a_otro_workspace" | "limite_numeros_excedido" };

/**
 * Fase 7 (autorizado) -- registro de número con límite de plan aplicado de
 * forma ATÓMICA (función dulabs_dev_registrar_numero_con_limite, migración
 * 20261013000000). A diferencia de registrarNumero() (que no conoce límites
 * y se mantiene para usos internos/tests), esta variante:
 *   - cuenta contra `numeros_incluidos` del plan SOLO los números NUEVOS
 *     (una reconexión del mismo phone_number_id del mismo workspace no
 *     consume cupo);
 *   - protege contra creación concurrente (advisory lock por workspace en
 *     la función) -> dos altas simultáneas de números distintos con un solo
 *     cupo libre nunca superan el límite;
 *   - nunca crea el número si la cuota no lo permite (rechazo, sin fila
 *     parcial).
 * `limiteNumeros` null = plan sin límite de números -> no se aplica.
 * El token de Meta se cifra ACÁ (TS) antes de llamar a la función -- nunca
 * viaja en claro hacia Postgres.
 */
export async function registrarNumeroConLimite(
  supabase: SupabaseClient,
  params: { workspaceId: string; phoneNumberId: string; wabaId?: string | null; displayName?: string | null; metaToken?: string | null; limiteNumeros: number | null }
): Promise<ResultadoRegistroNumeroConLimite> {
  const tokenCifrado = params.metaToken ? await cifrarSecretoDev(params.metaToken) : null;

  const { data, error } = await supabase.rpc("dulabs_dev_registrar_numero_con_limite", {
    p_workspace_id: params.workspaceId,
    p_phone_number_id: params.phoneNumberId,
    p_waba_id: params.wabaId ?? null,
    p_display_name: params.displayName ?? null,
    p_meta_token_cifrado: tokenCifrado,
    p_limite_numeros: params.limiteNumeros,
  });
  if (error) throw new Error(`[developer/whatsapp-numbers-store] error registrando número con límite: ${error.message}`);

  const filaRpc = Array.isArray(data) ? data[0] : data;
  if (!filaRpc) throw new Error("[developer/whatsapp-numbers-store] la función de registro con límite no devolvió resultado");

  if (filaRpc.resultado === "numero_ya_conectado_a_otro_workspace") return { ok: false, motivo: "numero_ya_conectado_a_otro_workspace" };
  if (filaRpc.resultado === "limite_numeros_excedido") return { ok: false, motivo: "limite_numeros_excedido" };

  // 'creado' | 'reconectado' -- re-proyecta la fila pública (nunca el token
  // cifrado) reusando la consulta ya existente scoped por workspace.
  const fila = await obtenerNumeroDelWorkspace(supabase, { workspaceId: params.workspaceId, numeroId: filaRpc.numero_id as string });
  if (!fila) throw new Error("[developer/whatsapp-numbers-store] número registrado pero no recuperable (inconsistencia inesperada)");
  return { ok: true, fila, reconectado: filaRpc.resultado === "reconectado" };
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

/**
 * Resuelve a qué workspace pertenece un phone_number_id -- usado por el
 * Gateway (Fase 3) para saber en nombre de qué workspace persistir un
 * webhook entrante de Meta (Meta no manda el workspace_id, solo su propio
 * phone_number_id, único globalmente -- ver migración). No expone el token
 * de Meta.
 */
export async function obtenerNumeroPorPhoneNumberId(supabase: SupabaseClient, phoneNumberId: string): Promise<NumeroWhatsAppFila | null> {
  const { data, error } = await supabase.from("dulabs_dev_whatsapp_numbers").select(CAMPOS_PUBLICOS).eq("phone_number_id", phoneNumberId).maybeSingle();
  if (error) throw new Error(`[developer/whatsapp-numbers-store] error resolviendo número por phone_number_id: ${error.message}`);
  return (data as NumeroWhatsAppFila) ?? null;
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

export type ResultadoDesconexion = { ok: true; fila: NumeroWhatsAppFila } | { ok: false; motivo: "numero_no_encontrado" };

/**
 * Fase 10 (autorizado) -- desconexión LOCAL segura de un número: lo marca
 * 'desconectado' y BORRA el token de Meta cifrado (meta_token_cifrado=null)
 * -- tras esto el número ya no puede enviar (obtenerNumeroParaEnvioMeta
 * devuelve null sin token), que es exactamente el efecto buscado. Scoped por
 * workspace_id + id (mismo criterio de ownership del resto del store: nunca
 * toca una fila sin el workspace_id en el filtro).
 *
 * NO borra la fila ni ningún histórico (jobs, usage ledger, eventos siguen
 * intactos -- referencian el número por su UUID interno, que se conserva).
 * Es una desconexión del lado de DuLabs: NO revoca nada en Meta (el token de
 * Meta sigue siendo válido en Meta hasta que el dueño lo revoque allá) --
 * esta función jamás afirma lo contrario. Reconectar más tarde re-registra
 * el mismo phone_number_id (reconexión, no consume cupo nuevo).
 */
export async function desconectarNumero(supabase: SupabaseClient, params: { workspaceId: string; numeroId: string }): Promise<ResultadoDesconexion> {
  const { data, error } = await supabase
    .from("dulabs_dev_whatsapp_numbers")
    .update({ estado: "desconectado", meta_token_cifrado: null, updated_at: new Date().toISOString() })
    .eq("id", params.numeroId)
    .eq("workspace_id", params.workspaceId)
    .select(CAMPOS_PUBLICOS)
    .maybeSingle();
  if (error) throw new Error(`[developer/whatsapp-numbers-store] error desconectando número: ${error.message}`);
  if (!data) return { ok: false, motivo: "numero_no_encontrado" };
  return { ok: true, fila: data as NumeroWhatsAppFila };
}

export type NumeroParaEnvioMeta = { id: string; phoneNumberId: string; tokenMeta: string };

/**
 * Resuelve en UNA sola consulta lo que el Worker outbound necesita para
 * hacer el POST real a Meta: el `phone_number_id` REAL (el identificador
 * numérico que Meta exige en `/{phone_number_id}/messages` -- NUNCA el UUID
 * interno `id`) y el token descifrado. Scoped por workspace_id + id interno
 * (mismo criterio de ownership que el resto del store: jamás resuelve un
 * número sin el workspace_id como parte del filtro).
 *
 * Corrección crítica de Fase 5 (autorizada): antes, el Worker construía la
 * URL de Meta con `job.whatsapp_number_id` (el UUID interno) directamente,
 * porque solo recuperaba el token (obtenerTokenMetaDelNumero) y nunca el
 * phone_number_id -- un envío real habría ido a `/{uuid-interno}/messages`,
 * que Meta rechaza. Esta función expone ambos datos juntos para que la URL
 * use EXCLUSIVAMENTE el phone_number_id.
 *
 * Devuelve null si el número no existe en ese workspace o si todavía no
 * tiene token cifrado (número en 'pendiente' -- no se puede enviar). Nunca
 * proyecta el cifrado hacia afuera: descifra internamente y devuelve solo
 * el valor en claro al caller que lo necesita en ese instante.
 */
export async function obtenerNumeroParaEnvioMeta(
  supabase: SupabaseClient,
  params: { workspaceId: string; numeroId: string }
): Promise<NumeroParaEnvioMeta | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_whatsapp_numbers")
    .select("id, phone_number_id, meta_token_cifrado")
    .eq("id", params.numeroId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (error) throw new Error(`[developer/whatsapp-numbers-store] error resolviendo número para envío: ${error.message}`);
  if (!data || !data.phone_number_id || !data.meta_token_cifrado) return null;
  const tokenMeta = await descifrarSecretoDev(data.meta_token_cifrado);
  return { id: data.id as string, phoneNumberId: data.phone_number_id as string, tokenMeta };
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
