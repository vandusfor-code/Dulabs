/**
 * GET /api/business-agent/calendar/calendars — Bloque 15B. Lista los calendarios
 * REALES del grant del tenant (para que el usuario elija cuál usar). Auth admin +
 * tenant de la sesión. Requiere conexión activa; si no, 409 not_connected.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createSupabaseCalendarStore } from "@/lib/agent-compiler/calendar/calendar-store-supabase";
import { createNylasOAuthClientFromEnv } from "@/lib/agent-compiler/calendar/nylas-oauth-client";
import { createCalendarConnectionService } from "@/lib/agent-compiler/calendar/calendar-connection-service";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const nylas = createNylasOAuthClientFromEnv();
  if (!nylas) return apiError("PROVIDER_UNAVAILABLE", "La integración de calendario no está configurada todavía.", 503);
  try {
    const service = createCalendarConnectionService({ store: createSupabaseCalendarStore(supabase), nylas });
    const result = await service.listCalendars(miembro.tenantId);
    if (!result.ok) {
      if (result.reason === "not_connected") return apiError("NOT_CONNECTED", "Conecta un calendario primero.", 409);
      return apiError("PROVIDER_ERROR", "No se pudieron cargar los calendarios.", 502);
    }
    return apiOk({ calendars: result.calendars });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudieron cargar los calendarios.", 500);
  }
}
