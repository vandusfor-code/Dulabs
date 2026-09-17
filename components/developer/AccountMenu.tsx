"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";

// DuLabs Developer V1 -- menú de cuenta del topbar. Provee el cierre de sesión
// real (supabase.auth.signOut) que faltaba en el shell, más accesos a perfil y
// configuración. El signOut limpia el estado de Supabase y la selección de
// workspace persistida, y redirige al login: no debe quedar sesión zombie ni
// referencia al workspace en el navegador.

function inicial(email: string | null): string {
  const base = (email ?? "?").trim();
  return base ? base[0]!.toUpperCase() : "?";
}

export function AccountMenu() {
  const { email } = useDeveloper();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    function alClic(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false);
    }
    function alEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierto(false);
    }
    document.addEventListener("mousedown", alClic);
    document.addEventListener("keydown", alEsc);
    return () => {
      document.removeEventListener("mousedown", alClic);
      document.removeEventListener("keydown", alEsc);
    };
  }, [abierto]);

  async function cerrarSesion() {
    setCerrando(true);
    try {
      await supabaseBrowser().auth.signOut();
    } catch {
      // aunque falle la llamada remota, limpiamos el estado local igual.
    }
    try {
      window.localStorage.removeItem("du_dev_workspace");
    } catch {
      // incógnito -- no crítico
    }
    // replace (no push) para que "atrás" no regrese al dashboard con sesión muerta.
    router.replace("/login");
    router.refresh();
  }

  return (
    <div ref={contenedorRef} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        className="flex items-center gap-2 rounded-md border border-edge bg-card px-1.5 py-1 text-fg transition-colors hover:bg-ink-2"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-dev-accent text-xs font-bold text-dev-accent-fg">
          {inicial(email)}
        </span>
        {email ? <span className="hidden max-w-[160px] truncate text-xs text-mist sm:inline">{email}</span> : null}
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-mist" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {abierto ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-52 overflow-hidden rounded-lg border border-edge bg-card shadow-lg"
        >
          <div className="border-b border-edge px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-mist">Sesión</p>
            <p className="mt-0.5 truncate text-xs text-fg" title={email ?? undefined}>{email ?? "—"}</p>
          </div>
          <div className="flex flex-col p-1">
            <Link
              href="/developer/settings"
              role="menuitem"
              onClick={() => setAbierto(false)}
              className="rounded-md px-2.5 py-1.5 text-sm text-mist transition-colors hover:bg-ink-2 hover:text-fg"
            >
              Mi perfil
            </Link>
            <Link
              href="/developer/settings"
              role="menuitem"
              onClick={() => setAbierto(false)}
              className="rounded-md px-2.5 py-1.5 text-sm text-mist transition-colors hover:bg-ink-2 hover:text-fg"
            >
              Configuración
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={cerrarSesion}
              disabled={cerrando}
              className="mt-0.5 rounded-md px-2.5 py-1.5 text-left text-sm text-danger-text transition-colors hover:bg-danger/20 disabled:opacity-60"
            >
              {cerrando ? "Cerrando sesión…" : "Cerrar sesión"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
