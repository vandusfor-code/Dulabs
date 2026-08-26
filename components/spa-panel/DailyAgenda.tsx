"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, CalendarX2 } from "lucide-react";
import type { Cita } from "./types";
import { formatearFechaLarga, formatearHora, mismoDia } from "./format";
import { useAgenda } from "./AgendaContext";
import { AppointmentMenu } from "./AppointmentMenu";

export function DailyAgenda({ citas }: { citas: Cita[] }) {
  const { procesandoId, confirmar, rechazar, abrirEditar, abrirReagendar, abrirCancelar, abrirDetalles } = useAgenda();
  const [dia, setDia] = useState(() => new Date());

  const delDia = citas
    .filter((c) => mismoDia(c.inicio, dia) && c.estado !== "cancelada" && c.estado !== "rechazada")
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());

  const mover = (delta: number) => {
    const d = new Date(dia);
    d.setDate(d.getDate() + delta);
    setDia(d);
  };

  return (
    <section className="rounded-2xl border border-edge bg-card p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Agenda del día</h2>
          <p className="mt-0.5 text-xs text-mist">{formatearFechaLarga(dia)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => mover(-1)}
            aria-label="Día anterior"
            className="flex size-8 items-center justify-center rounded-full border border-edge text-mist transition-colors hover:text-fg"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => setDia(new Date())}
            className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-ink-2"
          >
            Hoy
          </button>
          <button
            onClick={() => mover(1)}
            aria-label="Día siguiente"
            className="flex size-8 items-center justify-center rounded-full border border-edge text-mist transition-colors hover:text-fg"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-5">
        {delDia.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <CalendarX2 className="size-6 text-mist" />
            <p className="mt-2 text-sm text-mist">No hay citas este día.</p>
          </div>
        ) : (
          <ol className="relative ml-1.5 flex flex-col gap-5 border-l border-edge pl-5">
            {delDia.map((c) => (
              <li key={c.id} className="relative">
                <span className="absolute -left-[26px] top-1 size-2.5 rounded-full border-2 border-card bg-lime" />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-lime-text">
                      {formatearHora(c.inicio)} – {formatearHora(c.fin)}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-fg">{c.nombre_cliente}</p>
                    <p className="text-xs text-mist">{c.servicio}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {c.estado === "pendiente" && (
                      <button
                        onClick={() => confirmar(c)}
                        disabled={procesandoId === c.id}
                        className="rounded-full bg-lime px-3 py-1 text-[11px] font-semibold text-lime-fg disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                    )}
                    <AgendaMenuButton
                      cita={c}
                      procesando={procesandoId === c.id}
                      onConfirmar={c.estado === "pendiente" ? () => confirmar(c) : undefined}
                      onRechazar={c.estado === "pendiente" ? () => rechazar(c) : undefined}
                      onEditar={() => abrirEditar(c)}
                      onReagendar={() => abrirReagendar(c)}
                      onCancelar={() => abrirCancelar(c)}
                      onDetalles={() => abrirDetalles(c)}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// Reutiliza el mismo menú "⋯" que las tarjetas horizontales, solo que aquí
// va al lado del bloque de la línea de tiempo en vez de dentro de una card.
function AgendaMenuButton(props: React.ComponentProps<typeof AppointmentMenu>) {
  return <AppointmentMenu {...props} />;
}
