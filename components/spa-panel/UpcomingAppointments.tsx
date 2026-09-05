"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarSearch } from "lucide-react";
import type { Cita } from "./types";
import { AppointmentCard } from "./AppointmentCard";
import { useAgenda } from "./AgendaContext";

export function UpcomingAppointments({ citas }: { citas: Cita[] }) {
  const { token, procesandoId, confirmar, rechazar, completar, marcarNoShow, abrirEditar, abrirReagendar, abrirCancelar, abrirDetalles } =
    useAgenda();

  // Se fija una sola vez al montar -- no necesita re-evaluarse al segundo,
  // y llamar Date.now() directo en el cuerpo del render viola la regla de
  // pureza de React.
  const [ahora] = useState(() => Date.now());
  const proximas = citas
    .filter((c) => (c.estado === "confirmada" || c.estado === "pendiente") && new Date(c.inicio).getTime() >= ahora)
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime())
    .slice(0, 5);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">Próximas citas</h2>
        <Link
          href={`/agenda/${token}/completa`}
          className="flex items-center gap-1 text-xs font-medium text-lime-text hover:text-lime-hover"
        >
          Ver todas <ArrowRight className="size-3.5" />
        </Link>
      </div>

      {proximas.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-8 text-center">
          <CalendarSearch className="size-6 text-mist" />
          <p className="mt-2 text-sm text-mist">No tienes próximas citas por ahora.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {proximas.map((c) => (
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
    </section>
  );
}
