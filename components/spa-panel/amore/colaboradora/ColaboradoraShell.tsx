"use client";

import type { ReactNode } from "react";
import { Home, CalendarDays, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { rutaInicio, rutaCitas, rutaPerfil, esRutaActiva } from "../amore-routes";

// Login AMORE (autorizado) — chrome REDUCIDO para el rol "colaboradora":
// mismo `.amore-scope` (misma piel visual que el panel de administradora),
// pero solo 3 destinos -- ningún módulo administrativo/financiero es
// alcanzable desde acá (spec Fase 6). El mismo useAgenda()/token de
// siempre -- la protección real ya ocurrió server-side.
export function ColaboradoraShell({ children }: { children: ReactNode }) {
  const { token, datos } = useAgenda();
  const pathname = usePathname();
  const nombre = datos.sesion?.nombre ?? datos.especialista.nombre;

  const item = (icono: ReactNode, label: string, href: string, activo: boolean) => (
    <Link
      href={href}
      className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium ${activo ? "text-lime-text" : "text-mist"}`}
    >
      {icono}
      {label}
    </Link>
  );

  return (
    <div className="amore-scope min-h-screen bg-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col">
        <header className="px-5 pt-5">
          <div className="flex items-center justify-between">
            <img src="/amore/logo.png" alt="AMORE Salón de Belleza" width={2067} height={761} className="h-auto w-[min(180px,44vw)] object-contain" />
            <p className="truncate text-sm font-medium text-fg">{nombre}</p>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden px-5 pb-28 pt-4">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[430px] border-t border-edge bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center px-2">
          {item(<Home className="size-5" />, "Mi día", rutaInicio(token), pathname === rutaInicio(token))}
          {item(<CalendarDays className="size-5" />, "Mis citas", rutaCitas(token), esRutaActiva(pathname, rutaCitas(token)))}
          {item(<User className="size-5" />, "Perfil", rutaPerfil(token), esRutaActiva(pathname, rutaPerfil(token)))}
        </div>
      </nav>
    </div>
  );
}
