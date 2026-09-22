import { generarGithubAppJwt } from "@/lib/developer/github/github-app-jwt";
import type { GithubAppConfig } from "@/lib/developer/github/github-config";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// Cliente mínimo de la API de GitHub para la App. Solo lo que la Fase 1
// necesita: leer la instalación, acuñar un token de instalación EFÍMERO con
// permisos mínimos (metadata:read), listar los repos autorizados, y (opcional)
// desinstalar. NUNCA loguea tokens ni el JWT. Sin dependencias nuevas: usa
// fetch global (pasa por el proxy del entorno).

const GITHUB_API = "https://api.github.com";
const ACCEPT = "application/vnd.github+json";
const UA = "DuLabs-Developers";

export type GithubApiError = { ok: false; status: number; motivo: string };

export type GithubInstallation = {
  id: number;
  accountLogin: string;
  accountId: number | null;
  accountType: "User" | "Organization" | null;
  suspended: boolean;
};

export type GithubRepo = {
  repoId: number;
  ownerLogin: string;
  repoName: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
};

function headersApp(config: GithubAppConfig): Record<string, string> {
  const { token } = generarGithubAppJwt({ appId: config.appId, privateKey: config.privateKey });
  return { Authorization: `Bearer ${token}`, Accept: ACCEPT, "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28" };
}

function headersToken(token: string): Record<string, string> {
  return { Authorization: `token ${token}`, Accept: ACCEPT, "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28" };
}

/** Detalle de una instalación (autenticado como App). null si no existe (404). */
export async function obtenerInstalacion(
  config: GithubAppConfig,
  installationId: number
): Promise<GithubInstallation | null | GithubApiError> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}/app/installations/${installationId}`, { headers: headersApp(config) });
  } catch {
    return { ok: false, status: 0, motivo: "github_unreachable" };
  }
  if (res.status === 404) return null;
  if (!res.ok) return { ok: false, status: res.status, motivo: "github_error" };
  const data = (await res.json().catch(() => null)) as {
    id?: number;
    account?: { login?: string; id?: number; type?: string };
    suspended_at?: string | null;
  } | null;
  if (!data?.id) return { ok: false, status: 502, motivo: "github_bad_response" };
  const tipo = data.account?.type;
  return {
    id: data.id,
    accountLogin: data.account?.login ?? "",
    accountId: data.account?.id ?? null,
    accountType: tipo === "User" || tipo === "Organization" ? tipo : null,
    suspended: Boolean(data.suspended_at),
  };
}

/**
 * Acuña un token de instalación EFÍMERO (~1h) con permisos mínimos
 * (metadata:read). No se persiste: se usa en la misma request y se descarta.
 */
export async function acunarTokenInstalacion(
  config: GithubAppConfig,
  installationId: number
): Promise<{ ok: true; token: string } | GithubApiError> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: { ...headersApp(config), "Content-Type": "application/json" },
      // Permisos mínimos: solo metadata de repos (listar/leer info). Fase 1 no
      // toca contenido de código.
      body: JSON.stringify({ permissions: { metadata: "read" } }),
    });
  } catch {
    return { ok: false, status: 0, motivo: "github_unreachable" };
  }
  if (!res.ok) {
    // 404/403 => la instalación ya no existe o perdió acceso.
    return { ok: false, status: res.status, motivo: res.status === 404 || res.status === 403 ? "installation_gone" : "github_error" };
  }
  const data = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!data?.token) return { ok: false, status: 502, motivo: "github_bad_response" };
  return { ok: true, token: data.token };
}

/** Lista los repos autorizados para la instalación (paginado, tope defensivo). */
export async function listarReposInstalacion(installationToken: string): Promise<GithubRepo[] | GithubApiError> {
  const repos: GithubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    let res: Response;
    try {
      res = await fetch(`${GITHUB_API}/installation/repositories?per_page=100&page=${page}`, { headers: headersToken(installationToken) });
    } catch {
      return { ok: false, status: 0, motivo: "github_unreachable" };
    }
    if (!res.ok) return { ok: false, status: res.status, motivo: "github_error" };
    const data = (await res.json().catch(() => null)) as {
      total_count?: number;
      repositories?: Array<{ id: number; name: string; full_name: string; html_url: string; private: boolean; owner?: { login?: string } }>;
    } | null;
    const lote = data?.repositories ?? [];
    for (const r of lote) {
      repos.push({
        repoId: r.id,
        ownerLogin: r.owner?.login ?? r.full_name.split("/")[0] ?? "",
        repoName: r.name,
        fullName: r.full_name,
        htmlUrl: r.html_url,
        private: Boolean(r.private),
      });
    }
    if (lote.length < 100) break;
  }
  return repos;
}

/**
 * Desinstala la App de la cuenta (revoca el acceso realmente). Best-effort: si
 * falla, el caller igual desvincula en DuLabs. 204 = ok; 404 = ya no existe.
 */
export async function desinstalarApp(config: GithubAppConfig, installationId: number): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(`${GITHUB_API}/app/installations/${installationId}`, { method: "DELETE", headers: headersApp(config) });
    return { ok: res.status === 204 || res.status === 404, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
