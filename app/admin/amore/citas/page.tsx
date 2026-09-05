"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Check, X, CalendarX2 } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { ColaboradoraDesktopCitas } from "@/components/admin-web/colaboradora/ColaboradoraDesktopCitas";
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
type Filtro = "todas" | EstadoCita;

// Panel web AMORE (autorizado) — Citas desktop: MISMOS datos y acciones
// reales que el móvil (confirmar/completar/no_show/cancelar/rechazar/
// editar-reasignar), en tabla en vez de tarjetas. El servidor
// (citas/[id]/route.ts) ya valida rol/elegibilidad -- esto es solo la
// piel visual desktop.
export default function AdminAmoreCitasPage() {
  const { datos } = useAdminWeb();
  if (datos.sesion?.rol === "colaboradora") return <ColaboradoraDesktopCitas />;
  return <AdminCitasContenido />;
}

function AdminCitasContenido() {
  const { datos, procesandoId, confirmar, completar, marcarNoShow, rechazarDirecto, cancelarDirecto, abrirEditar, abrirNueva } =
    useAdminWeb();
  const [dia, setDia] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [cancelando, setCancelando] = useState<Cita | null>(null);

  const delDia = useMemo(
    () =>
      datos.citas
        .filter((c) => mismoDia(c.inicio, new Date(`${dia}T12:00:00`)) && c.estado !== "rechazada")
        .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [datos.citas, dia]
  );
  const visibles = filtro === "todas" ? delDia : delDia.filter((c) => c.estado === filtro);

  const conteos: Record<Filtro, number> = {
    todas: delDia.length,
    confirmada: delDia.filter((c) => c.estado === "confirmada").length,
    pendiente: delDia.filter((c) => c.estado === "pendiente" || c.estado === "propuesta").length,
    propuesta: 0,
    cancelada: delDia.filter((c) => c.estado === "cancelada").length,
    completada: delDia.filter((c) => c.estado === "completada").length,
    no_show: delDia.filter((c) => c.estado === "no_show").length,
    rechazada: 0,
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Citas</h1>
          <p className="text-sm text-mist">Gestiona todas las citas del salón</p>
        </div>
        <button
          type="button"
          onClick={() => abrirNueva(new Date(`${dia}T12:00:00`))}
          className="flex items-center gap-1.5 rounded-xl bg-lime px-4 py-2.5 text-sm font-medium text-lime-fg hover:bg-lime-hover"
        >
          <Plus className="size-4" /> Nueva cita
        </button>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-edge bg-card p-3">
        <input
          type="date"
          value={dia}
          onChange={(e) => setDia(e.target.value)}
          className="rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none"
        />
        <div className="flex gap-1.5">
          {(["todas", "pendiente", "confirmada", "completada", "cancelada", "no_show"] as Filtro[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                filtro === f ? "bg-lime text-lime-fg" : "bg-ink-2 text-mist"
              }`}
            >
              {f === "todas" ? "Todas" : ESTADO_LABEL[f]} ({conteos[f]})
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-edge bg-card shadow-sm">
        {visibles.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <CalendarX2 className="size-6 text-mist" />
            <p className="mt-2 text-sm text-mist">No hay citas para este filtro.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-mist">
                <th className="px-5 py-3 font-medium">Hora</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Servicio</th>
                <th className="px-5 py-3 font-medium">Profesional</th>
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
                  <td className="px-5 py-3 text-fg">{c.profesional}</td>
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
                          <button
                            type="button"
                            disabled={procesandoId === c.id}
                            onClick={() => abrirEditar(c)}
                            title="Editar / reasignar"
                            className="flex size-8 items-center justify-center rounded-lg bg-ink-2 text-mist disabled:opacity-50"
                          >
                            <Pencil className="size-4" />
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
        <ModalCancelar
          cita={cancelando}
          procesando={procesandoId === cancelando.id}
          onClose={() => setCancelando(null)}
          onConfirmar={async () => {
            const esRechazo = cancelando.estado === "pendiente";
            await (esRechazo ? rechazarDirecto(cancelando) : cancelarDirecto(cancelando));
            setCancelando(null);
          }}
        />
      )}
    </div>
  );
}

function ModalCancelar({
  cita,
  procesando,
  onClose,
  onConfirmar,
}: {
  cita: Cita;
  procesando: boolean;
  onClose: () => void;
  onConfirmar: () => void;
}) {
  const esRechazo = cita.estado === "pendiente";
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-edge bg-card p-5 shadow-lg">
        <p className="text-sm font-medium text-fg">{esRechazo ? "¿Rechazar esta solicitud?" : "¿Cancelar esta cita?"}</p>
        <p className="mt-1 text-xs text-mist">
          {cita.nombre_cliente} · {cita.servicio} · {formatearHora(cita.inicio)}
        </p>
        <div className="mt-4 flex gap-2.5">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-ink-2 py-2.5 text-sm font-medium text-fg">
            Volver
          </button>
          <button
            type="button"
            disabled={procesando}
            onClick={onConfirmar}
            className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-medium text-danger-text disabled:opacity-50"
          >
            {esRechazo ? "Rechazar" : "Cancelar"}
          </button>
        </div>
      </div>
    </div>
  );
}
