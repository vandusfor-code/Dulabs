import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { githubConfigurado, obtenerGithubConfig } from "@/lib/developer/github/github-config";
import { obtenerInstalacionDeWorkspace, obtenerRepoDeWorkspace, desconectarWorkspace } from "@/lib/developer/github/github-installations-store";
import { desinstalarApp } from "@/lib/developer/github/github-app-client";
import type { InstallationFila, RepoFila } from "@/lib/developer/github/github-installations-store";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// GET  -> estado de la conexión del workspace (cualquier rol; solo lectura).
// DELETE -> desconectar (OWNER/ADMIN). Nunca expone secretos: no se guardan
// tokens y estas proyecciones solo llevan metadata pública del repo/cuenta.

export const runtime = "nodejs";

/** Proyección SEGURA de la conexión para el frontend (sin secretos). */
function proyectar(inst: InstallationFila | null, repo: RepoFila | null) {
  return {
    installation: inst
      ? {
          accountLogin: inst.github_account_login,
          accountType: inst.github_account_type,
          status: inst.estado, // activo | sin_acceso | desconectado
          connectedAt: inst.created_at,
        }
      : null,
    repo:
      repo && repo.estado === "vinculado"
        ? {
            repoId: repo.repo_id,
            owner: repo.owner_login,
            name: repo.repo_name,
            fullName: repo.full_name,
            htmlUrl: repo.html_url,
            private: repo.private,
            linkedAt: repo.created_at,
          }
        : null,
  };
}

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const inst = await obtenerInstalacionDeWorkspace(ctx.supabase, ctx.workspaceId);
    const repo = inst ? await obtenerRepoDeWorkspace(ctx.supabase, ctx.workspaceId) : null;
    return jsonOk({ configured: githubConfigurado(), connection: proyectar(inst, repo) }, ctx.requestId);
  });
}

export async function DELETE(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const inst = await obtenerInstalacionDeWorkspace(ctx.supabase, ctx.workspaceId);
    if (!inst) return jsonError(404, "github_not_connected", ctx.requestId);

    // Best-effort: revocar el acceso en GitHub (desinstalar la App). Si falla,
    // igual se desvincula en DuLabs -- el usuario siempre puede quitar la App
    // desde GitHub. Nunca bloquea la desconexión por un fallo de red a GitHub.
    const config = obtenerGithubConfig();
    if (config) await desinstalarApp(config, inst.installation_id).catch(() => undefined);

    await desconectarWorkspace(ctx.supabase, ctx.workspaceId);
    return jsonOk({ disconnected: true }, ctx.requestId);
  });
}
