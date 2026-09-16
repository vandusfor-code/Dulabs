"use client";

import { createContext, useCallback, useContext, useMemo, useState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { createDevClient, type DevClient, type WorkspaceInfo } from "@/lib/dev-dashboard/dev-client";
import type { RolDev } from "@/lib/dev-dashboard/dev-permissions";

// DuLabs Developer V1 -- Fase 9 (autorizado, D4). Contexto de sesión del
// Developer Dashboard: sesión Supabase real, workspaces del usuario, selección
// persistente (solo el ID, nunca un secreto) validada contra las membresías
// reales, y el cliente API centralizado ya ligado a token + X-Dulabs-Workspace.
// Independiente de Business. El estado se escribe SOLO dentro de callbacks de
// promesa (compatible con las reglas de hooks de React 19), igual que el
// contexto de sesión de Business.

const WORKSPACE_KEY = "du_dev_workspace";

export const supabaseConfigFaltante = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type EstadoBootstrap = "verificando" | "listo" | "error";

type DeveloperContextValue = {
  session: Session;
  email: string | null;
  userId: string;
  workspaces: WorkspaceInfo[];
  selectedWorkspaceId: string | null;
  rol: RolDev | null;
  selectWorkspace: (workspaceId: string) => void;
  client: DevClient;
  recargarWorkspaces: () => void;
};

const DeveloperContext = createContext<DeveloperContextValue | null>(null);

function leerWorkspaceGuardado(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

function guardarWorkspace(id: string) {
  try {
    window.localStorage.setItem(WORKSPACE_KEY, id);
  } catch {
    // incógnito -- no crítico
  }
}

export function DeveloperSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | "verificando">("verificando");
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoBootstrap>("verificando");
  const [errorBootstrap, setErrorBootstrap] = useState<string | null>(null);

  const accessToken = typeof session === "object" && session ? session.access_token : null;

  // Cliente para los componentes: getters cierran sobre VALORES vigentes
  // (nunca refs leídos en render). Se recrea si cambian token/workspace.
  const client = useMemo(
    () => createDevClient({ getToken: () => accessToken, getWorkspaceId: () => selectedWorkspaceId }),
    [accessToken, selectedWorkspaceId]
  );

  const cargarWorkspaces = useCallback((token: string) => {
    const bootstrap = createDevClient({ getToken: () => token, getWorkspaceId: () => null });
    bootstrap.workspace().then(
      (data) => {
        setWorkspaces(data.workspaces);
        const guardado = leerWorkspaceGuardado();
        const valido = Boolean(guardado && data.workspaces.some((w) => w.workspaceId === guardado));
        const elegido = valido ? guardado! : data.selected?.workspaceId ?? (data.workspaces.length === 1 ? data.workspaces[0].workspaceId : null);
        setSelectedWorkspaceId(elegido);
        if (elegido) guardarWorkspace(elegido);
        setEstado("listo");
      },
      (err) => {
        setErrorBootstrap(err instanceof Error ? err.message : String(err));
        setEstado("error");
      }
    );
  }, []);

  const selectWorkspace = useCallback((workspaceId: string) => {
    setWorkspaces((actuales) => {
      if (actuales.some((w) => w.workspaceId === workspaceId)) {
        setSelectedWorkspaceId(workspaceId);
        guardarWorkspace(workspaceId);
      }
      return actuales;
    });
  }, []);

  const recargarWorkspaces = useCallback(() => {
    if (typeof session === "object" && session) {
      setEstado("verificando");
      cargarWorkspaces(session.access_token);
    }
  }, [session, cargarWorkspaces]);

  useEffect(() => {
    if (supabaseConfigFaltante) return;
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login?next=/developer");
        return;
      }
      setSession(data.session);
      cargarWorkspaces(data.session.access_token);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) {
        router.replace("/login?next=/developer");
        return;
      }
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [router, cargarWorkspaces]);

  if (supabaseConfigFaltante) {
    return (
      <div className="dev-scope flex min-h-screen items-center justify-center bg-ink px-6 text-fg">
        <p className="max-w-md rounded-md border border-danger-text/40 bg-danger/20 p-4 text-sm text-danger-text">
          Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno.
        </p>
      </div>
    );
  }
  if (session === "verificando" || (session && estado === "verificando")) {
    return (
      <div className="dev-scope flex min-h-screen items-center justify-center bg-ink px-6 text-mist">
        <p className="text-sm">Loading your workspace…</p>
      </div>
    );
  }
  if (!session) return null;
  if (estado === "error") {
    return (
      <div className="dev-scope flex min-h-screen items-center justify-center bg-ink px-6 text-fg">
        <div className="max-w-md rounded-md border border-edge bg-card p-5 text-sm">
          <p className="mb-2 font-medium">No pudimos cargar tu cuenta de developer.</p>
          <p className="text-mist">{errorBootstrap}</p>
          <button onClick={recargarWorkspaces} className="mt-4 rounded-md border border-edge px-3 py-1.5 text-sm hover:bg-ink-2">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const rol = workspaces.find((w) => w.workspaceId === selectedWorkspaceId)?.rol ?? null;

  return (
    <DeveloperContext.Provider
      value={{
        session,
        email: session.user?.email ?? null,
        userId: session.user?.id ?? "",
        workspaces,
        selectedWorkspaceId,
        rol,
        selectWorkspace,
        client,
        recargarWorkspaces,
      }}
    >
      {children}
    </DeveloperContext.Provider>
  );
}

export function useDeveloper(): DeveloperContextValue {
  const ctx = useContext(DeveloperContext);
  if (!ctx) throw new Error("useDeveloper debe usarse dentro de DeveloperSessionProvider");
  return ctx;
}
