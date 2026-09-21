"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { puedeGestionarRecursos } from "@/lib/dev-dashboard/dev-permissions";
import { PageHeader } from "@/components/developer/PageHeader";
import { EmptyState } from "@/components/developer/EmptyState";
import { ErrorState } from "@/components/developer/ErrorState";
import { TableSkeleton } from "@/components/developer/Skeleton";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { ConfirmDialog } from "@/components/developer/ConfirmDialog";
import { OPENAPI_BASE_URL } from "@/lib/developers/openapi";
import type { GithubRepoOption } from "@/lib/dev-dashboard/dev-client";
import { DevApiError } from "@/lib/dev-dashboard/dev-client";

const STACKS = ["Claude", "Claude Code", "Cursor", "Codex", "GitHub Copilot", "Gemini", "Windsurf", "tu propio código"];

const MENSAJE_ERROR_CALLBACK: Record<string, string> = {
  not_configured: "La integración de GitHub no está configurada todavía.",
  sin_state: "Instala la App desde el botón «Conectar GitHub» de esta página para vincularla a tu workspace.",
  state_invalido: "El enlace de conexión expiró o ya se usó. Intenta conectar de nuevo.",
  state_error: "No pudimos validar la conexión. Intenta de nuevo.",
  cancelado: "Conexión cancelada.",
  pendiente_aprobacion: "La instalación quedó pendiente de que un administrador de la organización la apruebe en GitHub.",
  instalacion_no_encontrada: "No encontramos esa instalación en GitHub.",
  github_error: "GitHub devolvió un error. Intenta de nuevo en un momento.",
  persistencia: "No pudimos guardar la conexión. Intenta de nuevo.",
};

