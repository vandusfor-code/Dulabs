"use client";

import { cn } from "./ui";
import { mismoDia } from "./format";

export function DateStrip({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
  const inicioSemana = new Date(selected);
  const diaSemana = (inicioSemana.getDay() + 6) % 7; // lunes = 0
  inicioSemana.setDate(inicioSemana.getDate() - diaSemana);

  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(inicioSemana);
    d.setDate(d.getDate() + i);
    return d;
  });

  const hoy = new Date();

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {dias.map((d) => {
        const activo = mismoDia(d.toISOString(), selected);
        const esHoyDia = mismoDia(d.toISOString(), hoy);
        return (
          <button
            key={d.toISOString()}
            onClick={() => onSelect(d)}
            className={cn(
              "flex min-w-14 flex-col items-center gap-0.5 rounded-xl border px-3 py-2 transition-colors",
              activo ? "border-lime/40 bg-lime-soft" : "border-edge bg-card hover:bg-ink-2"
            )}
          >
            <span className={cn("text-[10.5px] font-medium uppercase tracking-wide", activo ? "text-lime-text" : "text-mist")}>
              {d.toLocaleDateString("es-CO", { weekday: "short" }).replace(".", "")}
            </span>
            <span className={cn("text-sm font-semibold", activo ? "text-lime-text" : "text-fg")}>{d.getDate()}</span>
            {esHoyDia && <span className={cn("size-1 rounded-full", activo ? "bg-lime-text" : "bg-lime")} />}
          </button>
        );
      })}
    </div>
  );
}
