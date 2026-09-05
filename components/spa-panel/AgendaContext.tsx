"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Loader2, CalendarClock } from "lucide-react";
import { useAgendaData } from "./useAgendaData";
import type { Cita, DatosCargados } from "./types";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileHero } from "./MobileHero";
import { MobileMenuDrawer } from "./MobileMenuDrawer";
import { MobileNav } from "./MobileNav";
import { NewAppointmentModal } from "./modals/NewAppointmentModal";
import { EditAppointmentModal } from "./modals/EditAppointmentModal";
import { RescheduleModal } from "./modals/RescheduleModal";
import { CancelAppointmentModal } from "./modals/CancelAppointmentModal";
import { AppointmentDetailsModal } from "./modals/AppointmentDetailsModal";
import { AmoreDashboardShell } from "./amore/AmoreDashboardShell";

type AgendaCtx = {
  token: string;
  datos: DatosCargados;
  procesandoId: number | null;
  confirmar: (c: Cita) => void;
  rechazar: (c: Cita) => void;
  completar: (c: Cita) => void;
  marcarNoShow: (c: Cita) => void;
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
  const { datos, error, setError, procesandoId, ejecutarAccion, crearCita } = useAgendaData(token);
  const [mostrarNueva, setMostrarNueva] = useState<Date | null | undefined>(undefined);
  const [editando, setEditando] = useState<Cita | null>(null);
  const [reagendando, setReagendando] = useState<Cita | null>(null);
  const [cancelando, setCancelando] = useState<{ cita: Cita; modo: "cancelar" | "rechazar" } | null>(null);
  const [detalle, setDetalle] = useState<Cita | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);

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

  // Plan pausado (cortesía vencida / pago pendiente): el panel llegó a
  // cargar con normalidad (arriba), pero aquí se corta ANTES de construir
  // el contexto -- ni Sidebar, ni citas, ni ningún modal se llegan a
  // montar. No es un error de red (por eso no reusa la pantalla de arriba):
  // es un estado real y esperado del negocio.
  if (datos.planPausado) {
    return (
      <div className="spa-scope flex min-h-screen flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-400">
          <CalendarClock className="size-7" />
        </div>
        <div>
          <p className="text-lg font-semibold text-fg">Plan pausado</p>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-mist">
            El plan de {datos.negocio} está pendiente de pago. Actualiza el pago para volver a ver tu agenda.
          </p>
        </div>
      </div>
    );
  }

  const value: AgendaCtx = {
    token,
    datos,
    procesandoId,
    confirmar: (c) => {
      // Botón directo en la tarjeta, sin modal propio que muestre un error
      // local -- si falla, se guarda en el estado global para no dejar una
      // promesa rechazada sin atrapar.
      ejecutarAccion(c.id, { accion: "confirmar" }).catch((err) =>
        setError(err instanceof Error ? err.message : "No se pudo confirmar la cita")
      );
    },
    rechazar: (c) => setCancelando({ cita: c, modo: "rechazar" }),
    completar: (c) => {
      ejecutarAccion(c.id, { accion: "completar" }).catch((err) =>
        setError(err instanceof Error ? err.message : "No se pudo marcar la cita como completada")
      );
    },
    marcarNoShow: (c) => {
      ejecutarAccion(c.id, { accion: "no_show" }).catch((err) =>
        setError(err instanceof Error ? err.message : "No se pudo marcar la cita como no asistida")
      );
    },
    abrirEditar: setEditando,
    abrirReagendar: setReagendando,
    abrirCancelar: (c) => setCancelando({ cita: c, modo: "cancelar" }),
    abrirDetalles: setDetalle,
    abrirNueva: (fecha) => setMostrarNueva(fecha ?? null),
  };

  // AMORE (Fase 5, panel administrativo móvil, autorizado) — SOLO este
  // tenant recibe el chrome móvil nuevo (mockup propio, ver
  // components/spa-panel/amore/). Mismo token, misma carga de datos, mismo
  // useAgenda() de arriba -- lo único que cambia es qué se renderiza
  // alrededor de `children`. Ningún modal de Daniela (Nueva/Editar/Reagendar/
  // Cancelar cita) se monta en esta rama porque esos módulos de AMORE no
  // existen todavía en esta fase.
  if (datos.negocio === "AMORE") {
    return (
      <Ctx.Provider value={value}>
        <AmoreDashboardShell>{children}</AmoreDashboardShell>
      </Ctx.Provider>
    );
  }

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
            <div className="hidden lg:block">
              <Header
                nombre={datos.especialista.nombre}
                servicio={datos.especialista.servicio}
                onNuevaCita={() => setMostrarNueva(null)}
              />
            </div>
            <MobileHero nombre={datos.especialista.nombre} negocio={datos.negocio} onAbrirMenu={() => setMenuAbierto(true)} />
            <main className="px-4 pb-24 pt-5 lg:px-8 lg:pb-10 lg:pt-6">{children}</main>
          </div>
        </div>

        <MobileNav token={token} onNuevaCita={() => setMostrarNueva(null)} />

        {menuAbierto && (
          <MobileMenuDrawer token={token} negocio={datos.negocio} onClose={() => setMenuAbierto(false)} />
        )}

        {mostrarNueva !== undefined && (
          <NewAppointmentModal
            token={token}
            fechaInicial={mostrarNueva ?? undefined}
            onClose={() => setMostrarNueva(undefined)}
            onCrear={crearCita}
          />
        )}

        {editando && (
          <EditAppointmentModal
            cita={editando}
            equipo={datos.equipo}
            onClose={() => setEditando(null)}
            onGuardar={(body) =>
              ejecutarAccion(editando.id, {
                accion: "editar",
                nuevo_inicio: body.nuevo_inicio,
                servicio: body.servicio,
                duracion_min: body.duracion_min,
                nuevo_especialista_id: body.nuevo_especialista_id,
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
          <AppointmentDetailsModal cita={detalle} especialista={detalle.profesional} onClose={() => setDetalle(null)} />
        )}
      </div>
    </Ctx.Provider>
  );
}
