"use client";

import { useMemo, useState } from "react";
import { Plus, CalendarX2, Check, X, Loader2, Pencil } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { DateStrip } from "@/components/spa-panel/DateStrip";
import { formatearHora, mismoDia } from "@/components/spa-panel/format";
import type { Cita, EstadoCita } from "@/components/spa-panel/types";
import { AmoreScreenTitle, AmoreCard, AmoreSegmentedTabs, AmoreBadge, AmoreAvatar, AmoreEmptyState, AmoreSecondaryButton } from "./ui";

type Vista = "dia" | "semana";

const ESTADO_TONO: Record<EstadoCita, "success" | "warning" | "neutral" | "danger"> = {
  confirmada: "success",
  pendiente: "warning",
  propuesta: "warning",
  completada: "success",
  cancelada: "neutral",
  rechazada: "neutral",
  no_show: "danger",
};

const ESTADO_LABEL: Record<EstadoCita, string> = {
  confirmada: "Confirmada",
  pendiente: "Pendiente",
  propuesta: "Propuesta enviada",
  completada: "Completada",
  cancelada: "Cancelada",
  rechazada: "Rechazada",
  no_show: "No asistió",
};

// AMORE (Fase "sistema completo", autorizado) — agenda REAL: mismos datos
// (datos.citas) y mismas acciones (confirmar/completar/marcarNoShow/
// cancelar) que ya usa Daniela vía useAgenda() -- ningún fetch ni lógica de
// citas nueva, solo la piel visual de AMORE sobre el mismo estado
// compartido. "Completar" es el enlace real hacia Contabilidad: una cita
// completada acá es exactamente lo que lib/contabilidad/reporte.ts cuenta
// como ingreso. "Editar" (Login AMORE, autorizado) abre el MISMO
// EditAppointmentModal real de Daniela (montado en AmoreDashboardShell) --
// permite reasignar a otra profesional ELEGIBLE para el servicio, cambiar
// fecha/hora/servicio; el servidor valida elegibilidad real (ver
// citas/[id]/route.ts), nunca confía en el dropdown. Reagendar (proponer
// horario y esperar aceptación de la clienta) queda fuera de este alcance.
export function AmoreCitasScreen() {
  const { datos, procesandoId, confirmar, completar, marcarNoShow, abrirNueva, abrirEditar } = useAgenda();
  const [dia, setDia] = useState(() => new Date());
  const [vista, setVista] = useState<Vista>("dia");
  const [cancelando, setCancelando] = useState<Cita | null>(null);

  const visibles = useMemo(() => {
    const base = vista === "dia" ? datos.citas.filter((c) => mismoDia(c.inicio, dia)) : datos.citas;
    return [...base]
      .filter((c) => c.estado !== "rechazada")
      .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
  }, [datos.citas, dia, vista]);

  const porFecha = useMemo(() => {
    const mapa = new Map<string, Cita[]>();
    for (const c of visibles) {
      const clave = c.inicio.slice(0, 10);
      mapa.set(clave, [...(mapa.get(clave) ?? []), c]);
    }
    return mapa;
  }, [visibles]);

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle
        title="Citas"
        subtitle="Tu agenda real"
        action={
          <button
            type="button"
            onClick={() => abrirNueva(dia)}
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
                {mismoDia(citas[0].inicio, new Date())
                  ? "Hoy"
                  : new Date(fecha).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
              </p>
            )}
            {citas.map((c) => (
              <AmoreCard key={c.id} className="p-3.5">
                <div className="flex items-center gap-3">
                  <span className="w-[62px] shrink-0 text-xs font-semibold text-fg">{formatearHora(c.inicio)}</span>
                  <AmoreAvatar nombre={c.nombre_cliente} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{c.nombre_cliente}</p>
                    <p className="truncate text-xs text-mist">
                      {c.servicio} · {c.profesional}
                    </p>
                  </div>
                  <AmoreBadge tono={ESTADO_TONO[c.estado]}>{ESTADO_LABEL[c.estado]}</AmoreBadge>
                </div>

                {(c.estado === "pendiente" || c.estado === "confirmada") && (
                  <div className="mt-3 flex gap-2">
                    {c.estado === "pendiente" && (
                      <button
                        type="button"
                        disabled={procesandoId === c.id}
                        onClick={() => confirmar(c)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success py-2 text-xs font-medium text-success-text disabled:opacity-50"
                      >
                        {procesandoId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Confirmar
                      </button>
                    )}
                    {c.estado === "confirmada" && (
                      <button
                        type="button"
                        disabled={procesandoId === c.id}
                        onClick={() => completar(c)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success py-2 text-xs font-medium text-success-text disabled:opacity-50"
                      >
                        {procesandoId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Completar
                      </button>
                    )}
                    {c.estado === "confirmada" && (
                      <button
                        type="button"
                        disabled={procesandoId === c.id}
                        onClick={() => marcarNoShow(c)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-warning py-2 text-xs font-medium text-warning-text disabled:opacity-50"
                      >
                        No asistió
                      </button>
                    )}
                    {c.estado === "confirmada" && (
                      <button
                        type="button"
                        disabled={procesandoId === c.id}
                        onClick={() => abrirEditar(c)}
                        aria-label="Editar cita"
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-ink-2 px-3 py-2 text-xs font-medium text-mist disabled:opacity-50"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={procesandoId === c.id}
                      onClick={() => setCancelando(c)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink-2 py-2 text-xs font-medium text-mist disabled:opacity-50"
                    >
                      <X className="size-3.5" />
                      {c.estado === "pendiente" ? "Rechazar" : "Cancelar"}
                    </button>
                  </div>
                )}
              </AmoreCard>
            ))}
          </div>
        ))
      )}

      {cancelando && <CancelarInline cita={cancelando} onClose={() => setCancelando(null)} />}
    </div>
  );
}

// Confirmación mínima de cancelar/rechazar -- misma acción real que ya usa
// Daniela (ejecutarAccion con accion "cancelar"/"rechazar"), sin construir un
// segundo sistema de modales: se llama directamente vía useAgenda() más
// abajo. Se implementa acá (no como CancelAppointmentModal genérico) porque
// ese componente usa clases fuera del kit de AMORE -- este solo usa
// AmoreCard/AmoreSecondaryButton, cero redisño del Design System.
function CancelarInline({ cita, onClose }: { cita: Cita; onClose: () => void }) {
  const { procesandoId, rechazarDirecto, cancelarDirecto } = useAgenda();
  const esRechazo = cita.estado === "pendiente";

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <AmoreCard>
          <p className="text-sm font-medium text-fg">{esRechazo ? "¿Rechazar esta solicitud?" : "¿Cancelar esta cita?"}</p>
          <p className="mt-1 text-xs text-mist">
            {cita.nombre_cliente} · {cita.servicio} · {formatearHora(cita.inicio)}
          </p>
          <div className="mt-3.5 flex gap-2.5">
            <AmoreSecondaryButton onClick={onClose} className="flex-1">
              Volver
            </AmoreSecondaryButton>
            <AmoreSecondaryButton
              disabled={procesandoId === cita.id}
              onClick={() => {
                (esRechazo ? rechazarDirecto(cita) : cancelarDirecto(cita)).then(onClose).catch(() => {});
              }}
              className="flex-1 !bg-danger !text-danger-text"
            >
              {esRechazo ? "Rechazar" : "Cancelar"}
            </AmoreSecondaryButton>
          </div>
        </AmoreCard>
      </div>
    </div>
  );
}
