"use client";

import { useMemo, useState } from "react";
import { Plus, CalendarX2 } from "lucide-react";
import { DateStrip } from "@/components/spa-panel/DateStrip";
import { AmoreScreenTitle, AmoreCard, AmoreSegmentedTabs, AmoreBadge, AmoreAvatar, AmoreEmptyState } from "./ui";
import { useAmoreUi } from "./AmoreUiContext";
import { appointmentsMock, type EstadoCitaAgenda } from "./amore-citas-mock";

type Vista = "dia" | "semana";

const ESTADO_TONO: Record<EstadoCitaAgenda, "success" | "warning" | "neutral"> = {
  confirmada: "success",
  pendiente: "warning",
  completada: "success",
  cancelada: "neutral",
};

const ESTADO_LABEL: Record<EstadoCitaAgenda, string> = {
  confirmada: "Confirmada",
  pendiente: "Pendiente",
  completada: "Completada",
  cancelada: "Cancelada",
};

// AMORE (Fase 5, diseño visual completo, autorizado) — SOLO diseño visual de
// la agenda. Datos mock (ver amore-citas-mock.ts); reagendar/confirmar/
// cancelar de verdad es lógica funcional, fuera de esta fase.
export function AmoreCitasScreen() {
  const { avisarProximamente } = useAmoreUi();
  const [dia, setDia] = useState(() => new Date());
  const [vista, setVista] = useState<Vista>("dia");

  const diaISO = dia.toISOString().slice(0, 10);
  const fechasMock = useMemo(() => Array.from(new Set(appointmentsMock.map((c) => c.fechaISO))).sort(), []);

  const visibles = useMemo(() => {
    if (vista === "dia") return appointmentsMock.filter((c) => c.fechaISO === diaISO);
    return appointmentsMock;
  }, [vista, diaISO]);

  const porFecha = useMemo(() => {
    const mapa = new Map<string, typeof appointmentsMock>();
    for (const c of visibles) mapa.set(c.fechaISO, [...(mapa.get(c.fechaISO) ?? []), c]);
    return mapa;
  }, [visibles]);

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle
        title="Citas"
        subtitle="Tu agenda del día"
        action={
          <button
            type="button"
            onClick={avisarProximamente}
            aria-label="Nueva cita"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime text-white"
          >
            <Plus className="size-4" />
          </button>
        }
      />

      <DateStrip selected={dia} onSelect={setDia} />

      <AmoreSegmentedTabs
        opciones={[
          { valor: "dia", etiqueta: "Día" },
          { valor: "semana", etiqueta: "Semana" },
        ]}
        activo={vista}
        onChange={setVista}
      />

      {visibles.length === 0 ? (
        <AmoreEmptyState icono={<CalendarX2 className="size-6 text-mist" />} mensaje="No hay citas para este día." />
      ) : (
        Array.from(porFecha.entries()).map(([fecha, citas]) => (
          <div key={fecha} className="flex flex-col gap-2.5">
            {vista === "semana" && (
              <p className="text-xs font-semibold uppercase tracking-wide text-mist">
                {fechasMock.indexOf(fecha) === 0 ? "Hoy" : new Date(fecha).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
              </p>
            )}
            {citas.map((c) => (
              <AmoreCard key={c.id} className="flex items-center gap-3 p-3.5">
                <span className="w-[62px] shrink-0 text-xs font-semibold text-fg">{c.hora}</span>
                <AmoreAvatar nombre={c.nombreCliente} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{c.nombreCliente}</p>
                  <p className="truncate text-xs text-mist">
                    {c.servicio} · {c.profesional}
                  </p>
                </div>
                <AmoreBadge tono={ESTADO_TONO[c.estado]}>{ESTADO_LABEL[c.estado]}</AmoreBadge>
              </AmoreCard>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
