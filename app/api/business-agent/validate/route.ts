/**
 * POST /api/business-agent/validate — Bloque 12C (Authoring API, autorizado).
 *
 * Valida un BusinessAgentSpec (las 8 secciones editables) contra el pipeline
 * real del compiler (Zod + semántica + IR + FlowDefinition + reglas de
 * publicación) SIN persistir nada. Permite al frontend mostrar
 * válido/warnings/errores antes de guardar. Un error SIEMPRE gana sobre
 * warnings -- ver validateDraftSpec (hasErrors), nunca "success" silencioso.
 * Rol agente o admin (no escribe nada, igual que POST /api/flows/[id]/validate).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { validateDraftSpec } from "@/lib/agent-compiler/api/business-agent-api";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  // Rate limit por tenant: validate corre el pipeline de compilación (CPU).
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_validate", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }

  const result = validateDraftSpec({ tenantId: miembro.tenantId, rawBody: body });
  if (!result.ok) {
    // invalid_body = error de la petición en sí (forma/campos prohibidos) -> 400.
    // compile_failed/flow_compile_failed = resultado NORMAL de "validate" sobre
    // un Spec inválido -> 200 con valid:false (mismo criterio que
    // POST /api/flows/[id]/validate: siempre 200, nunca 4xx por un Spec
    // simplemente inválido).
    if (result.reason === "invalid_body") return apiError("REQUEST_INVALID_BODY", "El cuerpo de la petición es inválido.", 400, result.diagnostics);
    return apiOk({ valid: false, validationStatus: "failed" as const, diagnostics: result.diagnostics });
  }
  return apiOk({ valid: result.validationStatus === "validated", validationStatus: result.validationStatus, diagnostics: result.diagnostics, checksums: result.checksums });
}
