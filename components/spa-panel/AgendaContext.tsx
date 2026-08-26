"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAgendaData } from "./useAgendaData";
import type { Cita, Datos } from "./types";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileNav } from "./MobileNav";
import { NewAppointmentModal } from "./modals/NewAppointmentModal";
import { EditAppointmentModal } from "./modals/EditAppointmentModal";
import { RescheduleModal } from "./modals/RescheduleModal";
import { CancelAppointmentModal } from "./modals/CancelAppointmentModal";
import { AppointmentDetailsModal } from "./modals/AppointmentDetailsModal";

type AgendaCtx = {
  token: string;
  datos: Datos;
  procesandoId: number | null;
  confirmar: (c: Cita) => void;
  rechazar: (c: Cita) => void;
  abrirEditar: (c: Cita) => void;
  abrirReagendar: (c: Cita) => void;
  abrirCancelar: (c: Cita) => void;
  abrirDetalles: (c: Cita) => void;
  abrirNueva: (fecha?: Date) => void;
};

const Ctx = createContext<AgendaCtx | null>(null);

export function useAgenda() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAgenda debe usarse dentro de AgendaProvider");
  return ctx;
}

// Un solo fetch/estado compartido entre el dashboard (/agenda/[token]) y la
// vista "Agenda completa" (/agenda/[token]/completa) -- ambas páginas viven
// bajo este layout y consumen el mismo contexto en vez de repetir el fetch.
export function AgendaProvider({ token, children }: { token: string; children: ReactNode }) {
  const { datos, error, procesandoId, ejecutarAccion, crearCita } = useAgendaData(token);
  const [mostrarNueva, setMostrarNueva] = useState<Date | null | undefined>(undefined);
  const [editando, setEditando] = useState<Cita | null>(null);
  const [reagendando, setReagendando] = useState<Cita | null>(null);
  const [cancelando, setCancelando] = useState<{ cita: Cita; modo: "cancelar" | "rechazar" } | null>(null);
  const [detalle, setDetalle] = useState<Cita | null>(null);

  if (error && !datos) {
    return (
      <div className="spa-scope flex min-h-screen items-center justify-center bg-ink px-6 text-center">
        <p className="text-sm text-mist">{error}</p>
      </div>
    );
  }
  if (!datos) {
    return (
      <div className="spa-scope flex min-h-screen items-center justify-center bg-ink">
        <Loader2 className="size-6 animate-spin text-mist" />
      </div>
    );
  }

  const value: AgendaCtx = {
    token,
    datos,
    procesandoId,
    confirmar: (c) => ejecutarAccion(c.id, { accion: "confirmar" }),
    rechazar: (c) => setCancelando({ cita: c, modo: "rechazar" }),
    abrirEditar: setEditando,
    abrirReagendar: setReagendando,
    abrirCancelar: (c) => setCancelando({ cita: c, modo: "cancelar" }),
    abrirDetalles: setDetalle,
    abrirNueva: (fecha) => setMostrarNueva(fecha ?? null),
  };

  return (
    <Ctx.Provider value={value}>
      <div className="spa-scope min-h-screen bg-ink">
        <div className="lg:flex">
          <aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:border-r lg:border-edge">
            <div className="lg:sticky lg:top-0 lg:h-screen">
              <Sidebar token={token} negocio={datos.negocio} />
            </div>
          </aside>
          <div className="min-w-0 flex-1">
            <Header
              nombre={datos.especialista.nombre}
              servicio={datos.especialista.servicio}
              onNuevaCita={() => setMostrarNueva(null)}
            />
            <main className="px-4 pb-24 pt-5 lg:px-8 lg:pb-10 lg:pt-6">{children}</main>
          </div>
        </div>

        <MobileNav token={token} onNuevaCita={() => setMostrarNueva(null)} />

        {mostrarNueva !== undefined && (
          <NewAppointmentModal
            duracionDefecto={datos.especialista.duracion_min}
            servicioDefecto={datos.especialista.servicio}
            fechaInicial={mostrarNueva ?? undefined}
            onClose={() => setMostrarNueva(undefined)}
            onCrear={crearCita}
          />
        )}

        {editando && (
          <EditAppointmentModal
            cita={editando}
            onClose={() => setEditando(null)}
            onGuardar={(body) =>
              ejecutarAccion(editando.id, {
                accion: "editar",
                nuevo_inicio: body.nuevo_inicio,
                servicio: body.servicio,
                duracion_min: body.duracion_min,
              })
            }
          />
        )}

        {reagendando && (
          <RescheduleModal
            cita={reagendando}
            duracionDefecto={datos.especialista.duracion_min}
            onClose={() => setReagendando(null)}
            onProponer={(body) =>
              ejecutarAccion(reagendando.id, {
                accion: "reagendar",
                nuevo_inicio: body.nuevo_inicio,
                duracion_min: body.duracion_min,
              })
            }
          />
        )}

        {cancelando && (
          <CancelAppointmentModal
            cita={cancelando.cita}
            modo={cancelando.modo}
            onClose={() => setCancelando(null)}
            onConfirmar={() =>
              ejecutarAccion(cancelando.cita.id, { accion: cancelando.modo === "cancelar" ? "cancelar" : "rechazar" })
            }
          />
        )}

        {detalle && (
          <AppointmentDetailsModal cita={detalle} especialista={datos.especialista.nombre} onClose={() => setDetalle(null)} />
        )}
      </div>
    </Ctx.Provider>
  );
}
