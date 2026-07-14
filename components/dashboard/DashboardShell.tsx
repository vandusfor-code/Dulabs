"use client";

import { useCallback, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { DashboardSessionProvider, useDashboard } from "@/lib/dashboard-session";

const NAV = [
  { href: "/dashboard", label: "Resumen", icon: "◧" },
  { href: "/dashboard/conexion", label: "Números", icon: "☎" },
  { href: "/dashboard/plantillas", label: "Plantillas y Campañas", icon: "▤" },
  { href: "/dashboard/mensajes", label: "Mensajes", icon: "◆" },
  { href: "/dashboard/cuenta", label: "Cuenta", icon: "●" },
];

function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const cerrarSesion = useCallback(async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  }, [router]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-edge/60 bg-ink-2/60 px-4 py-6">
      <Link href="/" className="flex items-center gap-2.5 px-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-lime text-[11px] font-bold tracking-tight text-ink">
          DU
        </span>
        <span className="text-sm font-semibold tracking-[0.18em] text-white">
          DU LABS
        </span>
      </Link>

      <nav className="mt-8 flex flex-col gap-1">
        {NAV.map((item) => {
          const activo =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 ${
                activo
                  ? "bg-lime/10 font-semibold text-lime"
                  : "text-mist hover:bg-ink-2 hover:text-white"
              }`}
            >
              <span className="w-4 text-center text-xs">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={cerrarSesion}
        className="mt-auto rounded-lg border border-edge px-3 py-2.5 text-left text-sm text-mist transition-colors duration-200 hover:border-mist/40 hover:text-white"
      >
        Cerrar sesión
      </button>
    </aside>
  );
}

function Topbar() {
  const { session } = useDashboard();
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-edge/60 bg-ink-2/40 px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-lime">
        Du IA Business
      </p>
      <p className="text-sm text-mist">{session?.user.email}</p>
    </header>
  );
}

export default function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <DashboardSessionProvider>
      <div className="flex min-h-screen bg-ink text-white">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-x-hidden px-8 py-8">{children}</main>
        </div>
      </div>
    </DashboardSessionProvider>
  );
}
