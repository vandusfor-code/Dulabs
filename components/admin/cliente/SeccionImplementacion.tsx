"use client";

import { useState } from "react";
import { Pill } from "@/components/dashboard/shell/ui";
import { labelEstadoImplementacion, toneEstadoImplementacion, labelEstadoOnboarding } from "@/lib/admin-ui";
import { Seccion, Bloque, Boton, fechaLarga } from "./AdminClienteUI";

// F15.2 (Operations Center, cierre) -- portado de
// app/dashboard/admin/clientes/[idTenant]/page.tsx (admin legacy, eliminado
// esta fase). Esta sección es la ÚNICA forma de mover el pipeline de
// onboarding (PENDIENTE -> EN_CONFIGURACION -> EN_PRUEBAS -> ACTIVO, o
// REQUIERE_ATENCION desde cualquier punto) que alimenta los grupos de
// "necesita tu atención" del resumen de /admin (ver
// app/api/dashboard/admin/resumen/route.ts) -- sin esto, ese estado nunca
// podía cambiar desde ningún lado del Panel de Operaciones nuevo.

export type ImplementacionDetalle = {
  estado: string;
  iniciadaAt: string | null;
  activadaAt: string | null;
  actualizadoAt: string;
} | null;

export type OnboardingResumen = { estado: string } | null;

const ESTADOS_IMPLEMENTACION = ["PENDIENTE", "EN_CONFIGURACION", "EN_PRUEBAS", "ACTIVO", "REQUIERE_ATENCION"];

const SIGUIENTE_ACCION: Partial<Record<string, { label: string; siguienteEstado: string }>> = {
  PENDIENTE: { label: "Iniciar configuración", siguienteEstado: "EN_CONFIGURACION" },
  EN_CONFIGURACION: { label: "Pasar a pruebas", siguienteEstado: "EN_PRUEBAS" },
  EN_PRUEBAS: { label: "Marcar como activo", siguienteEstado: "ACTIVO" },
};

export function SeccionImplementacion({
  idTenant,
  accessToken,
  implementacion,
  onboarding,
  onCambio,
}: {
  idTenant: string;
  accessToken: string;
  implementacion: ImplementacionDetalle;
  onboarding: OnboardingResumen;
  onCambio: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cambiarEstado(nuevoEstado: string) {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ estado_implementacion: nuevoEstado }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cambiar el estado");
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Seccion titulo="Implementación">
      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
      {implementacion && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {SIGUIENTE_ACCION[implementacion.estado] && (
            <Boton onClick={() => cambiarEstado(SIGUIENTE_ACCION[implementacion.estado]!.siguienteEstado)} disabled={guardando}>
              {SIGUIENTE_ACCION[implementacion.estado]!.label}
            </Boton>
          )}
          {implementacion.estado !== "REQUIERE_ATENCION" && (
            <Boton variante="peligro" onClick={() => cambiarEstado("REQUIERE_ATENCION")} disabled={guardando}>
              Marcar requiere atención
            </Boton>
          )}
        </div>
      )}

      <div className="mb-4">
        <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">O elige el estado directamente</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ESTADOS_IMPLEMENTACION.map((e) => (
            <button key={e} disabled={guardando || !implementacion || implementacion.estado === e} onClick={() => cambiarEstado(e)} className="disabled:cursor-not-allowed">
              <Pill
                tone={toneEstadoImplementacion(e)}
                className={!implementacion ? "opacity-40" : implementacion.estado === e ? "ring-1 ring-lime/60" : "opacity-60 hover:opacity-100"}
              >
                {labelEstadoImplementacion(e)}
              </Pill>
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Bloque label="Fecha de inicio" texto={fechaLarga(implementacion?.iniciadaAt ?? null)} />
        <Bloque label="Fecha de activación" texto={fechaLarga(implementacion?.activadaAt ?? null)} />
        <Bloque label="Última actualización" texto={fechaLarga(implementacion?.actualizadoAt ?? null)} />
      </div>
      {!implementacion && (
        <p className="mt-3 text-xs text-mist">
          Este cliente todavía no tiene sesión de onboarding (no se le pudo enviar la bienvenida — revisa si tiene WhatsApp guardado).
        </p>
      )}
      {onboarding && (
        <div className="mt-4 border-t border-edge pt-4">
          <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Estado de onboarding</p>
          <div className="mt-1.5">
            <Pill tone="info">{labelEstadoOnboarding(onboarding.estado)}</Pill>
          </div>
        </div>
      )}
    </Seccion>
  );
}
