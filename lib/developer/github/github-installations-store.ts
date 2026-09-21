import type { SupabaseClient } from "@supabase/supabase-js";
import type { GithubInstallation, GithubRepo } from "@/lib/developer/github/github-app-client";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// Capa de datos de la conexión GitHub de un workspace. Escritura solo desde el
// backend (service_role). Todas las lecturas/escrituras de usuario van SCOPED
// por workspace_id -- un workspace nunca toca la instalación/repo de otro.
// Las operaciones del WEBHOOK van por installation_id (no traen workspace).

export type InstallationFila = {
  id: string;
  workspace_id: string;
  installation_id: number;
  github_account_login: string;
  github_account_id: number | null;
  github_account_type: string | null;
  estado: "activo" | "sin_acceso" | "desconectado";
  created_at: string;
  updated_at: string;
  desconectado_at: string | null;
};

export type RepoFila = {
  id: string;
  workspace_id: string;
  installation_row_id: string;
  repo_id: number;
  owner_login: string;
  repo_name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  estado: "vinculado" | "desvinculado";
  created_at: string;
  updated_at: string;
};

const CAMPOS_INST =
  "id, workspace_id, installation_id, github_account_login, github_account_id, github_account_type, estado, created_at, updated_at, desconectado_at";
const CAMPOS_REPO =
  "id, workspace_id, installation_row_id, repo_id, owner_login, repo_name, full_name, html_url, private, estado, created_at, updated_at";

/** Upsert de la instalación del workspace (reconectar reemplaza). Devuelve la fila. */
export async function guardarInstalacion(
  supabase: SupabaseClient,
  params: { workspaceId: string; installation: GithubInstallation }
): Promise<InstallationFila> {
  const inst = params.installation;
  const { data, error } = await supabase
    .from("dulabs_dev_github_installations")
    .upsert(
      {
        workspace_id: params.workspaceId,
        installation_id: inst.id,
        github_account_login: inst.accountLogin,
        github_account_id: inst.accountId,
        github_account_type: inst.accountType,
        estado: inst.suspended ? "sin_acceso" : "activo",
        desconectado_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    )
    .select(CAMPOS_INST)
    .single();
  if (error) throw new Error(`[github/installations] error guardando instalación: ${error.message}`);
  return data as InstallationFila;
}

export async function obtenerInstalacionDeWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<InstallationFila | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_github_installations")
    .select(CAMPOS_INST)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`[github/installations] error leyendo instalación: ${error.message}`);
  return (data as InstallationFila) ?? null;
}

export async function obtenerRepoDeWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<RepoFila | null> {
  const { data, error } = await supabase
    .from("dulabs_dev_github_repos")
    .select(CAMPOS_REPO)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`[github/installations] error leyendo repo: ${error.message}`);
  return (data as RepoFila) ?? null;
}

/** Vincula (o reemplaza) el repo seleccionado del workspace. */
export async function guardarRepoSeleccionado(
  supabase: SupabaseClient,
  params: { workspaceId: string; installationRowId: string; repo: GithubRepo }
): Promise<RepoFila> {
  const r = params.repo;
  const { data, error } = await supabase
    .from("dulabs_dev_github_repos")
    .upsert(
      {
        workspace_id: params.workspaceId,
        installation_row_id: params.installationRowId,
        repo_id: r.repoId,
        owner_login: r.ownerLogin,
        repo_name: r.repoName,
        full_name: r.fullName,
        html_url: r.htmlUrl,
        private: r.private,
        estado: "vinculado",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    )
    .select(CAMPOS_REPO)
    .single();
  if (error) throw new Error(`[github/installations] error guardando repo: ${error.message}`);
  return data as RepoFila;
}

/** Desvincula por completo la conexión GitHub del workspace (borra repo + instalación). */
export async function desconectarWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<void> {
  const { error: eRepo } = await supabase.from("dulabs_dev_github_repos").delete().eq("workspace_id", workspaceId);
  if (eRepo) throw new Error(`[github/installations] error borrando repo: ${eRepo.message}`);
  const { error: eInst } = await supabase.from("dulabs_dev_github_installations").delete().eq("workspace_id", workspaceId);
  if (eInst) throw new Error(`[github/installations] error borrando instalación: ${eInst.message}`);
}

// --- Operaciones del WEBHOOK (por installation_id, sin workspace) ----------

/** Marca TODAS las instalaciones con ese installation_id en un estado dado (webhook). */
export async function marcarInstalacionesPorInstallationId(
  supabase: SupabaseClient,
  params: { installationId: number; estado: "sin_acceso" | "desconectado" | "activo" }
): Promise<number> {
  const cambios: Record<string, unknown> = { estado: params.estado, updated_at: new Date().toISOString() };
  if (params.estado === "desconectado") cambios.desconectado_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("dulabs_dev_github_installations")
    .update(cambios)
    .eq("installation_id", params.installationId)
    .select("id");
  if (error) throw new Error(`[github/installations] error actualizando por installation_id: ${error.message}`);
  return (data ?? []).length;
}

/** Ante installation.deleted: marca la(s) instalación(es) desconectadas y desvincula sus repos. */
export async function desconectarPorInstallationId(supabase: SupabaseClient, installationId: number): Promise<number> {
  const { data: filas, error } = await supabase
    .from("dulabs_dev_github_installations")
    .select("id")
    .eq("installation_id", installationId);
  if (error) throw new Error(`[github/installations] error buscando por installation_id: ${error.message}`);
  const ids = (filas ?? []).map((f) => f.id as string);
  if (ids.length === 0) return 0;
  await supabase.from("dulabs_dev_github_repos").update({ estado: "desvinculado", updated_at: new Date().toISOString() }).in("installation_row_id", ids);
  return marcarInstalacionesPorInstallationId(supabase, { installationId, estado: "desconectado" });
}

/**
 * Ante installation_repositories (removed): si el repo seleccionado por algún
 * workspace de esta instalación ya no está autorizado, lo marca desvinculado.
 */
export async function marcarReposRemovidos(
  supabase: SupabaseClient,
  params: { installationId: number; repoIdsRemovidos: number[] }
): Promise<number> {
  if (params.repoIdsRemovidos.length === 0) return 0;
  const { data: insts, error } = await supabase
    .from("dulabs_dev_github_installations")
    .select("id")
    .eq("installation_id", params.installationId);
  if (error) throw new Error(`[github/installations] error buscando instalación (repos removidos): ${error.message}`);
  const ids = (insts ?? []).map((f) => f.id as string);
  if (ids.length === 0) return 0;
  const { data, error: eUpd } = await supabase
    .from("dulabs_dev_github_repos")
    .update({ estado: "desvinculado", updated_at: new Date().toISOString() })
    .in("installation_row_id", ids)
    .in("repo_id", params.repoIdsRemovidos)
    .select("id");
  if (eUpd) throw new Error(`[github/installations] error desvinculando repos removidos: ${eUpd.message}`);
  return (data ?? []).length;
}
