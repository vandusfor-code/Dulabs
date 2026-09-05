"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreSwitch, AmorePrimaryButton } from "@/components/spa-panel/amore/ui";

type Config = {
  confirmacionActiva: boolean;
  confirmacionMensaje: string;
  recordatorioActivo: boolean;
  recordatorioAnticipacionHoras: number;
  recordatorioMensaje: string;
};

// Confirmaciones y recordatorios (Fase "sistema completo", autorizado) —
// primera pantalla real de este módulo (Fase 8 nunca tuvo UI propia).
// Persiste en dulabs_comunicaciones_config, el mismo motor real de Fase 8.
// NO envía ningún mensaje -- el envío real llega con el canal WhatsApp QR.
export default function ComunicacionesConfigPage() {
  return (
    <AmoreOnlyScreen>
      <Contenido />
    </AmoreOnlyScreen>
  );
}

function Contenido() {
  const { token } = useAgenda();
  const [config, setConfig] = useState<Config | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    fetch(`/api/agenda/${token}/comunicaciones/config`)
      .then((r) => r.json())
      .then((body) => setConfig(body.config))
      .catch(() => setError("No se pudo cargar la configuración"));
  }, [token]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(cambios: Partial<Config>) {
    if (!config) return;
    setGuardando(true);
    setError(null);
    const nuevo = { ...config, ...cambios };
    setConfig(nuevo);
    try {
      const res = await fetch(`/api/agenda/${token}/comunicaciones/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const body = await res.json();
      if (body.error) {
        setError(body.error);
        cargar();
      } else {
        setConfig(body.config);
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/agenda/${token}/configuracion`} className="flex items-center gap-1.5 text-xs font-medium text-mist hover:text-fg">
        <ArrowLeft className="size-3.5" /> Volver a configuración
      </Link>
      <AmoreScreenTitle title="Confirmaciones y recordatorios" subtitle="Mensajes automáticos de citas" />

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!config ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : (
        <>
          <AmoreCard>
            <AmoreSectionTitle title="Confirmación de cita" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-fg">Enviar confirmación automática</p>
              <AmoreSwitch
                activo={config.confirmacionActiva}
                disabled={guardando}
                onChange={(v) => guardar({ confirmacionActiva: v })}
              />
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-mist">Mensaje ({"{{nombre}}"}, {"{{servicio}}"}, {"{{profesional}}"}, {"{{fecha}}"}, {"{{hora}}"})</p>
              <EditorMensaje key={config.confirmacionMensaje} valor={config.confirmacionMensaje} onGuardar={(v) => guardar({ confirmacionMensaje: v })} />
            </div>
          </AmoreCard>

          <AmoreCard>
            <AmoreSectionTitle title="Recordatorio de cita" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-fg">Enviar recordatorio automático</p>
              <AmoreSwitch activo={config.recordatorioActivo} disabled={guardando} onChange={(v) => guardar({ recordatorioActivo: v })} />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs font-medium text-mist">Anticipación (horas)</p>
              <input
                type="number"
                min={1}
                defaultValue={config.recordatorioAnticipacionHoras}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isInteger(v) && v > 0) guardar({ recordatorioAnticipacionHoras: v });
                }}
                className="w-20 rounded-full border border-edge bg-ink px-3 py-1.5 text-right text-sm font-medium text-fg"
              />
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-mist">Mensaje ({"{{nombre}}"}, {"{{servicio}}"}, {"{{profesional}}"}, {"{{fecha}}"}, {"{{hora}}"})</p>
              <EditorMensaje key={config.recordatorioMensaje} valor={config.recordatorioMensaje} onGuardar={(v) => guardar({ recordatorioMensaje: v })} />
            </div>
          </AmoreCard>

          <p className="text-xs text-mist">
            El envío real se activará cuando el WhatsApp QR de AMORE esté conectado. Por ahora esta configuración queda
            guardada y lista.
          </p>
        </>
      )}
    </div>
  );
}

// Se remonta con key={valor} desde el padre cada vez que el mensaje
// guardado cambia -- así el estado inicial siempre parte del valor real
// persistido, sin sincronizar props->state dentro de un efecto.
function EditorMensaje({ valor, onGuardar }: { valor: string; onGuardar: (v: string) => void }) {
  const [texto, setTexto] = useState(valor);
  const cambio = texto !== valor;

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={4}
        className="w-full rounded-2xl border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg"
      />
      {cambio && (
        <AmorePrimaryButton onClick={() => onGuardar(texto)} className="self-start !px-4 !py-2 text-xs">
          Guardar mensaje
        </AmorePrimaryButton>
      )}
    </div>
  );
}
