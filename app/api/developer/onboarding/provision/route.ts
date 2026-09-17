import type { NextRequest } from "next/server";
import { conUsuarioDeveloper, jsonOk } from "@/lib/developer/dev-api-http";
import { provisionarOnboardingDeveloper } from "@/lib/developer/onboarding-provision";

// DuLabs Developer V1 -- provisión de onboarding. POST idempotente que
// garantiza que el usuario autenticado tenga su primer workspace (cuenta
// DEVELOPER + workspace + membership OWNER). Cierra el gap por el que un signup
// nuevo quedaba con 0 workspaces. Solo requiere sesión (no un workspace ya
// elegido). La identidad la valida conUsuarioDeveloper (auth.getUser); nunca se
// provisiona para un tercero.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return conUsuarioDeveloper(request, async (ctx) => {
    const r = await provisionarOnboardingDeveloper(ctx.supabase, ctx.userId);
    return jsonOk({ workspaceId: r.workspaceId, created: r.created }, ctx.requestId, r.created ? 201 : 200);
  });
}
