/**
 * POST /api/business-agent/calendar/disconnect — Bloque 15B. Revoca el grant en
 * Nylas (best-effort) y borra la conexión local (idempotente). Auth admin +
 * tenant de la sesión. Si faltan credenciales de Nylas, igual limpia lo local.
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
  try {
    const store = createSupabaseCalendarStore(supabase);
    const nylas = createNylasOAuthClientFromEnv();
    if (nylas) {
      await createCalendarConnectionService({ store, nylas }).disconnect(miembro.tenantId);
    } else {
      // Sin proveedor no se puede revocar en Nylas, pero limpiamos lo local
      // para no seguir mostrando/usando una conexión que el usuario soltó.
      await store.deleteConnection(miembro.tenantId);
    }
    return apiOk({ ok: true });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo desconectar el calendario.", 500);
  }
}
