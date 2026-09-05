"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarX2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AppointmentCard } from "@/components/spa-panel/AppointmentCard";
import { cn } from "@/components/spa-panel/ui";
import { formatearFechaLarga, mismoDia } from "@/components/spa-panel/format";
import type { Cita } from "@/components/spa-panel/types";

// Fase 5 (panel administrativo) — vista de MES, complementaria a "Citas"
// (/agenda/[token]/completa, que ya navega día por día con DateStrip). No es
// un segundo sistema de agenda: consume las MISMAS citas ya cargadas en
// AgendaContext (una sola fuente real, la base de datos vía el bootstrap
// existente), solo las agrupa distinto para ver el mes completo de un vistazo.
const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function inicioDeMes(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function celdasDelMes(mesDeReferencia: Date): Date[] {
  const primero = inicioDeMes(mesDeReferencia);
  const inicioGrid = new Date(primero);
  inicioGrid.setDate(primero.getDate() - primero.getDay());
  const celdas: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicioGrid);
    d.setDate(inicioGrid.getDate() + i);
    celdas.push(d);
  }
  return celdas;
}

export default function CalendarioPage() {
  const {
    procesandoId,
    datos,
    confirmar,
    rechazar,
    completar,
    marcarNoShow,
    abrirEditar,
    abrirReagendar,
    abrirCancelar,
    abrirDetalles,
  } = useAgenda();
  const [mes, setMes] = useState(() => inicioDeMes(new Date()));
  const [seleccionado, setSeleccionado] = useState(() => new Date());

  const celdas = useMemo(() => celdasDelMes(mes), [mes]);

  const citasPorDiaISO = useMemo(() => {
    const mapa = new Map<string, Cita[]>();
    for (const c of datos.citas) {
      if (c.estado === "rechazada" || c.estado === "cancelada") continue;
      const clave = new Date(c.inicio).toDateString();
      const lista = mapa.get(clave) ?? [];
      lista.push(c);
      mapa.set(clave, lista);
    }
    return mapa;
  }, [datos.citas]);

  const citasDelSeleccionado = (citasPorDiaISO.get(seleccionado.toDateString()) ?? []).sort(
    (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-fg">Calendario</h1>
        <p className="text-xs text-mist">Vista de mes de todas tus citas</p>
      </div>

      <div className="rounded-2xl border border-edge bg-card p-3 lg:p-4">
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={() => setMes((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            aria-label="Mes anterior"
            className="flex size-8 items-center justify-center rounded-full text-mist transition-colors hover:bg-ink-2 hover:text-fg"
          >
            <ChevronLeft className="size-4" />
          </button>
          <p className="text-sm font-semibold capitalize text-fg">
            {mes.toLocaleDateString("es-CO", { month: "long", year: "numeric" })}
          </p>
          <button
            onClick={() => setMes((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            aria-label="Mes siguiente"
            className="flex size-8 items-center justify-center rounded-full text-mist transition-colors hover:bg-ink-2 hover:text-fg"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-medium uppercase tracking-wide text-mist">
          {DIAS_SEMANA.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {celdas.map((d) => {
            const enEsteMes = d.getMonth() === mes.getMonth();
            const citasDia = citasPorDiaISO.get(d.toDateString()) ?? [];
            const esSeleccionado = mismoDia(seleccionado.toISOString(), d);
            return (
              <button
                key={d.toISOString()}
                onClick={() => setSeleccionado(d)}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl text-xs transition-colors",
                  !enEsteMes && "text-mist/40",
                  enEsteMes && !esSeleccionado && "text-fg hover:bg-ink-2",
                  esSeleccionado && "bg-lime text-lime-fg font-semibold"
                )}
              >
                <span>{d.getDate()}</span>
                {citasDia.length > 0 && (
                  <span
                    className={cn(
                      "size-1 rounded-full",
                      esSeleccionado ? "bg-lime-fg" : "bg-lime-text"
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2.5 text-sm font-medium text-fg">{formatearFechaLarga(seleccionado)}</p>
        {citasDelSeleccionado.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-8 text-center">
            <CalendarX2 className="size-6 text-mist" />
            <p className="mt-2 text-sm text-mist">No hay citas este día.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {citasDelSeleccionado.map((c) => (
              <AppointmentCard
                key={c.id}
                cita={c}
                procesando={procesandoId === c.id}
                onConfirmar={c.estado === "pendiente" ? () => confirmar(c) : undefined}
                onRechazar={c.estado === "pendiente" ? () => rechazar(c) : undefined}
                onEditar={() => abrirEditar(c)}
                onReagendar={() => abrirReagendar(c)}
                onCancelar={() => abrirCancelar(c)}
                onDetalles={() => abrirDetalles(c)}
                onCompletar={c.estado === "confirmada" ? () => completar(c) : undefined}
                onNoShow={c.estado === "confirmada" ? () => marcarNoShow(c) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
