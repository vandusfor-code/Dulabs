import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { obtenerGithubConfig, urlInstalacionGithub } from "@/lib/developer/github/github-config";
import { crearConnectState, limpiarConnectStatesVencidos } from "@/lib/developer/github/github-connect-state-store";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// POST -> inicia la conexión: crea un `state` single-use ligado a este
// workspace/usuario y devuelve la URL de instalación de la GitHub App. El
// frontend redirige el navegador a esa URL. Solo OWNER/ADMIN.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const config = obtenerGithubConfig();
    if (!config) return jsonError(503, "github_not_configured", ctx.requestId, "La integración de GitHub no está configurada en este entorno.");

    // Limpieza oportunista (no crítica) de states viejos de este mismo tenant.
    await limpiarConnectStatesVencidos(ctx.supabase).catch(() => undefined);

    const state = await crearConnectState(ctx.supabase, { workspaceId: ctx.workspaceId, userId: ctx.userId });
    return jsonOk({ installUrl: urlInstalacionGithub(config.appSlug, state) }, ctx.requestId);
  });
}
