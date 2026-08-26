"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Sparkles, Plus, Tag, User } from "lucide-react";
import { cn } from "./ui";

export function MobileNav({ token, onNuevaCita }: { token: string; onNuevaCita: () => void }) {
  const pathname = usePathname();
  const agendaHref = `/agenda/${token}`;
  const active = pathname === agendaHref || pathname.startsWith(`${agendaHref}/`);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-around border-t border-edge bg-card px-2 pb-[env(safe-area-inset-bottom)] pt-2 lg:hidden">
      <Link
        href={agendaHref}
        className={cn("flex flex-1 flex-col items-center gap-1 px-2 py-1.5", active ? "text-lime-text" : "text-mist")}
      >
        <CalendarDays className="size-5" />
        <span className="text-[10.5px] font-medium">Agenda</span>
      </Link>

      <div className="flex flex-1 flex-col items-center gap-1 px-2 py-1.5 text-mist/40">
        <Sparkles className="size-5" />
        <span className="text-[10.5px] font-medium">Servicios</span>
      </div>

      <button
        onClick={onNuevaCita}
        aria-label="Nueva cita"
        className="mx-1 flex size-12 shrink-0 -translate-y-3 items-center justify-center rounded-full bg-lime text-lime-fg shadow-lg shadow-lime/30"
      >
        <Plus className="size-6" />
      </button>

      <div className="flex flex-1 flex-col items-center gap-1 px-2 py-1.5 text-mist/40">
        <Tag className="size-5" />
        <span className="text-[10.5px] font-medium">Promos</span>
      </div>

      <div className="flex flex-1 flex-col items-center gap-1 px-2 py-1.5 text-mist/40">
        <User className="size-5" />
        <span className="text-[10.5px] font-medium">Mi perfil</span>
      </div>
    </nav>
  );
}
