"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CalendarClock } from "lucide-react";
import { useAgendaData } from "@/components/spa-panel/useAgendaData";
import type { Cita, DatosCargados } from "@/components/spa-panel/types";

/**
 * Panel web AMORE (autorizado) — provider EXCLUSIVO de la experiencia
 * desktop (/admin/amore/*). Reutiliza el MISMO useAgendaData que ya usa el
 * panel móvil (components/spa-panel/useAgendaData.ts) -- cero lógica de
 * negocio duplicada, cero endpoint nuevo para cargar datos. La única
 * diferencia real es CÓMO se obtiene el `token`: el móvil lo lee de la URL
 * (/agenda/[token]), esta versión lo resuelve a partir de la sesión real
 * (/api/agenda-auth/me) para que el usuario nunca necesite conocer ni ver
 * el token en la barra de direcciones.
 */
type AdminWebCtx = {
  token: string;
  datos: DatosCargados;
  procesandoId: number | null;
  error: string | null;
  setError: (e: string | null) => void;
  cargar: () => void;
  ejecutarAccion: ReturnType<typeof useAgendaData>["ejecutarAccion"];
  crearCita: ReturnType<typeof useAgendaData>["crearCita"];
  confirmar: (c: Cita) => void;
  completar: (c: Cita) => void;
  marcarNoShow: (c: Cita) => void;
  rechazarDirecto: (c: Cita, motivo?: string) => Promise<void>;
  cancelarDirecto: (c: Cita, motivo?: string) => Promise<void>;
  editando: Cita | null;
  abrirEditar: (c: Cita) => void;
  cerrarEditar: () => void;
  guardarEdicion: (body: { nuevo_inicio: string; servicio: string; duracion_min: number; nuevo_especialista_id?: number }) => Promise<void>;
  mostrarNueva: Date | null | undefined;
  abrirNueva: (fecha?: Date) => void;
  cerrarNueva: () => void;
};

const Ctx = createContext<AdminWebCtx | null>(null);

export function useAdminWeb() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminWeb debe usarse dentro de AdminWebProvider");
  return ctx;
}

type SesionMe = { token: string; rol: "administrador" | "colaboradora"; nombre: string; username: string };

function PantallaCarga() {
  return (
    <div className="amore-scope flex min-h-screen items-center justify-center bg-ink">
      <Loader2 className="size-6 animate-spin text-mist" />
    </div>
  );
}

export function AdminWebProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<SesionMe | null | undefined>(undefined); // undefined = resolviendo, null = sin sesión

  useEffect(() => {
    fetch("/api/agenda-auth/me")
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!ok) {
          setMe(null);
          return;
        }
        setMe(data);
      })
      .catch(() => setMe(null));
  }, []);

  const token = me?.token ?? "";
  const { datos, error, setError, noAutenticado, procesandoId, cargar, ejecutarAccion, crearCita } = useAgendaData(token);
  const [editando, setEditando] = useState<Cita | null>(null);
  const [mostrarNueva, setMostrarNueva] = useState<Date | null | undefined>(undefined);

  // "?destino=web" (hallazgo real corregido) -- sin esto, volver a iniciar
  // sesión desde acá (sesión sin cookie, o expirada mientras se usaba el
  // panel de escritorio) mandaba siempre al panel móvil, nunca de vuelta a
  // /admin/amore. Ver app/amore/login/page.tsx.
  useEffect(() => {
    if (me === null || noAutenticado) router.replace("/amore/login?destino=web");
  }, [me, noAutenticado, router]);

  if (me === undefined) return <PantallaCarga />;
  if (me === null) return <PantallaCarga />; // redirigiendo
  if (!datos) return <PantallaCarga />;

  if (datos.planPausado) {
    return (
      <div className="amore-scope flex min-h-screen flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-warning text-warning-text">
          <CalendarClock className="size-7" />
        </div>
        <div>
          <p className="text-lg font-semibold text-fg">Plan pausado</p>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-mist">
            El plan de {datos.negocio} está pendiente de pago. Actualiza el pago para volver a ver el panel.
          </p>
        </div>
      </div>
    );
  }

  const value: AdminWebCtx = {
    token,
    datos,
    procesandoId,
    error,
    setError,
    cargar,
    ejecutarAccion,
    crearCita,
    confirmar: (c) => {
      ejecutarAccion(c.id, { accion: "confirmar" }).catch((err) =>
        setError(err instanceof Error ? err.message : "No se pudo confirmar la cita")
      );
    },
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
    rechazarDirecto: (c, motivo) =>
      ejecutarAccion(c.id, { accion: "rechazar", motivo }).catch((err) => {
        setError(err instanceof Error ? err.message : "No se pudo rechazar la solicitud");
        throw err;
      }),
    cancelarDirecto: (c, motivo) =>
      ejecutarAccion(c.id, { accion: "cancelar", motivo }).catch((err) => {
        setError(err instanceof Error ? err.message : "No se pudo cancelar la cita");
        throw err;
      }),
    editando,
    abrirEditar: setEditando,
    cerrarEditar: () => setEditando(null),
    guardarEdicion: async (body) => {
      if (!editando) return;
      await ejecutarAccion(editando.id, { accion: "editar", ...body });
    },
    mostrarNueva,
    abrirNueva: (fecha) => setMostrarNueva(fecha ?? null),
    cerrarNueva: () => setMostrarNueva(undefined),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type { Cita };
