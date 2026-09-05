"use client";

import { useCallback, useEffect, useState } from "react";
import { Cake, Loader2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreSegmentedTabs, AmoreAvatar, AmoreEmptyState, AmoreSwitch } from "@/components/spa-panel/amore/ui";

type Filtro = "hoy" | "semana" | "mes";

type Cumple = { id: number; nombre: string; esHoy: boolean; diasHasta: number; fecha: string };
type Config = { activo: boolean; mensaje: string; horaEnvio: string };

// AMORE (Fase "sistema completo", autorizado) — cumpleaños REALES
// (dulabs_clientes_conocidos) y configuración REAL (dulabs_cumpleanos_config,
// el mismo motor de Fase 6A/6B). El switch persiste de verdad. NO se envía
// ningún mensaje desde acá -- el envío real llega cuando el número dedicado
// de AMORE esté conectado por QR; por eso no hay botón de "enviar" por
// clienta (sería un botón sin acción real permitida todavía).
export default function CumpleanosPage() {
  return (
    <AmoreOnlyScreen>
      <CumpleanosContenido />
    </AmoreOnlyScreen>
  );
}

function CumpleanosContenido() {
  const { token } = useAgenda();
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

  useEffect(() => {
    cargar();
  }, [cargar]);

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
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Cumpleaños" subtitle="Detecta los cumpleaños de tus clientas" />

      {error && <p className="text-sm text-danger-text">{error}</p>}

      <AmoreSegmentedTabs
        opciones={[
          { valor: "hoy", etiqueta: "Hoy" },
          { valor: "semana", etiqueta: "Esta semana" },
          { valor: "mes", etiqueta: "Este mes" },
        ]}
        activo={filtro}
        onChange={setFiltro}
      />

      {!cumpleanos ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : (
        <>
          <div>
            <AmoreSectionTitle title="Cumpleaños de hoy" />
            <div className="mt-2.5 flex flex-col gap-2.5">
              {deHoy.length === 0 ? (
                <AmoreEmptyState icono={<Cake className="size-6 text-mist" />} mensaje="Nadie cumple años hoy." />
              ) : (
                deHoy.map((c) => (
                  <AmoreCard key={c.id} className="flex items-center gap-3 p-3.5">
                    <AmoreAvatar nombre={c.nombre} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{c.nombre}</p>
                      <p className="truncate text-xs text-mist">Hoy</p>
                    </div>
                  </AmoreCard>
                ))
              )}
            </div>
          </div>

          {(filtro === "semana" || filtro === "mes") && proximos.length > 0 && (
            <div>
              <AmoreSectionTitle title="Próximos cumpleaños" />
              <div className="mt-2.5 flex flex-col gap-2.5">
                {proximos.map((c) => (
                  <AmoreCard key={c.id} className="flex items-center gap-3 p-3.5">
                    <AmoreAvatar nombre={c.nombre} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{c.nombre}</p>
                      <p className="truncate text-xs text-mist">{c.fecha}</p>
                    </div>
                  </AmoreCard>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {config && (
        <AmoreCard>
          <AmoreSectionTitle title="Configuración de cumpleaños" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-fg">Enviar mensaje automático</p>
              <p className="text-xs text-mist">Se activará el envío real cuando WhatsApp QR esté conectado</p>
            </div>
            <AmoreSwitch activo={config.activo} onChange={actualizarActivo} disabled={guardando} />
          </div>
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium text-mist">Mensaje</p>
            <p className="whitespace-pre-line rounded-2xl border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg">
              {config.mensaje || "Sin mensaje configurado"}
            </p>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs font-medium text-mist">Hora de envío</p>
            <span className="rounded-full border border-edge bg-ink px-3 py-1.5 text-sm font-medium text-fg">{config.horaEnvio}</span>
          </div>
        </AmoreCard>
      )}
    </div>
  );
}
