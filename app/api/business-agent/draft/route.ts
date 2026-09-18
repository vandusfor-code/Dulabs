/**
 * POST /api/business-agent/draft — Bloque 12A/12B (Authoring API, autorizado).
 *
 * Crea una nueva versión DRAFT del Business Agent del tenant (sirve tanto
 * para "crear" -- primer draft -- como "actualizar" -- siguientes ediciones,
 * que compileAndCreateDraftVersion siempre materializa como una versión
 * NUEVA; nunca muta una publicada). Body: las 8 secciones editables del
 * BusinessAgentSpec + `baseVersionNumber` opcional (control de concurrencia
 * optimista -- requerido si ya existe una versión previa). Requiere rol admin
 * (igual que POST /api/flows y POST /api/flows/[id]/versions).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { createOrUpdateDraft, isPlainObject } from "@/lib/agent-compiler/api/business-agent-api";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";

export const runtime = "nodejs";

const REASON_STATUS: Record<string, number> = {
  invalid_body: 400,
  stale_version: 409,
  compile_failed: 422,
  flow_compile_failed: 422,
  store_error: 500,
};

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  if (!isPlainObject(body)) return apiError("REQUEST_INVALID_BODY", "El cuerpo debe ser un objeto JSON.", 400);

  const baseVersionNumberRaw = body.baseVersionNumber;
  if (baseVersionNumberRaw !== undefined && typeof baseVersionNumberRaw !== "number") {
    return apiError("REQUEST_INVALID_BODY", "'baseVersionNumber' debe ser numérico.", 400);
  }
  // El resto del body (las 8 secciones editables) lo interpreta
  // createOrUpdateDraft -- acá solo se separa baseVersionNumber, que NO es
  // parte del Spec (nunca se le pasa al compiler).
  const { baseVersionNumber: _omit, ...rawSpecBody } = body;
  void _omit;

  try {
    const result = await createOrUpdateDraft(
      { store: createSupabaseBusinessAgentRegistryStore(supabase) },
      { tenantId: miembro.tenantId, userId: miembro.userId, rawBody: rawSpecBody, baseVersionNumber: baseVersionNumberRaw },
    );
    if (!result.ok) {
      return apiError(result.reason.toUpperCase(), result.message, REASON_STATUS[result.reason] ?? 500, result.diagnostics);
    }
    return apiOk(result.version, 201);
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo guardar el borrador.", 500);
  }
}
