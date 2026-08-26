"use client";

import { CalendarCheck2, CalendarClock, Clock3, Hourglass, type LucideIcon } from "lucide-react";
import type { Cita } from "./types";
import { esHoy, formatearDuracion, minutosEntre } from "./format";

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: LucideIcon }) {
  return (
    <div className="rounded-2xl border border-edge bg-card p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-mist">{label}</p>
        <div className="flex size-9 items-center justify-center rounded-full bg-lime-soft text-lime-text">
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      <p className="mt-1 text-xs text-mist">{hint}</p>
    </div>
  );
}

export function StatsCards({ citas }: { citas: Cita[] }) {
  const hoy = new Date();
  const ayer = new Date(hoy);
  ayer.setDate(ayer.getDate() - 1);

  const activas = (c: Cita) => c.estado !== "cancelada" && c.estado !== "rechazada";

  const citasHoy = citas.filter((c) => esHoy(c.inicio, hoy) && activas(c));
  const citasAyer = citas.filter((c) => esHoy(c.inicio, ayer) && activas(c));
  const delta = citasHoy.length - citasAyer.length;

  const confirmadas = citas.filter((c) => c.estado === "confirmada");

  const minutosOcupadosHoy = citasHoy
    .filter((c) => c.estado === "confirmada")
    .reduce((acc, c) => acc + minutosEntre(c.inicio, c.fin), 0);

  const pendientes = citas.filter((c) => c.estado === "pendiente");

  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4 lg:gap-4">
      <StatCard
        label="Citas hoy"
        value={String(citasHoy.length)}
        hint={delta === 0 ? "Igual que ayer" : `${delta > 0 ? "+" : ""}${delta} vs. ayer`}
        icon={CalendarCheck2}
      />
      <StatCard label="Citas confirmadas" value={String(confirmadas.length)} hint="En tu agenda" icon={CalendarClock} />
      <StatCard label="Horas ocupadas" value={formatearDuracion(minutosOcupadosHoy)} hint="Hoy" icon={Clock3} />
      <StatCard label="Por confirmar" value={String(pendientes.length)} hint="Necesitan tu respuesta" icon={Hourglass} />
    </div>
  );
}
