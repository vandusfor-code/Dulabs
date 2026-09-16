import type { SupabaseClient } from "@supabase/supabase-js";
import { crearApiKey, listarApiKeys, revocarApiKey, rotarApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumeroConLimite, listarNumeros, obtenerNumeroDelWorkspace } from "@/lib/developer/whatsapp-numbers-store";
import { configurarWebhook } from "@/lib/developer/webhook-config-store";
import { resolverLimitesDelWorkspace } from "@/lib/developer/plans";
import { listarWorkspacesDelUsuario, listarMiembros, crearMiembro, cambiarRolMiembro, eliminarMiembro, type RolDev } from "@/lib/developer/memberships-store";
import { resolverSesionWorkspace, resolverWorkspaceSeleccionado, type ContextoSesion } from "@/lib/developer/session-workspace";

// DuLabs Developer V1 -- Fase 3 (autorizado, sección A/N del documento de
// infraestructura -- "Management API cerrada en Cloud Run"). CRUD mínimo
// de gestión: API keys, números de WhatsApp, webhooks. Autenticado por
// sesión de Supabase Auth (no por dl_live_ -- esas dos superficies tienen
// modelos de autenticación distintos a propósito: el desarrollador
// gestiona su cuenta con su propia sesión, sus aplicaciones usan la API
// key). Reusa sin modificar los stores de Fase 2.

export type DependenciasManagement = { supabase: SupabaseClient };

export type RespuestaManagement = { status: number; cuerpo: Record<string, unknown> };

// Fase 9 (D1) -- la resolución sesión->workspace->rol se movió a
// lib/developer/session-workspace.ts (ÚNICA fuente de verdad, compartida con
// las rutas Next del Dashboard). Se re-exportan los tipos/funciones que ya
// consumían tests y server.ts, para no cambiar el contrato del Gateway.
export type { ContextoSesion };
export { resolverWorkspaceSeleccionado };

/**
 * Autenticación + selección de workspace + autorización por rol para las
 * rutas de SESIÓN (/api/v1/dev/*). Delega en resolverSesionWorkspace (D1) --
 * mismo criterio EXACTO que usa el Dashboard, sin lógica de autorización
 * duplicada. Un rol fuera de `rolesPermitidos` recibe 403, nunca ejecuta fn.
 */
export async function conWorkspaceAutenticado(
  deps: DependenciasManagement,
  autorizacion: string | undefined,
  workspaceHeader: string | undefined,
  rolesPermitidos: RolDev[],
  fn: (ctx: ContextoSesion) => Promise<RespuestaManagement>
): Promise<RespuestaManagement> {
  const r = await resolverSesionWorkspace(deps.supabase, { autorizacion, workspaceHeader, rolesPermitidos });
  if (!r.ok) return { status: r.status, cuerpo: { error: r.error } };
  return fn(r.ctx);
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

  // Fase 7 (autorizado) -- límite de números incluidos del plan, aplicado
  // de forma atómica (ver registrarNumeroConLimite). Una reconexión del
  // mismo número no consume cupo. null = plan sin límite.
  const limites = await resolverLimitesDelWorkspace(deps.supabase, workspaceId);
  const resultado = await registrarNumeroConLimite(deps.supabase, {
    workspaceId,
    phoneNumberId: body.phoneNumberId,
    wabaId: body.wabaId,
    displayName: body.displayName,
    metaToken: body.metaToken,
    limiteNumeros: limites.numerosIncluidos,
  });
  if (!resultado.ok) {
    if (resultado.motivo === "limite_numeros_excedido") {
      return { status: 403, cuerpo: { error: "number_limit_exceeded", detalle: `El plan ${limites.planCodigo} incluye ${limites.numerosIncluidos} números` } };
    }
    return { status: 409, cuerpo: { error: resultado.motivo } };
  }
  return { status: 201, cuerpo: { numero: resultado.fila } };
}

export async function manejarListarNumeros(deps: DependenciasManagement, workspaceId: string): Promise<RespuestaManagement> {
  const filas = await listarNumeros(deps.supabase, workspaceId);
  return { status: 200, cuerpo: { numeros: filas } };
}

export async function manejarConfigurarWebhook(deps: DependenciasManagement, workspaceId: string, cuerpo: unknown): Promise<RespuestaManagement> {
  const body = cuerpo as { whatsappNumberId?: string; url?: string } | null;
  if (!body?.whatsappNumberId || !body.url) return { status: 400, cuerpo: { error: "Faltan 'whatsappNumberId' y/o 'url'" } };

  // Fase 4 (autorizado, hallazgo de seguridad encontrado al diseñar la
  // superficie de webhooks por API key) -- configurarWebhook() nunca
  // verificó por su cuenta que whatsappNumberId pertenece a workspaceId
  // antes de hacer upsert. Como UNIQUE(whatsapp_number_id) NO es compuesto
  // con workspace_id, un workspaceId real + un whatsappNumberId de OTRO
  // workspace sobrescribía silenciosamente la configuración de webhook de
  // ese otro workspace (secuestro/DoS del webhook ajeno). Se corrige acá,
  // en el punto de entrada -- nunca se llega a tocar la tabla de webhooks
  // sin haber confirmado ownership real primero.
  const numero = await obtenerNumeroDelWorkspace(deps.supabase, { workspaceId, numeroId: body.whatsappNumberId });
  if (!numero) return { status: 404, cuerpo: { error: "whatsapp_number_not_found" } };

  const resultado = await configurarWebhook(deps.supabase, { workspaceId, whatsappNumberId: body.whatsappNumberId, url: body.url });
  if (!resultado.ok) return { status: 400, cuerpo: { error: resultado.motivo, detalle: resultado.detalle } };
  return { status: 201, cuerpo: { webhook: resultado.fila, secret: resultado.secreto } };
}

