/**
 * GET /api/business-agent/calendar — Bloque 15B. Estado de la conexión de
 * calendario del tenant (proyección pública, SIN grant_id). Auth admin + tenant
 * derivado de la sesión (nunca del payload).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createSupabaseCalendarStore } from "@/lib/agent-compiler/calendar/calendar-store-supabase";
import { toPublicConnection } from "@/lib/agent-compiler/calendar/types";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  try {
    const conn = await createSupabaseCalendarStore(supabase).getConnection(miembro.tenantId);
    return apiOk({
      connection: toPublicConnection(conn),
      providerAvailable: Boolean(process.env.NYLAS_CLIENT_ID && process.env.NYLAS_API_KEY),
    });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo leer la conexión de calendario.", 500);
  }
}
