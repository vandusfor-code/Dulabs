"use client";

import { Clock } from "lucide-react";
import type { Cita } from "./types";
import { StatusBadge } from "./ui";
import { AppointmentMenu } from "./AppointmentMenu";
import { esHoy, formatearDuracion, formatearFechaCorta, formatearHora, inicialesDe, minutosEntre } from "./format";

export function AppointmentCard({
  cita,
  procesando,
  onConfirmar,
  onRechazar,
  onEditar,
  onReagendar,
  onCancelar,
  onDetalles,
}: {
  cita: Cita;
  procesando: boolean;
  onConfirmar?: () => void;
  onRechazar?: () => void;
  onEditar: () => void;
  onReagendar: () => void;
  onCancelar: () => void;
  onDetalles: () => void;
}) {
  const duracion = minutosEntre(cita.inicio, cita.fin);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
      <div className="flex w-14 shrink-0 flex-col items-center gap-0.5 text-center">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-mist">
          {esHoy(cita.inicio) ? "Hoy" : formatearFechaCorta(cita.inicio).split(" ")[0]}
        </span>
        <span className="flex items-center gap-1 text-xs font-semibold text-fg">
          <Clock className="size-3 text-mist" />
          {formatearHora(cita.inicio)}
        </span>
      </div>

      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime-soft text-[11px] font-semibold text-lime-text">
        {inicialesDe(cita.nombre_cliente)}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{cita.nombre_cliente}</p>
        <p className="truncate text-xs text-mist">
          {cita.servicio} · {formatearDuracion(duracion)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <StatusBadge estado={cita.estado} />
        <AppointmentMenu
          cita={cita}
          procesando={procesando}
          onConfirmar={onConfirmar}
          onRechazar={onRechazar}
          onEditar={onEditar}
          onReagendar={onReagendar}
          onCancelar={onCancelar}
          onDetalles={onDetalles}
        />
      </div>
    </div>
  );
}
