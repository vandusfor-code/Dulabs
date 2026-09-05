"use client";

import { useMemo, useState } from "react";
import { Check, X, CalendarX2 } from "lucide-react";
import { useAdminWeb } from "../AdminWebContext";
import { formatearHora, mismoDia } from "@/components/spa-panel/format";
import type { Cita, EstadoCita } from "@/components/spa-panel/types";

const ESTADO_TONO: Record<EstadoCita, string> = {
  confirmada: "bg-success text-success-text",
  pendiente: "bg-warning text-warning-text",
  propuesta: "bg-warning text-warning-text",
  completada: "bg-success text-success-text",
  cancelada: "bg-ink-2 text-mist",
  rechazada: "bg-ink-2 text-mist",
  no_show: "bg-danger text-danger-text",
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

// Panel web AMORE (autorizado) — "Mis citas" desktop de la colaboradora:
// mismas acciones reales que la versión móvil (confirmar/completar/
// no_show/cancelar), SIN reasignar/editar servicio-horario ni crear cita
// (spec Fase 24). `datos.citas` ya viene scopeada a su propia
// especialista_id -- ningún fetch/filtro adicional.
export function ColaboradoraDesktopCitas() {
  const { datos, procesandoId, confirmar, completar, marcarNoShow, rechazarDirecto, cancelarDirecto } = useAdminWeb();
  const [dia, setDia] = useState(() => new Date().toISOString().slice(0, 10));
  const [cancelando, setCancelando] = useState<Cita | null>(null);

  const visibles = useMemo(
    () =>
      datos.citas
        .filter((c) => mismoDia(c.inicio, new Date(`${dia}T12:00:00`)) && c.estado !== "rechazada")
        .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [datos.citas, dia]
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Mis citas</h1>
          <p className="text-sm text-mist">Tu agenda del día</p>
        </div>
        <input
          type="date"
          value={dia}
          onChange={(e) => setDia(e.target.value)}
          className="rounded-lg border border-edge bg-card px-3 py-2 text-sm text-fg outline-none"
        />
      </div>

      <div className="rounded-2xl border border-edge bg-card shadow-sm">
        {visibles.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <CalendarX2 className="size-6 text-mist" />
            <p className="mt-2 text-sm text-mist">No tienes citas para este día.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-mist">
                <th className="px-5 py-3 font-medium">Hora</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Servicio</th>
                <th className="px-5 py-3 font-medium">Estado</th>
                <th className="px-5 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {visibles.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-3 font-medium text-fg">{formatearHora(c.inicio)}</td>
                  <td className="px-5 py-3 text-fg">{c.nombre_cliente}</td>
                  <td className="px-5 py-3 text-fg">{c.servicio}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${ESTADO_TONO[c.estado]}`}>
                      {ESTADO_LABEL[c.estado]}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-1.5">
                      {c.estado === "pendiente" && (
                        <button
                          type="button"
                          disabled={procesandoId === c.id}
                          onClick={() => confirmar(c)}
                          title="Confirmar"
                          className="flex size-8 items-center justify-center rounded-lg bg-success text-success-text disabled:opacity-50"
                        >
                          <Check className="size-4" />
                        </button>
                      )}
                      {c.estado === "confirmada" && (
                        <>
                          <button
                            type="button"
                            disabled={procesandoId === c.id}
                            onClick={() => completar(c)}
                            title="Completar"
                            className="flex size-8 items-center justify-center rounded-lg bg-success text-success-text disabled:opacity-50"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            type="button"
                            disabled={procesandoId === c.id}
                            onClick={() => marcarNoShow(c)}
                            title="No asistió"
                            className="flex size-8 items-center justify-center rounded-lg bg-warning text-warning-text disabled:opacity-50"
                          >
                            <X className="size-4" />
                          </button>
                        </>
                      )}
                      {(c.estado === "pendiente" || c.estado === "confirmada") && (
                        <button
                          type="button"
                          disabled={procesandoId === c.id}
                          onClick={() => setCancelando(c)}
                          title={c.estado === "pendiente" ? "Rechazar" : "Cancelar"}
                          className="flex size-8 items-center justify-center rounded-lg bg-danger text-danger-text disabled:opacity-50"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {cancelando && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={() => setCancelando(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-edge bg-card p-5 shadow-lg">
            <p className="text-sm font-medium text-fg">
              {cancelando.estado === "pendiente" ? "¿Rechazar esta solicitud?" : "¿Cancelar esta cita?"}
            </p>
            <p className="mt-1 text-xs text-mist">
              {cancelando.nombre_cliente} · {cancelando.servicio} · {formatearHora(cancelando.inicio)}
            </p>
            <div className="mt-4 flex gap-2.5">
              <button type="button" onClick={() => setCancelando(null)} className="flex-1 rounded-xl bg-ink-2 py-2.5 text-sm font-medium text-fg">
                Volver
              </button>
              <button
                type="button"
                disabled={procesandoId === cancelando.id}
                onClick={async () => {
                  const esRechazo = cancelando.estado === "pendiente";
                  await (esRechazo ? rechazarDirecto(cancelando) : cancelarDirecto(cancelando));
                  setCancelando(null);
                }}
                className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-medium text-danger-text disabled:opacity-50"
              >
                {cancelando.estado === "pendiente" ? "Rechazar" : "Cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