export default function GithubPage() {
  const { client, rol, selectedWorkspaceId } = useDeveloper();
  const router = useRouter();
  const searchParams = useSearchParams();
  const puedeGestionar = puedeGestionarRecursos(rol);

  const { data, loading, error, reload } = useDevResource(selectedWorkspaceId, async () =>
    selectedWorkspaceId ? await client.github.status() : null
  );
  // Número de WhatsApp del workspace (para el mensaje de infraestructura). No bloquea la vista de GitHub si falla.
  const { data: numeros } = useDevResource(selectedWorkspaceId, async () =>
    selectedWorkspaceId ? (await client.numbers.list().catch(() => ({ numbers: [] }))).numbers : null
  );

  const [aviso, setAviso] = useState<{ tono: "success" | "error"; texto: string } | null>(null);
  const [accionando, setAccionando] = useState(false);
  const [repos, setRepos] = useState<GithubRepoOption[] | null>(null);
  const [cargandoRepos, setCargandoRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [confirmarDesconexion, setConfirmarDesconexion] = useState(false);

  // Banner tras el callback de GitHub (?connected=1 / ?error=...). Limpia la URL.
  // Los setState se difieren a un callback de promesa (regla
  // react-hooks/set-state-in-effect de React 19, igual que el resto del dashboard).
  useEffect(() => {
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");
    if (!connected && !err) return;
    router.replace("/developer/github");
    Promise.resolve().then(() => {
      if (connected) setAviso({ tono: "success", texto: "GitHub conectado. Ahora elige el repositorio donde desarrollas tu aplicación." });
      else if (err) setAviso({ tono: "error", texto: MENSAJE_ERROR_CALLBACK[err] ?? "No pudimos completar la conexión con GitHub." });
      reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const conectar = useCallback(async () => {
    setAccionando(true);
    setAviso(null);
    try {
      const { installUrl } = await client.github.connect();
      window.location.href = installUrl; // redirección top-level: GitHub vuelve al callback
    } catch (e) {
      setAviso({ tono: "error", texto: e instanceof DevApiError && e.code === "github_not_configured" ? "La integración de GitHub no está configurada en este entorno." : "No pudimos iniciar la conexión con GitHub." });
      setAccionando(false);
    }
  }, [client]);

  const cargarRepos = useCallback(async () => {
    setCargandoRepos(true);
    setReposError(null);
    try {
      const { repos: lista } = await client.github.repos();
      setRepos(lista);
    } catch (e) {
      setReposError(e instanceof DevApiError && e.code === "github_access_lost" ? "Se perdió el acceso a GitHub. Reconecta la App." : "No pudimos listar tus repositorios.");
    } finally {
      setCargandoRepos(false);
    }
  }, [client]);

  const elegirRepo = useCallback(
    async (repoId: number) => {
      setAccionando(true);
      setAviso(null);
      try {
        await client.github.selectRepo(repoId);
        setRepos(null);
        setAviso({ tono: "success", texto: "Repositorio vinculado." });
        reload();
      } catch {
        setAviso({ tono: "error", texto: "No pudimos vincular el repositorio." });
      } finally {
        setAccionando(false);
      }
    },
    [client, reload]
  );

  const desconectar = useCallback(async () => {
    setAccionando(true);
    try {
      await client.github.disconnect();
      setConfirmarDesconexion(false);
      setRepos(null);
      setAviso({ tono: "success", texto: "GitHub desconectado." });
      reload();
    } finally {
      setAccionando(false);
    }
  }, [client, reload]);

  const conexion = data?.connection ?? null;
  const configurado = data?.configured ?? true;
  const instalado = Boolean(conexion?.installation);
  const accesoPerdido = conexion?.installation?.status === "sin_acceso";
  const repo = conexion?.repo ?? null;
  const numeroConectado = (numeros ?? []).find((n) => n.status === "conectado") ?? (numeros ?? [])[0] ?? null;

  const botonConectar = puedeGestionar ? (
    <button onClick={conectar} disabled={accionando || !configurado} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50">
      {accionando ? "Abriendo GitHub…" : instalado ? "Reconectar GitHub" : "Conectar GitHub"}
    </button>
  ) : null;

  return (
    <>
      <PageHeader
        title="GitHub"
        description="Vincula el repositorio donde desarrollas tu aplicación para trabajar sobre la infraestructura de DuLabs. Tu código sigue siendo tuyo: DuLabs no lo lee, ni lo clona, ni lo modifica."
        actions={instalado && repo ? botonConectar : undefined}
      />

      {aviso ? (
        <div className={`mb-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${aviso.tono === "success" ? "border-success-text/30 bg-success text-success-text" : "border-danger-text/30 bg-danger text-danger-text"}`}>
          <span>{aviso.texto}</span>
          <button onClick={() => setAviso(null)} className="shrink-0 rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:opacity-80">Cerrar</button>
        </div>
      ) : null}

      {!configurado && puedeGestionar ? (
        <div className="mb-4 rounded-lg border border-warning-text/30 bg-warning px-4 py-3 text-sm text-warning-text">
          La integración de GitHub aún no está configurada en este entorno. Estará disponible cuando se configure la GitHub App (ver docs/GITHUB_INTEGRATION_SETUP.md).
        </div>
      ) : null}

      {loading ? (
        <TableSkeleton cols={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <EmptyState title="Selecciona un workspace" />
      ) : !instalado ? (
        <EmptyState
          title="Conecta tu GitHub"
          description="Instala la GitHub App de DuLabs y elige el repositorio de tu aplicación. Usa permisos mínimos (solo metadata de repos) — no accede a tu código."
          action={puedeGestionar ? (botonConectar ?? undefined) : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {accesoPerdido ? (
            <div className="rounded-lg border border-warning-text/30 bg-warning px-4 py-3 text-sm text-warning-text">
              Se perdió el acceso a GitHub (la instalación fue suspendida o removida). Reconecta la App para volver a vincular un repositorio.
            </div>
          ) : null}

          {/* Estado de la conexión */}
          <section className="rounded-xl border border-edge bg-card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-fg">GitHub conectado</h2>
              <StatusBadge tono={accesoPerdido ? "warning" : "success"}>{conexion?.installation?.status}</StatusBadge>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-mist">Cuenta de GitHub</dt>
                <dd className="mt-0.5 text-sm text-fg">
                  {conexion?.installation?.accountLogin}
                  {conexion?.installation?.accountType ? <span className="ml-1 text-xs text-mist">({conexion.installation.accountType === "Organization" ? "org" : "usuario"})</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-mist">Repositorio</dt>
                <dd className="mt-0.5 text-sm text-fg">
                  {repo ? (
                    <a href={repo.htmlUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-dev-accent hover:underline">
                      {repo.fullName} ↗
                    </a>
                  ) : (
                    <span className="text-mist">Sin repositorio seleccionado</span>
                  )}
                  {repo?.private ? <span className="ml-2 rounded border border-edge px-1.5 py-0.5 text-[10px] text-mist">privado</span> : null}
                </dd>
              </div>
            </dl>

            {puedeGestionar ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {!accesoPerdido ? (
                  <button
                    onClick={() => (repos === null ? cargarRepos() : setRepos(null))}
                    disabled={cargandoRepos || accionando}
                    className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-fg hover:border-dev-accent/40 disabled:opacity-50"
                  >
                    {cargandoRepos ? "Cargando…" : repos !== null ? "Ocultar" : repo ? "Cambiar repositorio" : "Elegir repositorio"}
                  </button>
                ) : null}
                <button onClick={() => setConfirmarDesconexion(true)} disabled={accionando} className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-mist hover:border-danger-text/40 hover:text-danger-text disabled:opacity-50">
                  Desconectar GitHub
                </button>
              </div>
            ) : null}

            {reposError ? <p className="mt-3 text-xs text-danger-text">{reposError}</p> : null}

            {repos !== null ? (
              <div className="mt-4 rounded-lg border border-edge bg-ink">
                {repos.length === 0 ? (
                  <p className="p-4 text-sm text-mist">La instalación no tiene repositorios autorizados. Ajusta el acceso de la App en GitHub y vuelve a cargar.</p>
                ) : (
                  <ul className="max-h-72 divide-y divide-edge overflow-y-auto">
                    {repos.map((r) => {
                      const seleccionado = repo?.repoId === r.repoId;
                      return (
                        <li key={r.repoId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-fg">{r.fullName}</p>
                            {r.private ? <span className="text-[10px] uppercase tracking-wider text-mist">privado</span> : null}
                          </div>
                          <button
                            onClick={() => elegirRepo(r.repoId)}
                            disabled={accionando || seleccionado}
                            className="shrink-0 rounded-md border border-edge px-2.5 py-1 text-xs font-medium text-fg hover:border-dev-accent/40 disabled:opacity-50"
                          >
                            {seleccionado ? "Vinculado" : "Vincular"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}
          </section>

          {/* Mensaje de infraestructura (Fase 7): trae tu stack, nosotros la infra oficial de WhatsApp */}
          {repo ? (
            <section className="rounded-xl border border-edge bg-card p-5">
              <h2 className="text-sm font-semibold text-fg">Construye con el stack que prefieras</h2>
              <p className="mt-1 text-sm text-mist">
                DuLabs no controla cómo construyes tu agente. Trabajas en tu repositorio con la herramienta que quieras; DuLabs te da la infraestructura oficial de WhatsApp.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {STACKS.map((s) => (
                  <span key={s} className="rounded-full border border-edge px-2.5 py-1 text-[11px] text-mist">{s}</span>
                ))}
              </div>
              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-mist">Repositorio</dt>
                  <dd className="mt-0.5 truncate font-mono text-xs text-fg">{repo.fullName}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-mist">WhatsApp</dt>
                  <dd className="mt-0.5 font-mono text-xs text-fg">{numeroConectado ? (numeroConectado.displayName ?? numeroConectado.phoneNumberId) : "conecta un número"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-mist">API</dt>
                  <dd className="mt-0.5 font-mono text-xs text-fg">{OPENAPI_BASE_URL}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-mist">
                Autentica con tu API key (<code className="text-fg">dl_live_…</code>) y envía mensajes con <code className="text-fg">POST /messages</code>. Crea una key en <a href="/developer/api-keys" className="text-dev-accent hover:underline">API Keys</a>.
              </p>
            </section>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={confirmarDesconexion}
        title="Desconectar GitHub"
        description="Se quitará la vinculación del repositorio y se revocará el acceso de la App en DuLabs. Tu código y tu repositorio no se tocan. Podrás reconectar cuando quieras."
        confirmLabel="Desconectar"
        danger
        loading={accionando}
        onConfirm={desconectar}
        onClose={() => setConfirmarDesconexion(false)}
      />
    </>
  );
}
