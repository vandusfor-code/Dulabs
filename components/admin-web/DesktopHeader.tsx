"use client";

import { useState } from "react";
import { Bell, CalendarDays } from "lucide-react";
import { useAdminWeb } from "./AdminWebContext";
import { formatearFechaLarga } from "@/components/spa-panel/format";
import { GlobalSearch } from "./GlobalSearch";

// Panel web AMORE (autorizado) — header desktop: buscador real +
// notificaciones reales (mismas citas pendientes ya cargadas, sin fetch
// nuevo -- mismo patrón que AmoreHeader.tsx del panel móvil) + fecha real
// del día (nunca hardcodeada).
export function DesktopHeader() {
  const { datos } = useAdminWeb();
  const [abierto, setAbierto] = useState(false);
  const pendientes = datos.citas.filter((c) => c.estado === "pendiente" || c.estado === "propuesta");
  const nombre = datos.sesion?.nombre ?? datos.especialista.nombre;

  return (
    <header className="flex items-center justify-between gap-6 border-b border-edge bg-ink px-8 py-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-fg">¡Bienvenida, {nombre}! 💕</h1>
        <p className="mt-0.5 text-sm text-mist">Aquí tienes el resumen de tu salón hoy.</p>
      </div>

      <div className="flex flex-1 items-center justify-end gap-4">
        <GlobalSearch />

        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-edge bg-card px-4 py-2 text-sm font-medium text-fg">
          <CalendarDays className="size-4 text-lime-text" />
          {formatearFechaLarga(new Date())}
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="Notificaciones"
            onClick={() => setAbierto((v) => !v)}
            className="relative flex size-10 items-center justify-center rounded-full border border-edge bg-card text-fg hover:bg-ink-2"
          >
            <Bell className="size-[18px]" />
            {pendientes.length > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-lime" />}
          </button>

          {abierto && (
            <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-edge bg-card p-3 shadow-lg">
              <p className="text-sm font-semibold text-fg">Notificaciones</p>
              {pendientes.length === 0 ? (
                <p className="mt-2 text-sm text-mist">No tienes nuevas notificaciones.</p>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  {pendientes.slice(0, 6).map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-2 px-2.5 py-2">
                      <p className="truncate text-sm text-fg">
                        {c.nombre_cliente} · {c.servicio}
                      </p>
                      <span className="shrink-0 rounded-full bg-warning px-2 py-0.5 text-[11px] font-medium text-warning-text">
                        Pendiente
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
