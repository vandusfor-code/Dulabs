"use client";

import { cn } from "./ui";
import type { EstadoCita } from "./types";

export type Filtro = "todas" | Extract<EstadoCita, "confirmada" | "pendiente" | "cancelada">;

const FILTROS: { key: Filtro; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "confirmada", label: "Confirmadas" },
  { key: "pendiente", label: "Pendientes" },
  { key: "cancelada", label: "Canceladas" },
];

export function FilterPills({
  activo,
  conteos,
  onChange,
}: {
  activo: Filtro;
  conteos: Record<Filtro, number>;
  onChange: (f: Filtro) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {FILTROS.map((f) => {
        const seleccionado = activo === f.key;
        return (
          <button
            key={f.key}
            onClick={() => onChange(f.key)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
              seleccionado ? "border-lime/40 bg-lime-soft text-lime-text" : "border-edge bg-card text-mist hover:text-fg"
            )}
          >
            {f.label} ({conteos[f.key]})
          </button>
        );
      })}
    </div>
  );
}
