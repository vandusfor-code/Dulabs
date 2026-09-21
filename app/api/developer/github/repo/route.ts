import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { obtenerGithubConfig } from "@/lib/developer/github/github-config";
import { obtenerInstalacionDeWorkspace, guardarRepoSeleccionado, marcarInstalacionesPorInstallationId } from "@/lib/developer/github/github-installations-store";
import { acunarTokenInstalacion, listarReposInstalacion } from "@/lib/developer/github/github-app-client";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// POST -> vincula el repo seleccionado al workspace. OWNER/ADMIN. Valida que el
// repoId esté REALMENTE entre los autorizados de la instalación (nunca se
// confía en el body sin verificar contra GitHub) -> impide vincular un repo al
// que la instalación no da acceso.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const config = obtenerGithubConfig();
    if (!config) return jsonError(503, "github_not_configured", ctx.requestId);

    const cuerpo = (await request.json().catch(() => null)) as { repoId?: number | string } | null;
    const repoId = cuerpo?.repoId !== undefined ? Number(cuerpo.repoId) : NaN;
    if (!Number.isInteger(repoId) || repoId <= 0) return jsonError(400, "invalid_request", ctx.requestId, "Falta 'repoId'");

    const inst = await obtenerInstalacionDeWorkspace(ctx.supabase, ctx.workspaceId);
    if (!inst) return jsonError(404, "github_not_connected", ctx.requestId);

    const tokenRes = await acunarTokenInstalacion(config, inst.installation_id);
    if (!tokenRes.ok) {
      if (tokenRes.motivo === "installation_gone") {
        await marcarInstalacionesPorInstallationId(ctx.supabase, { installationId: inst.installation_id, estado: "sin_acceso" }).catch(() => undefined);
        return jsonError(409, "github_access_lost", ctx.requestId);
      }
      return jsonError(502, "github_error", ctx.requestId);
    }

    const repos = await listarReposInstalacion(tokenRes.token);
    if (!Array.isArray(repos)) return jsonError(502, "github_error", ctx.requestId);

    const elegido = repos.find((r) => r.repoId === repoId);
    if (!elegido) return jsonError(404, "repo_not_found", ctx.requestId, "El repositorio no está entre los autorizados por la instalación.");

    const fila = await guardarRepoSeleccionado(ctx.supabase, { workspaceId: ctx.workspaceId, installationRowId: inst.id, repo: elegido });
    return jsonOk(
      {
        repo: { repoId: fila.repo_id, owner: fila.owner_login, name: fila.repo_name, fullName: fila.full_name, htmlUrl: fila.html_url, private: fila.private, linkedAt: fila.created_at },
      },
      ctx.requestId,
      201
    );
  });
}
