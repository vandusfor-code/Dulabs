"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEV_NAV, esRutaActiva } from "@/components/developer/nav";
import { NavIcon } from "@/components/developer/NavIcon";

// DuLabs Developer V1 -- Fase 9. Sidebar de navegación. onNavigate permite
// cerrar el drawer en móvil al elegir un ítem.

export function DeveloperSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <Link href="/developer" onClick={onNavigate} className="flex items-center gap-2 px-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-dev-accent text-xs font-bold text-dev-accent-fg">D</span>
        <span className="text-sm font-semibold tracking-tight text-fg">DuLabs Developer</span>
      </Link>
      <div className="flex flex-col gap-5">
        {DEV_NAV.map((section, i) => (
          <div key={section.title ?? `s${i}`} className="flex flex-col gap-1">
            {section.title ? <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-mist">{section.title}</p> : null}
            {section.items.map((item) => {
              const activo = esRutaActiva(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={activo ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    activo ? "bg-dev-accent-soft text-fg" : "text-mist hover:bg-ink-2 hover:text-fg"
                  }`}
                >
                  <NavIcon name={item.icon} className={activo ? "h-4 w-4 text-dev-accent" : "h-4 w-4"} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
