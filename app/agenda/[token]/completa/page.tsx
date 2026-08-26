"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, CalendarX2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AppointmentCard } from "@/components/spa-panel/AppointmentCard";
import { DateStrip } from "@/components/spa-panel/DateStrip";
import { FilterPills, type Filtro } from "@/components/spa-panel/FilterPills";
import { mismoDia } from "@/components/spa-panel/format";

export default function AgendaCompletaPage() {
  const { token, datos, procesandoId, confirmar, rechazar, abrirEditar, abrirReagendar, abrirCancelar, abrirDetalles } =
    useAgenda();
  const [dia, setDia] = useState(() => new Date());
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const delDia = useMemo(
    () =>
      datos.citas
        .filter((c) => mismoDia(c.inicio, dia) && c.estado !== "rechazada")
        .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [datos.citas, dia]
  );

  const conteos = {
    todas: delDia.length,
    confirmada: delDia.filter((c) => c.estado === "confirmada").length,
    pendiente: delDia.filter((c) => c.estado === "pendiente" || c.estado === "propuesta").length,
    cancelada: delDia.filter((c) => c.estado === "cancelada").length,
  };

  const visibles = delDia.filter((c) => {
    if (filtro === "todas") return true;
    if (filtro === "pendiente") return c.estado === "pendiente" || c.estado === "propuesta";
    return c.estado === filtro;
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/agenda/${token}`}
            aria-label="Volver"
            className="flex size-9 items-center justify-center rounded-full border border-edge text-mist transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-fg">Agenda completa</h1>
            <p className="text-xs text-mist">Todas tus citas en un solo lugar</p>
          </div>
        </div>
        <div className="flex size-9 items-center justify-center rounded-full border border-edge text-mist">
          <CalendarDays className="size-4" />
        </div>
      </div>

      <DateStrip selected={dia} onSelect={setDia} />
      <FilterPills activo={filtro} conteos={conteos} onChange={setFiltro} />

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-10 text-center">
          <CalendarX2 className="size-6 text-mist" />
          <p className="mt-2 text-sm text-mist">No hay citas para este filtro.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibles.map((c) => (
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
