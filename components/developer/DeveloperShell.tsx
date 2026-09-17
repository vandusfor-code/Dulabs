"use client";

import { useState, type ReactNode } from "react";
import { DeveloperSessionProvider } from "@/lib/dev-dashboard/developer-session";
import { DeveloperSidebar } from "@/components/developer/DeveloperSidebar";
import { WorkspaceSwitcher } from "@/components/developer/WorkspaceSwitcher";
import { AccountMenu } from "@/components/developer/AccountMenu";

// DuLabs Developer V1 -- Fase 9 (D3/D4). Shell del Dashboard: sidebar fija en
// desktop, drawer en móvil, topbar con selector de workspace + cuenta.
// Envuelto en DeveloperSessionProvider (sesión + workspaces + rol).

function ShellInterno({ children }: { children: ReactNode }) {
  const [drawerAbierto, setDrawerAbierto] = useState(false);

  return (
    <div className="flex min-h-screen bg-ink text-fg">
      {/* Sidebar desktop */}
      <aside className="hidden w-60 shrink-0 border-r border-edge bg-ink-2/40 lg:block">
        <div className="sticky top-0 h-screen">
          <DeveloperSidebar />
        </div>
      </aside>

      {/* Drawer móvil */}
      {drawerAbierto ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerAbierto(false)} aria-hidden />
          <div className="absolute left-0 top-0 h-full w-64 border-r border-edge bg-ink-2">
            <DeveloperSidebar onNavigate={() => setDrawerAbierto(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-edge bg-ink/90 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <button onClick={() => setDrawerAbierto(true)} className="rounded-md border border-edge bg-card p-1.5 text-fg lg:hidden" aria-label="Open navigation">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
              </svg>
            </button>
            <WorkspaceSwitcher />
          </div>
          <div className="flex items-center gap-3">
            <AccountMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

export function DeveloperShell({ children }: { children: ReactNode }) {
  return (
    <div className="dev-scope">
      <DeveloperSessionProvider>
        <ShellInterno>{children}</ShellInterno>
      </DeveloperSessionProvider>
    </div>
  );
}
