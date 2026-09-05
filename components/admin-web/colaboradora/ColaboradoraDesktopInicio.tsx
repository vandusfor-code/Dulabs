"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { useAdminWeb } from "../AdminWebContext";
import { formatearHora, mismoDia } from "@/components/spa-panel/format";
import { RUTA_CITAS } from "../admin-web-routes";

// Panel web AMORE (autorizado) — "Mi día" desktop para colaboradora: mismo
// alcance que la versión móvil (ColaboradoraInicio.tsx) -- solo su propia
// agenda, sin nada financiero. `datos.citas` ya viene scopeada a su
// especialista_id desde el backend, sin fetch ni filtro adicional.
export function ColaboradoraDesktopInicio() {
  const { datos } = useAdminWeb();
  const router = useRouter();

  const citasHoy = useMemo(
    () =>
      datos.citas
        .filter((c) => mismoDia(c.inicio, new Date()) && c.estado !== "rechazada" && c.estado !== "cancelada")
        .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [datos.citas]
  );
  const proxima = citasHoy.find((c) => c.estado === "confirmada" || c.estado === "pendiente");
  const completadasEsteMes = useMemo(() => {
    const ahora = new Date();
    return datos.citas.filter((c) => {
      if (c.estado !== "completada") return false;
      const d = new Date(c.inicio);
      return d.getUTCFullYear() === ahora.getUTCFullYear() && d.getUTCMonth() === ahora.getUTCMonth();
    }).length;
  }, [datos.citas]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="flex items-center gap-3.5 rounded-2xl border border-edge bg-card p-4 shadow-sm">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-lime-soft text-lime-text">
            <CalendarClock className="size-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-fg">{citasHoy.length}</p>
            <p className="text-sm text-mist">Citas de hoy</p>
          </div>
        </div>
        <div className="flex items-center gap-3.5 rounded-2xl border border-edge bg-card p-4 shadow-sm">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-success text-success-text">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-fg">{completadasEsteMes}</p>
            <p className="text-sm text-mist">Servicios realizados este mes</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">Próxima cita</h2>
          <button type="button" onClick={() => router.push(RUTA_CITAS)} className="text-sm font-medium text-lime-text hover:underline">
            Ver mis citas
          </button>
        </div>
        {proxima ? (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-ink-2 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-fg">
                {formatearHora(proxima.inicio)} · {proxima.nombre_cliente}
              </p>
              <p className="text-xs text-mist">{proxima.servicio}</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                proxima.estado === "confirmada" ? "bg-success text-success-text" : "bg-warning text-warning-text"
              }`}
            >
              {proxima.estado === "confirmada" ? "Confirmada" : "Pendiente"}
            </span>
          </div>
        ) : (
          <p className="mt-6 text-center text-sm text-mist">No tienes más citas hoy.</p>
        )}
      </div>

      <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-fg">Hoy</h2>
        {citasHoy.length === 0 ? (
          <p className="mt-6 text-center text-sm text-mist">No tienes citas hoy.</p>
        ) : (
          <div className="mt-3 flex flex-col divide-y divide-edge">
            {citasHoy.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium text-fg">{formatearHora(c.inicio)}</p>
                  <p className="text-xs text-mist">
                    {c.nombre_cliente} · {c.servicio}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    c.estado === "confirmada" ? "bg-success text-success-text" : "bg-warning text-warning-text"
                  }`}
                >
                  {c.estado === "confirmada" ? "Confirmada" : "Pendiente"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
