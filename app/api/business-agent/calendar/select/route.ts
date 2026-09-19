/**
 * POST /api/business-agent/calendar/select — Bloque 15B. Fija el calendario que
 * el agente usará. El calendarId se VALIDA contra la lista real del grant del
 * tenant (no se confía en el cliente). Auth admin + tenant de la sesión.
 * Body: { calendarId: string }.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createSupabaseCalendarStore } from "@/lib/agent-compiler/calendar/calendar-store-supabase";
import { createNylasOAuthClientFromEnv } from "@/lib/agent-compiler/calendar/nylas-oauth-client";
import { createCalendarConnectionService } from "@/lib/agent-compiler/calendar/calendar-connection-service";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const nylas = createNylasOAuthClientFromEnv();
  if (!nylas) return apiError("PROVIDER_UNAVAILABLE", "La integración de calendario no está configurada todavía.", 503);

  let body: { calendarId?: unknown };
  try {
    body = (await request.json()) as { calendarId?: unknown };
  } catch {
    return apiError("BAD_REQUEST", "Cuerpo de la solicitud inválido.", 400);
  }
  const calendarId = typeof body.calendarId === "string" ? body.calendarId.trim() : "";
  if (!calendarId) return apiError("BAD_REQUEST", "Falta el identificador del calendario.", 400);

  try {
    const service = createCalendarConnectionService({ store: createSupabaseCalendarStore(supabase), nylas });
    const result = await service.selectCalendar({ tenantId: miembro.tenantId, calendarId });
    if (!result.ok) {
      if (result.reason === "not_connected") return apiError("NOT_CONNECTED", "Conecta un calendario primero.", 409);
      if (result.reason === "calendar_not_found") return apiError("CALENDAR_NOT_FOUND", "Ese calendario no pertenece a la cuenta conectada.", 404);
      return apiError("PROVIDER_ERROR", "No se pudo seleccionar el calendario.", 502);
    }
    return apiOk({ ok: true });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo seleccionar el calendario.", 500);
  }
}
