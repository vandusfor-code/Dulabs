"use client";

import { useMemo, useState } from "react";
import { CalendarX2, Check, X, Loader2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { DateStrip } from "@/components/spa-panel/DateStrip";
import { formatearHora, mismoDia } from "@/components/spa-panel/format";
import type { Cita, EstadoCita } from "@/components/spa-panel/types";
import { AmoreScreenTitle, AmoreCard, AmoreBadge, AmoreAvatar, AmoreEmptyState, AmoreSecondaryButton } from "../ui";

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

// Login AMORE (autorizado) — "Mis citas" de la colaboradora: MISMAS
// acciones reales que ya usa la administradora (completar/no_show/cancelar,
// ver AmoreCitasScreen.tsx) pero SIN reasignar, sin editar servicio/horario
// y sin crear cita nueva (spec Fase 13) -- ningún botón de esas acciones
// existe acá, no solo ocultas por CSS. La API server-side (citas/[id])
// también rechaza 'editar'/'reagendar' para este rol aunque alguien
// forzara la llamada, así que esto es UX, no la protección real.
export function ColaboradoraCitas() {
  const { datos, procesandoId, confirmar, completar, marcarNoShow } = useAgenda();
  const [dia, setDia] = useState(() => new Date());
  const [cancelando, setCancelando] = useState<Cita | null>(null);

  const visibles = useMemo(
    () =>
      datos.citas
        .filter((c) => mismoDia(c.inicio, dia) && c.estado !== "rechazada")
        .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [datos.citas, dia]
  );

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Mis citas" subtitle="Tu agenda del día" />
      <DateStrip selected={dia} onSelect={setDia} />

      {visibles.length === 0 ? (
        <AmoreEmptyState icono={<CalendarX2 className="size-6 text-mist" />} mensaje="No tienes citas para este día." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibles.map((c) => (
            <AmoreCard key={c.id} className="p-3.5">
              <div className="flex items-center gap-3">
                <span className="w-[62px] shrink-0 text-xs font-semibold text-fg">{formatearHora(c.inicio)}</span>
                <AmoreAvatar nombre={c.nombre_cliente} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{c.nombre_cliente}</p>
                  <p className="truncate text-xs text-mist">{c.servicio}</p>
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
      )}

      {cancelando && <CancelarInline cita={cancelando} onClose={() => setCancelando(null)} />}
    </div>
  );
}

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
