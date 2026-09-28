/**
 * POST /api/business-agent/onboarding/publish — Business Agent 2.0, FASE 6. Body: {expectedRevision}.
 *
 * Publica el borrador GUARDADO en esa revisión. La respuesta es un flujo NDJSON: una línea por etapa REAL
 * ({type:"stage", stage, status, label}) a medida que ocurre, y una línea final {type:"result", ...}. La versión activa
 * solo cambia en la última etapa (una transacción en Postgres). Revisión vieja / otra pestaña publicó => conflict.
 * Solo admin. Tenant de la sesión.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError } from "@/lib/agent-compiler/api/http";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { createSupabaseOnboardingDeps } from "@/lib/agent-compiler/onboarding/deps-supabase";
import { PUBLISH_STAGES, publishOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { isRevision, readBody } from "@/lib/agent-compiler/onboarding/http";
import { SUPPORT_CODES } from "@/lib/agent-compiler/onboarding/issues";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro, esAdminOverride } = access.ctx;
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_onboarding_publish", tenantId: miembro.tenantId, categoria: "costosa" });
  if (limite) return limite;
  const read = await readBody(request, ["expectedRevision"]);
  if (!read.ok) return read.response;
  const expectedRevision = read.body.expectedRevision;
  if (!isRevision(expectedRevision) || expectedRevision < 1) return apiError(SUPPORT_CODES.PUBLISH_INVALID, "Guarda tu configuración antes de publicar.", 400);

  const deps = createSupabaseOnboardingDeps(supabase, { tenantId: miembro.tenantId, userId: miembro.userId });
  const encoder = new TextEncoder();
  const labels = Object.fromEntries(PUBLISH_STAGES.map((s) => [s.id, s.label]));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      const result = await publishOnboarding(deps, { expectedRevision }, (e) => send({ type: "stage", ...e, label: labels[e.stage] }));
      if (result.ok && esAdminOverride) {
        await registrarAuditoriaAdmin(supabase, { operador: miembro, accion: "PUBLISH_BUSINESS_AGENT", idTenant: miembro.tenantId, recurso: "onboarding", metadata: { publishedVersion: result.publishedVersion } }).catch(() => {});
      }
      send({ type: "result", ...result });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
