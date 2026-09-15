import type { SupabaseClient } from "@supabase/supabase-js";
import { crearApiKey, listarApiKeys, revocarApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumero, listarNumeros } from "@/lib/developer/whatsapp-numbers-store";
import { configurarWebhook } from "@/lib/developer/webhook-config-store";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección A/N del documento de
// infraestructura -- "Management API cerrada en Cloud Run"). CRUD mínimo
// de gestión: API keys, números de WhatsApp, webhooks. Autenticado por
// sesión de Supabase Auth (no por dl_live_ -- esas dos superficies tienen
// modelos de autenticación distintos a propósito: el desarrollador
// gestiona su cuenta con su propia sesión, sus aplicaciones usan la API
// key). Reusa sin modificar los stores de Fase 2.

export type DependenciasManagement = { supabase: SupabaseClient };

/** Resuelve el workspace_id del usuario autenticado -- misma lógica que public.dulabs_tenant_del_usuario(), aplicada en código porque el Gateway corre con service_role (bypassea RLS, no puede depender de auth.uid() de Postgres). */
async function resolverWorkspaceDelUsuario(supabase: SupabaseClient, tokenSesion: string): Promise<string | null> {
  const { data: usuario, error: errorUsuario } = await supabase.auth.getUser(tokenSesion);
  if (errorUsuario || !usuario?.user) return null;

  const { data: membresia, error: errorMembresia } = await supabase
    .from("dulabs_miembros_equipo")
    .select("tenant_id")
    .eq("user_id", usuario.user.id)
    .eq("estado", "activo")
    .limit(1)
    .maybeSingle();
  if (errorMembresia || !membresia) return null;
  return membresia.tenant_id as string;
}

function extraerBearer(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export type RespuestaManagement = { status: number; cuerpo: Record<string, unknown> };

export async function conWorkspaceAutenticado(
  deps: DependenciasManagement,
  autorizacion: string | undefined,
  fn: (workspaceId: string) => Promise<RespuestaManagement>
): Promise<RespuestaManagement> {
  const token = extraerBearer(autorizacion);
  if (!token) return { status: 401, cuerpo: { error: "Falta Authorization: Bearer <sesión de Supabase>" } };
  const workspaceId = await resolverWorkspaceDelUsuario(deps.supabase, token);
  if (!workspaceId) return { status: 401, cuerpo: { error: "Sesión inválida o sin membresía activa" } };
  return fn(workspaceId);
}

export async function manejarCrearApiKey(deps: DependenciasManagement, workspaceId: string, cuerpo: unknown): Promise<RespuestaManagement> {
  const name = (cuerpo as { name?: string } | null)?.name;
  if (!name) return { status: 400, cuerpo: { error: "Falta 'name'" } };
  const { fila, claveEnClaro } = await crearApiKey(deps.supabase, { workspaceId, name });
  return { status: 201, cuerpo: { id: fila.id, name: fila.name, prefix: fila.prefix, apiKey: claveEnClaro } };
}

export async function manejarListarApiKeys(deps: DependenciasManagement, workspaceId: string): Promise<RespuestaManagement> {
  const filas = await listarApiKeys(deps.supabase, workspaceId);
  return { status: 200, cuerpo: { apiKeys: filas } };
}

export async function manejarRevocarApiKey(deps: DependenciasManagement, workspaceId: string, apiKeyId: string): Promise<RespuestaManagement> {
  const resultado = await revocarApiKey(deps.supabase, { workspaceId, apiKeyId });
  return { status: resultado.revocada ? 200 : 404, cuerpo: { revocada: resultado.revocada } };
}

export async function manejarRegistrarNumero(deps: DependenciasManagement, workspaceId: string, cuerpo: unknown): Promise<RespuestaManagement> {
  const body = cuerpo as { phoneNumberId?: string; wabaId?: string; displayName?: string; metaToken?: string } | null;
  if (!body?.phoneNumberId) return { status: 400, cuerpo: { error: "Falta 'phoneNumberId'" } };
  const resultado = await registrarNumero(deps.supabase, { workspaceId, phoneNumberId: body.phoneNumberId, wabaId: body.wabaId, displayName: body.displayName, metaToken: body.metaToken });
  if (!resultado.ok) return { status: 409, cuerpo: { error: resultado.motivo } };
  return { status: 201, cuerpo: { numero: resultado.fila } };
}

export async function manejarListarNumeros(deps: DependenciasManagement, workspaceId: string): Promise<RespuestaManagement> {
  const filas = await listarNumeros(deps.supabase, workspaceId);
  return { status: 200, cuerpo: { numeros: filas } };
}

export async function manejarConfigurarWebhook(deps: DependenciasManagement, workspaceId: string, cuerpo: unknown): Promise<RespuestaManagement> {
  const body = cuerpo as { whatsappNumberId?: string; url?: string } | null;
  if (!body?.whatsappNumberId || !body.url) return { status: 400, cuerpo: { error: "Faltan 'whatsappNumberId' y/o 'url'" } };
  const resultado = await configurarWebhook(deps.supabase, { workspaceId, whatsappNumberId: body.whatsappNumberId, url: body.url });
  if (!resultado.ok) return { status: 400, cuerpo: { error: resultado.motivo, detalle: resultado.detalle } };
  return { status: 201, cuerpo: { webhook: resultado.fila, secret: resultado.secreto } };
}
