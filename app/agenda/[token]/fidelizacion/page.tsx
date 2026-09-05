"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Check, X, Loader2, Heart } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreBadge, AmoreDivider, AmoreEmptyState } from "@/components/spa-panel/amore/ui";
import { useAmoreUi } from "@/components/spa-panel/amore/AmoreUiContext";

type ReglaVista = { id: number; servicio: string; dias: number; activa: boolean; pendientes: number };
type OportunidadVista = {
  id: number;
  cliente: string;
  telefono: string | null;
  servicio: string;
  fechaVisita: string;
  diasTranscurridos: number;
  diasRegla: number;
  estado: "pendiente" | "contactado" | "descartado";
};

const ESTADO_TONO = { pendiente: "warning", contactado: "success", descartado: "neutral" } as const;
const ESTADO_LABEL = { pendiente: "Pendiente", contactado: "Contactado", descartado: "Descartado" } as const;

// Fidelización (Fase 7, autorizado) — mismo Design System de AMORE (Fase 5),
// ahora conectado a datos reales: reglas y oportunidades ya no son mock (ver
// app/api/agenda/[token]/fidelizacion/*). Todavía SIN envío de WhatsApp (Fase
// 9) -- "Contactado"/"Descartado" es un estado manual que el negocio marca
// él mismo. Se quitó el botón "Agendar mi cita" de la vista previa del
// mensaje (instrucción explícita de esta fase: sin botones de reserva en el
// mensaje de fidelización); crear/editar reglas desde la UI queda para una
// subfase posterior.
export default function FidelizacionPage() {
  return (
    <AmoreOnlyScreen>
      <FidelizacionContenido />
    </AmoreOnlyScreen>
  );
}

function FidelizacionContenido() {
  const { token } = useAgenda();
  const { avisarProximamente } = useAmoreUi();
  const [reglas, setReglas] = useState<ReglaVista[] | null>(null);
  const [oportunidades, setOportunidades] = useState<OportunidadVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState<number | null>(null);

  const cargarOportunidades = useCallback(() => {
    fetch(`/api/agenda/${token}/fidelizacion/oportunidades`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setOportunidades(body.oportunidades)))
      .catch(() => setError("No se pudieron cargar los clientes para contactar"));
  }, [token]);

  useEffect(() => {
    fetch(`/api/agenda/${token}/fidelizacion/reglas`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setReglas(body.reglas)))
      .catch(() => setError("No se pudieron cargar las reglas"));
    cargarOportunidades();
  }, [token, cargarOportunidades]);

  async function actualizarEstado(id: number, estado: "contactado" | "descartado") {
    setActualizando(id);
    try {
      await fetch(`/api/agenda/${token}/fidelizacion/oportunidades/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      cargarOportunidades();
    } finally {
      setActualizando(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Fidelización" subtitle="Recupera clientas que no vuelven hace tiempo" />

      {error && <p className="text-sm text-danger-text">{error}</p>}

      <div>
        <AmoreSectionTitle
          title="Reglas por servicio"
          action={
            <button type="button" onClick={avisarProximamente} className="flex items-center gap-1 text-sm font-medium text-lime-text">
              <Plus className="size-3.5" /> Nueva regla
            </button>
          }
        />
        {!reglas ? (
          <div className="mt-2.5 flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : reglas.length === 0 ? (
          <div className="mt-2.5">
            <AmoreEmptyState icono={<Heart className="size-6 text-mist" />} mensaje="Todavía no hay reglas de fidelización configuradas." />
          </div>
        ) : (
          <AmoreCard className="mt-2.5 !p-0">
            {reglas.map((r, i) => (
              <div key={r.id}>
                <div className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{r.servicio}</p>
                    <p className="text-xs text-mist">
                      Fidelizar después de {r.dias} días · {r.pendientes} pendiente{r.pendientes === 1 ? "" : "s"}
                    </p>
                  </div>
                  <AmoreBadge tono={r.activa ? "success" : "neutral"}>{r.activa ? "Activa" : "Inactiva"}</AmoreBadge>
                </div>
                {i < reglas.length - 1 && <AmoreDivider />}
              </div>
            ))}
          </AmoreCard>
        )}
      </div>

      <div>
        <AmoreSectionTitle title="Clientes para contactar" />
        {!oportunidades ? (
          <div className="mt-2.5 flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : oportunidades.length === 0 ? (
          <div className="mt-2.5">
            <AmoreEmptyState icono={<Heart className="size-6 text-mist" />} mensaje="Todavía no hay clientes para contactar." />
          </div>
        ) : (
          <div className="mt-2.5 flex flex-col gap-2.5">
            {oportunidades.map((o) => (
              <AmoreCard key={o.id} className="p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-fg">{o.cliente}</p>
                  <AmoreBadge tono={ESTADO_TONO[o.estado]}>{ESTADO_LABEL[o.estado]}</AmoreBadge>
                </div>
                <p className="mt-0.5 text-xs text-mist">
                  {o.servicio} · hace {o.diasTranscurridos} días (regla: {o.diasRegla})
                </p>
                {o.estado === "pendiente" && (
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      disabled={actualizando === o.id}
                      onClick={() => actualizarEstado(o.id, "contactado")}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success py-2 text-xs font-medium text-success-text disabled:opacity-50"
                    >
                      <Check className="size-3.5" /> Contactado
                    </button>
                    <button
                      type="button"
                      disabled={actualizando === o.id}
                      onClick={() => actualizarEstado(o.id, "descartado")}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink-2 py-2 text-xs font-medium text-mist disabled:opacity-50"
                    >
                      <X className="size-3.5" /> Descartar
                    </button>
                  </div>
                )}
              </AmoreCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
