"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Calendar, ListChecks, Users, Sparkles, UserRound, Clock3, Ban, Tag, BarChart3, Settings } from "lucide-react";
import { cn } from "./ui";
import { partesLogo } from "./format";

const NAV = [
  { label: "Inicio", icon: CalendarDays, href: (t: string) => `/agenda/${t}`, disponible: true },
  { label: "Citas", icon: ListChecks, href: (t: string) => `/agenda/${t}/completa`, disponible: true },
  { label: "Calendario", icon: Calendar, href: (t: string) => `/agenda/${t}/calendario`, disponible: true },
  { label: "Clientes", icon: Users, href: (t: string) => `/agenda/${t}/clientes`, disponible: true },
  { label: "Servicios", icon: Sparkles, href: (t: string) => `/agenda/${t}/servicios`, disponible: true },
  { label: "Profesionales", icon: UserRound, href: (t: string) => `/agenda/${t}/profesionales`, disponible: true },
  { label: "Horarios", icon: Clock3, href: (t: string) => `/agenda/${t}/horarios`, disponible: true },
  { label: "Bloqueos", icon: Ban, href: (t: string) => `/agenda/${t}/bloqueos`, disponible: true },
  { label: "Promociones", icon: Tag, disponible: false },
  { label: "Reportes", icon: BarChart3, disponible: false },
  { label: "Configuración", icon: Settings, disponible: false },
];

export function Sidebar({ token, negocio }: { token: string; negocio: string }) {
  const pathname = usePathname();
  const [linea1, linea2] = partesLogo(negocio);

  return (
    <div className="flex h-full flex-col bg-ink-2">
      <div className="flex h-20 flex-col justify-center px-6">
        <span className="text-[15px] font-semibold leading-tight tracking-tight text-fg">{linea1}</span>
        {linea2 && (
          <span className="mt-0.5 text-[10.5px] font-medium uppercase tracking-[0.16em] text-lime-text">
            {linea2}
          </span>
        )}
      </div>

      <nav className="mt-2 flex-1 space-y-0.5 px-3">
        {NAV.map((item) => {
          const href = item.disponible ? item.href!(token) : undefined;
          const active = href ? pathname === href || pathname.startsWith(`${href}/`) : false;
          const Icon = item.icon;

          if (!href) {
            return (
              <div
                key={item.label}
                className="flex cursor-default items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-mist/50"
                title="Próximamente"
              >
                <Icon className="size-[18px] shrink-0" />
                <span className="flex-1">{item.label}</span>
                <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-medium text-mist/70">Pronto</span>
              </div>
            );
          }

          return (
            <Link
              key={item.label}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                active ? "bg-lime-soft font-medium text-lime-text" : "text-mist hover:bg-card hover:text-fg"
              )}
            >
              <Icon className={cn("size-[18px] shrink-0", active ? "text-lime-text" : "text-mist")} />
              <span className="flex-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
