/**
 * GET /api/business-agent/calendar/callback — Bloque 15B. Redirect del navegador
 * desde Nylas tras el consentimiento OAuth.
 *
 * SEGURIDAD (clave): este endpoint NO recibe Authorization: Bearer — es una
 * navegación de primer nivel del navegador, no un fetch del app. Por eso su
 * ÚNICA autoridad es el `state`: tenant-bound, de un solo uso, aleatorio (32
 * bytes) y con expiry. El tenant se deriva del state consumido en el store
 * (handleCallback), JAMÁS del query. Usa supabaseAdmin() (service_role) porque
 * no hay sesión y las tablas de calendario son service_role-only.
 *
 * Fail-closed: state inválido/expirado/repetido o error del proveedor NO crean
 * una conexión válida. El resultado del redirect nunca incluye secretos.
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createSupabaseCalendarStore } from "@/lib/agent-compiler/calendar/calendar-store-supabase";
import { createNylasOAuthClientFromEnv } from "@/lib/agent-compiler/calendar/nylas-oauth-client";
import { createCalendarConnectionService } from "@/lib/agent-compiler/calendar/calendar-connection-service";
import { siteUrlCon } from "@/lib/site-url";

export const runtime = "nodejs";

function backToWizard(resultado: string): Response {
  return Response.redirect(
    siteUrlCon(`/dashboard/business-agent?tab=agenda&calendar=${encodeURIComponent(resultado)}`),
    302,
  );
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  // Nylas manda ?error= si el usuario cancela/deniega el consentimiento.
  if (params.get("error")) return backToWizard("cancelled");

  const nylas = createNylasOAuthClientFromEnv();
  if (!nylas) return backToWizard("provider_unavailable");
  try {
    const service = createCalendarConnectionService({ store: createSupabaseCalendarStore(supabaseAdmin()), nylas });
    const result = await service.handleCallback({ state, code, redirectUri: siteUrlCon("/api/business-agent/calendar/callback") });
    return backToWizard(result.ok ? "connected" : result.reason);
  } catch {
    return backToWizard("error");
  }
}
