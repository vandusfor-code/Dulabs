/**
 * POST /api/business-agent/calendar/connect — Bloque 15B. Inicia el OAuth
 * self-service de Nylas: crea un `state` seguro (tenant-bound, un solo uso) y
 * devuelve el authUrl al que el frontend redirige. Auth admin + tenant de la
 * sesión. Si faltan credenciales de Nylas => provider_unavailable (NUNCA simula).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { createSupabaseCalendarStore } from "@/lib/agent-compiler/calendar/calendar-store-supabase";
import { createNylasOAuthClientFromEnv } from "@/lib/agent-compiler/calendar/nylas-oauth-client";
import { createCalendarConnectionService } from "@/lib/agent-compiler/calendar/calendar-connection-service";
import { siteUrlCon } from "@/lib/site-url";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";

export const runtime = "nodejs";

// redirect_uri: debe coincidir EXACTO con el del callback y estar registrado en
// la app Nylas (config del usuario — ver runbook). No lleva query dinámico.
const CALLBACK_PATH = "/api/business-agent/calendar/callback";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  // Rate limit por tenant: connect crea un state OAuth y arranca flujo externo.
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_calendar_connect", tenantId: miembro.tenantId, categoria: "costosa" });
  if (limite) return limite;

  const nylas = createNylasOAuthClientFromEnv();
  if (!nylas) return apiError("PROVIDER_UNAVAILABLE", "La integración de calendario no está configurada todavía.", 503);
  try {
    const service = createCalendarConnectionService({ store: createSupabaseCalendarStore(supabase), nylas });
    const result = await service.startConnect({ tenantId: miembro.tenantId, redirectUri: siteUrlCon(CALLBACK_PATH) });
    if (!result.ok) return apiError("PROVIDER_UNAVAILABLE", "La integración de calendario no está disponible.", 503);
    return apiOk({ authUrl: result.authUrl });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo iniciar la conexión de calendario.", 500);
  }
}
