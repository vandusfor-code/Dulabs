"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";

type Config = {
  confirmacionActiva: boolean;
  confirmacionMensaje: string;
  recordatorioActivo: boolean;
  recordatorioAnticipacionHoras: number;
  recordatorioMensaje: string;
};

// Panel web AMORE (autorizado) — Recordatorios desktop: MISMA
// configuración real (dulabs_comunicaciones_config, Fase 8) que ya usa el
// móvil. Sin envío real todavía (canal QR pendiente de número dedicado).
// Admin-only.
export default function AdminAmoreRecordatoriosPage() {
  return (
    <AdminOnlyDesktop>
      <Contenido />
    </AdminOnlyDesktop>
  );
}

function Contenido() {
  const { token } = useAdminWeb();
  const [config, setConfig] = useState<Config | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    fetch(`/api/agenda/${token}/comunicaciones/config`)
      .then((r) => r.json())
      .then((body) => setConfig(body.config))
      .catch(() => setError("No se pudo cargar la configuración"));
  }, [token]);

  useEffect(() => cargar(), [cargar]);

  async function guardar(cambios: Partial<Config>) {
    if (!config) return;
    setGuardando(true);
    setError(null);
    setConfig({ ...config, ...cambios });
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
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Recordatorios</h1>
        <p className="text-sm text-mist">Confirmaciones y recordatorios automáticos de citas</p>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!config ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold text-fg">Confirmación de cita</h2>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-fg">Enviar confirmación automática</p>
              <Switch activo={config.confirmacionActiva} disabled={guardando} onChange={(v) => guardar({ confirmacionActiva: v })} />
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-mist">
                Mensaje ({"{{nombre}}"}, {"{{servicio}}"}, {"{{profesional}}"}, {"{{fecha}}"}, {"{{hora}}"})
              </p>
              <EditorMensaje key={config.confirmacionMensaje} valor={config.confirmacionMensaje} onGuardar={(v) => guardar({ confirmacionMensaje: v })} />
            </div>
          </div>

          <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold text-fg">Recordatorio de cita</h2>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-fg">Enviar recordatorio automático</p>
              <Switch activo={config.recordatorioActivo} disabled={guardando} onChange={(v) => guardar({ recordatorioActivo: v })} />
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
              <p className="mb-1.5 text-xs font-medium text-mist">
                Mensaje ({"{{nombre}}"}, {"{{servicio}}"}, {"{{profesional}}"}, {"{{fecha}}"}, {"{{hora}}"})
              </p>
              <EditorMensaje key={config.recordatorioMensaje} valor={config.recordatorioMensaje} onGuardar={(v) => guardar({ recordatorioMensaje: v })} />
            </div>
          </div>

          <p className="text-xs text-mist">
            El envío real se activará cuando el WhatsApp QR de AMORE esté conectado. Por ahora esta configuración queda guardada y lista.
          </p>
        </>
      )}
    </div>
  );
}

function Switch({ activo, disabled, onChange }: { activo: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      disabled={disabled}
      onClick={() => onChange(!activo)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${activo ? "bg-lime" : "bg-ink-2"}`}
    >
      <span className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function EditorMensaje({ valor, onGuardar }: { valor: string; onGuardar: (v: string) => void }) {
  const [texto, setTexto] = useState(valor);
  const cambio = texto !== valor;

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={4}
        className="w-full rounded-xl border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg"
      />
      {cambio && (
        <button
          type="button"
          onClick={() => onGuardar(texto)}
          className="self-start rounded-lg bg-lime px-4 py-2 text-xs font-medium text-lime-fg"
        >
          Guardar mensaje
        </button>
      )}
    </div>
  );
}
