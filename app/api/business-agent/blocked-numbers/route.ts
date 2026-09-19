/**
 * /api/business-agent/blocked-numbers — Bloque E (Authoring UI, autorizado).
 *
 * Gestión de dulabs_clientes_config.ia_numeros_bloqueados -- el MISMO
 * mecanismo que ya usa lib/blacklist-du.ts::esTelefonoBloqueado() como
 * PRIMER chequeo del webhook (Bloque 9) y de Legacy. NO se crea otra tabla
 * ni otro campo: este endpoint solo expone una UI segura sobre el campo
 * existente, tenant-scoped (.eq("id_tenant", miembro.tenantId) en cada
 * query/update, igual que /api/dashboard/negocio).
 *
 * Reutiliza las funciones puras de lib/blacklist-du.ts (normalización,
 * unión sin duplicar/sin eliminar, remoción) -- ninguna lógica de
 * parseo/normalización nueva.
 */
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { normalizarCampoTelefonos, parsearListaNegra, quitarDeListaNegra, unirListaNegra } from "@/lib/blacklist-du";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";

export const runtime = "nodejs";

async function resolverNumero(supabase: SupabaseClient, tenantId: string, phoneNumberId: string) {
  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio, ia_numeros_bloqueados")
    .eq("id_tenant", tenantId)
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) throw error;
  return data as { phone_number_id: string; nombre_negocio: string; ia_numeros_bloqueados: string | null } | null;
}

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const phoneNumberId = request.nextUrl.searchParams.get("phoneNumberId");
  if (!phoneNumberId) return apiError("REQUEST_INVALID_QUERY", "Falta 'phoneNumberId'.", 400);

  try {
    const negocio = await resolverNumero(supabase, miembro.tenantId, phoneNumberId);
    if (!negocio) return apiError("NUMBER_NOT_FOUND", "Número no encontrado.", 404);
    const blocked = [...parsearListaNegra(negocio.ia_numeros_bloqueados)].sort();
    return apiOk({ phoneNumberId: negocio.phone_number_id, blockedNumbers: blocked });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo obtener la lista.", 500);
  }
}

interface MutateBody {
  phoneNumberId?: unknown;
  numero?: unknown;
}

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  let body: MutateBody;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  if (typeof body.phoneNumberId !== "string" || !body.phoneNumberId) return apiError("REQUEST_INVALID_BODY", "Falta 'phoneNumberId'.", 400);
  if (typeof body.numero !== "string" || !body.numero.trim()) return apiError("REQUEST_INVALID_BODY", "Falta 'numero'.", 400);

  try {
    const negocio = await resolverNumero(supabase, miembro.tenantId, body.phoneNumberId);
    if (!negocio) return apiError("NUMBER_NOT_FOUND", "Número no encontrado.", 404);

    const { validos, invalidos } = normalizarCampoTelefonos(body.numero);
    if (validos.length === 0) return apiError("INVALID_PHONE", "Ese texto no tiene forma de teléfono válido.", 400);

    const { resultado } = unirListaNegra(negocio.ia_numeros_bloqueados, validos);
    const { error } = await supabase
      .from("dulabs_clientes_config")
      .update({ ia_numeros_bloqueados: resultado, updated_at: new Date().toISOString() })
      .eq("id_tenant", miembro.tenantId)
      .eq("phone_number_id", body.phoneNumberId);
    if (error) return apiError("INTERNAL_ERROR", "No se pudo guardar.", 500);

    return apiOk({ phoneNumberId: body.phoneNumberId, blockedNumbers: [...parsearListaNegra(resultado)].sort(), skipped: invalidos });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo agregar el número.", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  let body: MutateBody;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  if (typeof body.phoneNumberId !== "string" || !body.phoneNumberId) return apiError("REQUEST_INVALID_BODY", "Falta 'phoneNumberId'.", 400);
  if (typeof body.numero !== "string" || !body.numero.trim()) return apiError("REQUEST_INVALID_BODY", "Falta 'numero'.", 400);

  try {
    const negocio = await resolverNumero(supabase, miembro.tenantId, body.phoneNumberId);
    if (!negocio) return apiError("NUMBER_NOT_FOUND", "Número no encontrado.", 404);

    const resultado = quitarDeListaNegra(negocio.ia_numeros_bloqueados, body.numero.trim());
    const { error } = await supabase
      .from("dulabs_clientes_config")
      .update({ ia_numeros_bloqueados: resultado || null, updated_at: new Date().toISOString() })
      .eq("id_tenant", miembro.tenantId)
      .eq("phone_number_id", body.phoneNumberId);
    if (error) return apiError("INTERNAL_ERROR", "No se pudo guardar.", 500);

    return apiOk({ phoneNumberId: body.phoneNumberId, blockedNumbers: [...parsearListaNegra(resultado)].sort() });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo quitar el número.", 500);
  }
}
