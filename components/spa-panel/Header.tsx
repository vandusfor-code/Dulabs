"use client";

import { Bell, Plus } from "lucide-react";
import { Button } from "./ui";
import { inicialesDe } from "./format";

export function Header({
  nombre,
  servicio,
  onNuevaCita,
}: {
  nombre: string;
  servicio: string;
  onNuevaCita: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-edge bg-ink/90 px-4 py-4 backdrop-blur lg:px-8 lg:py-5">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold text-fg lg:text-2xl">Hola, {nombre} 👋</h1>
        <p className="mt-0.5 hidden text-sm text-mist sm:block">
          Qué gusto tenerte por aquí. Gestiona tus citas de forma fácil y rápida.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 lg:gap-3">
        <div className="hidden sm:block">
          <Button onClick={onNuevaCita}>
            <Plus className="size-4" /> Nueva cita
          </Button>
        </div>
        <button
          aria-label="Notificaciones"
          className="flex size-10 items-center justify-center rounded-full border border-edge bg-card text-mist transition-colors hover:text-fg"
        >
          <Bell className="size-[18px]" />
        </button>
        <div className="hidden items-center gap-2.5 rounded-full border border-edge bg-card py-1 pl-1 pr-3 lg:flex">
          <div className="flex size-8 items-center justify-center rounded-full bg-lime-soft text-[11px] font-semibold text-lime-text">
            {inicialesDe(nombre)}
          </div>
          <div className="leading-tight">
            <p className="text-xs font-medium text-fg">{nombre}</p>
            <p className="text-[10.5px] text-mist">{servicio}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
