"use client";

import { useCallback, useEffect, useState } from "react";
import { Cake, Loader2 } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import { inicialesDe } from "@/components/spa-panel/format";

type Filtro = "hoy" | "semana" | "mes";
type Cumple = { id: number; nombre: string; esHoy: boolean; diasHasta: number; fecha: string };
type Config = { activo: boolean; mensaje: string; horaEnvio: string };

// Panel web AMORE (autorizado) — Cumpleaños desktop: MISMO endpoint y
// MISMA configuración reales (dulabs_cumpleanos_config, Fase 6A/6B) que ya
// usa el móvil. Sin envío real desde acá (mismo motivo que el móvil: el
// canal QR aún no tiene número dedicado conectado). Admin-only.
export default function AdminAmoreCumpleanosPage() {
  return (
    <AdminOnlyDesktop>
      <CumpleanosContenido />
    </AdminOnlyDesktop>
  );
}

function CumpleanosContenido() {
  const { token } = useAdminWeb();
  const [filtro, setFiltro] = useState<Filtro>("hoy");
  const [cumpleanos, setCumpleanos] = useState<Cumple[] | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    fetch(`/api/agenda/${token}/cumpleanos`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setCumpleanos(body.cumpleanos)))
      .catch(() => setError("No se pudieron cargar los cumpleaños"));
    fetch(`/api/agenda/${token}/cumpleanos/config`)
      .then((r) => r.json())
      .then((body) => setConfig(body.config))
      .catch(() => {});
  }, [token]);

  useEffect(() => cargar(), [cargar]);

  async function actualizarActivo(activo: boolean) {
    setGuardando(true);
    try {
      const res = await fetch(`/api/agenda/${token}/cumpleanos/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo }),
      });
      const body = await res.json();
      if (body.error) setError(body.error);
      else setConfig(body.config);
    } finally {
      setGuardando(false);
    }
  }

  const deHoy = (cumpleanos ?? []).filter((c) => c.esHoy);
  const proximos = (cumpleanos ?? []).filter((c) => !c.esHoy && (filtro === "semana" ? c.diasHasta <= 7 : c.diasHasta <= 31));

  return (
    <div className="grid max-w-4xl grid-cols-3 gap-5">
      <div className="col-span-2 flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-fg">Cumpleaños</h1>
          <p className="text-sm text-mist">Detecta los cumpleaños de tus clientas</p>
        </div>

        {error && <p className="text-sm text-danger-text">{error}</p>}

        <div className="flex gap-1.5">
          {(["hoy", "semana", "mes"] as Filtro[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filtro === f ? "bg-lime text-lime-fg" : "bg-ink-2 text-mist"}`}
            >
              {f === "hoy" ? "Hoy" : f === "semana" ? "Esta semana" : "Este mes"}
            </button>
          ))}
        </div>

        {!cumpleanos ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
              <h2 className="text-base font-semibold text-fg">Hoy</h2>
              {deHoy.length === 0 ? (
                <p className="mt-4 text-center text-sm text-mist">Nadie cumple años hoy.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-2.5">
                  {deHoy.map((c) => (
                    <div key={c.id} className="flex items-center gap-2.5 rounded-xl bg-ink-2 px-3 py-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime-soft text-[11px] font-semibold text-lime-text">
                        {inicialesDe(c.nombre)}
                      </div>
                      <p className="truncate text-sm font-medium text-fg">{c.nombre}</p>
                      <Cake className="ml-auto size-4 shrink-0 text-lime-text" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(filtro === "semana" || filtro === "mes") && (
              <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
                <h2 className="text-base font-semibold text-fg">Próximos</h2>
                {proximos.length === 0 ? (
                  <p className="mt-4 text-center text-sm text-mist">Sin cumpleaños próximos.</p>
                ) : (
                  <div className="mt-3 flex flex-col divide-y divide-edge">
                    {proximos.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2.5 py-2.5">
                        <p className="truncate text-sm font-medium text-fg">{c.nombre}</p>
                        <span className="shrink-0 text-xs text-mist">{c.fecha}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {config && (
        <div className="col-span-1 h-fit rounded-2xl border border-edge bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-fg">Configuración</h2>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-fg">Envío automático</p>
              <p className="text-xs text-mist">Se activa cuando WhatsApp QR esté conectado</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.activo}
              disabled={guardando}
              onClick={() => actualizarActivo(!config.activo)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${config.activo ? "bg-lime" : "bg-ink-2"}`}
            >
              <span className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${config.activo ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium text-mist">Mensaje</p>
            <p className="whitespace-pre-line rounded-xl border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg">
              {config.mensaje || "Sin mensaje configurado"}
            </p>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs font-medium text-mist">Hora de envío</p>
            <span className="rounded-full border border-edge bg-ink px-3 py-1 text-sm font-medium text-fg">{config.horaEnvio}</span>
          </div>
        </div>
      )}
    </div>
  );
}
