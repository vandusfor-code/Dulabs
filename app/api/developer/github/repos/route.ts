import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { obtenerGithubConfig } from "@/lib/developer/github/github-config";
import { obtenerInstalacionDeWorkspace, marcarInstalacionesPorInstallationId } from "@/lib/developer/github/github-installations-store";
import { acunarTokenInstalacion, listarReposInstalacion } from "@/lib/developer/github/github-app-client";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// GET -> repos autorizados de la instalación del workspace, para poblar el
// selector. OWNER/ADMIN (elegir repo es una acción de configuración). El token
// de instalación se acuña on-demand y NUNCA sale al frontend.

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const config = obtenerGithubConfig();
    if (!config) return jsonError(503, "github_not_configured", ctx.requestId);

    const inst = await obtenerInstalacionDeWorkspace(ctx.supabase, ctx.workspaceId);
    if (!inst) return jsonError(404, "github_not_connected", ctx.requestId);

    const tokenRes = await acunarTokenInstalacion(config, inst.installation_id);
    if (!tokenRes.ok) {
      // La instalación se perdió/suspendió en GitHub -> reflejarlo en DB.
      if (tokenRes.motivo === "installation_gone") {
        await marcarInstalacionesPorInstallationId(ctx.supabase, { installationId: inst.installation_id, estado: "sin_acceso" }).catch(() => undefined);
        return jsonError(409, "github_access_lost", ctx.requestId);
      }
      return jsonError(502, "github_error", ctx.requestId);
    }

    const repos = await listarReposInstalacion(tokenRes.token);
    if (!Array.isArray(repos)) return jsonError(502, "github_error", ctx.requestId);

    return jsonOk(
      {
        repos: repos.map((r) => ({
          repoId: r.repoId,
          owner: r.ownerLogin,
          name: r.repoName,
          fullName: r.fullName,
          htmlUrl: r.htmlUrl,
          private: r.private,
        })),
      },
      ctx.requestId
    );
  });
}