// ============================================================
// Fase 8 (autorizado, D6) -- workspace, miembros y rotación de API key.
// ============================================================

/** GET /api/v1/dev/workspace -- workspace seleccionado + rol efectivo + lista de todos los workspaces del usuario (para el selector del dashboard). Nunca expone secretos. */
export async function manejarObtenerWorkspace(deps: DependenciasManagement, ctx: ContextoSesion): Promise<RespuestaManagement> {
  const workspaces = await listarWorkspacesDelUsuario(deps.supabase, ctx.userId);
  return {
    status: 200,
    cuerpo: {
      workspaceId: ctx.workspaceId,
      rol: ctx.rol,
      workspaces: workspaces.map((w) => ({ workspaceId: w.workspaceId, rol: w.rol })),
    },
  };
}

/** GET /api/v1/dev/members -- miembros Developer explícitos del workspace (metadata, nunca secretos). Cualquier rol activo puede listar. */
export async function manejarListarMiembros(deps: DependenciasManagement, workspaceId: string): Promise<RespuestaManagement> {
  const filas = await listarMiembros(deps.supabase, workspaceId);
  return { status: 200, cuerpo: { members: filas } };
}

const ROLES_VALIDOS: RolDev[] = ["OWNER", "ADMIN", "MEMBER"];

/** POST /api/v1/dev/members -- alta/actualización idempotente de un miembro (solo OWNER). Recibe el user_id de Auth ya existente (Fase 8 NO implementa invitaciones por email). */
export async function manejarCrearMiembro(deps: DependenciasManagement, workspaceId: string, cuerpo: unknown): Promise<RespuestaManagement> {
  const body = cuerpo as { userId?: string; rol?: string } | null;
  if (!body?.userId) return { status: 400, cuerpo: { error: "Falta 'userId'" } };
  const rol = (body.rol ?? "MEMBER") as RolDev;
  if (!ROLES_VALIDOS.includes(rol)) return { status: 400, cuerpo: { error: "rol inválido" } };
  const fila = await crearMiembro(deps.supabase, { workspaceId, userId: body.userId, rol });
  return { status: 201, cuerpo: { member: fila } };
}

/** PATCH /api/v1/dev/members/:id -- cambia el rol de un miembro (solo OWNER). Guarda de último OWNER atómica en la DB. */
export async function manejarActualizarRolMiembro(deps: DependenciasManagement, workspaceId: string, membershipId: string, cuerpo: unknown): Promise<RespuestaManagement> {
  const rol = (cuerpo as { rol?: string } | null)?.rol as RolDev | undefined;
  if (!rol || !ROLES_VALIDOS.includes(rol)) return { status: 400, cuerpo: { error: "rol inválido" } };
  const resultado = await cambiarRolMiembro(deps.supabase, { workspaceId, membershipId, nuevoRol: rol });
  if (resultado.ok) return { status: 200, cuerpo: { member: { id: membershipId, rol: resultado.rol } } };
  if (resultado.motivo === "no_encontrado") return { status: 404, cuerpo: { error: "member_not_found" } };
  if (resultado.motivo === "ultimo_owner") return { status: 409, cuerpo: { error: "last_owner", detalle: "No se puede degradar al último OWNER del workspace" } };
  return { status: 400, cuerpo: { error: resultado.motivo } };
}

/** DELETE /api/v1/dev/members/:id -- elimina un miembro (solo OWNER). Guarda de último OWNER atómica en la DB. */
export async function manejarEliminarMiembro(deps: DependenciasManagement, workspaceId: string, membershipId: string): Promise<RespuestaManagement> {
  const resultado = await eliminarMiembro(deps.supabase, { workspaceId, membershipId });
  if (resultado.ok) return { status: 200, cuerpo: { eliminado: true } };
  if (resultado.motivo === "no_encontrado") return { status: 404, cuerpo: { error: "member_not_found" } };
  return { status: 409, cuerpo: { error: "last_owner", detalle: "No se puede eliminar al último OWNER del workspace" } };
}

/** POST /api/v1/dev/api-keys/:id/rotate -- rota una API key (OWNER o ADMIN). Devuelve la clave nueva UNA sola vez; la vieja queda revocada en la misma transacción. */
export async function manejarRotarApiKey(deps: DependenciasManagement, workspaceId: string, apiKeyId: string): Promise<RespuestaManagement> {
  const resultado = await rotarApiKey(deps.supabase, { workspaceId, apiKeyId });
  if (!resultado.ok) return { status: 404, cuerpo: { error: "api_key_not_found_or_revoked" } };
  return { status: 201, cuerpo: { id: resultado.fila.id, name: resultado.fila.name, prefix: resultado.fila.prefix, apiKey: resultado.claveEnClaro } };
}
