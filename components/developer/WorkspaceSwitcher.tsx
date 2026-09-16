"use client";

import { useState } from "react";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";

// DuLabs Developer V1 -- Fase 9 (D3). Selector de workspace. Un solo
// workspace => solo muestra el nombre; varios => dropdown. Nunca expone
// workspaces ajenos (la lista viene ya filtrada por membresía real).

function corto(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function WorkspaceSwitcher() {
  const { workspaces, selectedWorkspaceId, selectWorkspace, rol } = useDeveloper();
  const [abierto, setAbierto] = useState(false);

  const actual = workspaces.find((w) => w.workspaceId === selectedWorkspaceId) ?? null;

  if (workspaces.length <= 1) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-edge bg-card px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-dev-accent" aria-hidden />
        <span className="font-mono text-xs text-fg">{actual ? corto(actual.workspaceId) : "—"}</span>
        {rol ? <span className="text-[10px] uppercase tracking-wide text-mist">{rol}</span> : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-edge bg-card px-3 py-1.5 text-xs hover:bg-ink-2"
        aria-haspopup="listbox"
        aria-expanded={abierto}
      >
        <span className="h-2 w-2 rounded-full bg-dev-accent" aria-hidden />
        <span className="font-mono text-fg">{actual ? corto(actual.workspaceId) : "Select workspace"}</span>
        {rol ? <span className="text-[10px] uppercase tracking-wide text-mist">{rol}</span> : null}
        <span className="text-mist" aria-hidden>▾</span>
      </button>
      {abierto ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAbierto(false)} aria-hidden />
          <ul className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-auto rounded-md border border-edge bg-card p-1 shadow-xl" role="listbox">
            {workspaces.map((w) => (
              <li key={w.workspaceId}>
                <button
                  onClick={() => {
                    selectWorkspace(w.workspaceId);
                    setAbierto(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-xs hover:bg-ink-2 ${w.workspaceId === selectedWorkspaceId ? "bg-ink-2" : ""}`}
                  role="option"
                  aria-selected={w.workspaceId === selectedWorkspaceId}
                >
                  <span className="font-mono text-fg">{corto(w.workspaceId)}</span>
                  <span className="text-[10px] uppercase tracking-wide text-mist">{w.rol}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
