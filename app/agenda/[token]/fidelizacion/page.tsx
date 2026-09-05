"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Check, X, Loader2, Heart } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import {
  AmoreCard,
  AmoreScreenTitle,
  AmoreSectionTitle,
  AmoreBadge,
  AmoreDivider,
  AmoreEmptyState,
  AmoreSwitch,
  AmoreSecondaryButton,
  AmorePrimaryButton,
} from "@/components/spa-panel/amore/ui";

type ReglaVista = { id: number; servicioId: string; servicio: string; dias: number; activa: boolean; mensaje: string; pendientes: number };
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
type ServicioOpcion = { id: string; nombre: string };

const ESTADO_TONO = { pendiente: "warning", contactado: "success", descartado: "neutral" } as const;
const ESTADO_LABEL = { pendiente: "Pendiente", contactado: "Contactado", descartado: "Descartado" } as const;

const MENSAJE_SUGERIDO =
  "Hola {{nombre}} 💗 Notamos que hace {{dias}} días no vienes por tu {{servicio}}. ¡Nos encantaría verte pronto de nuevo en AMORE!";

// Fidelización (Fase "sistema completo", autorizado) — mismo Design System
// de AMORE, ahora con CRUD real de reglas (POST/PATCH ya existentes en
// app/api/agenda/[token]/fidelizacion/reglas). Todavía SIN envío de
// WhatsApp (Fase 9) -- "Contactado"/"Descartado" sigue siendo un estado
// manual que el negocio marca él mismo.
export default function FidelizacionPage() {
  return (
    <AmoreOnlyScreen>
      <FidelizacionContenido />
    </AmoreOnlyScreen>
  );
}

function FidelizacionContenido() {
  const { token } = useAgenda();
  const [reglas, setReglas] = useState<ReglaVista[] | null>(null);
  const [oportunidades, setOportunidades] = useState<OportunidadVista[] | null>(null);
  const [servicios, setServicios] = useState<ServicioOpcion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState<number | null>(null);
  const [creandoRegla, setCreandoRegla] = useState(false);

  const cargarOportunidades = useCallback(() => {
    fetch(`/api/agenda/${token}/fidelizacion/oportunidades`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setOportunidades(body.oportunidades)))
      .catch(() => setError("No se pudieron cargar los clientes para contactar"));
  }, [token]);

  const cargarReglas = useCallback(() => {
    fetch(`/api/agenda/${token}/fidelizacion/reglas`)
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setReglas(body.reglas)))
      .catch(() => setError("No se pudieron cargar las reglas"));
  }, [token]);

  useEffect(() => {
    cargarReglas();
    cargarOportunidades();
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => setServicios((body.servicios ?? []).filter((s: { activo: boolean }) => s.activo)))
      .catch(() => {});
  }, [token, cargarReglas, cargarOportunidades]);

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

  async function alternarRegla(regla: ReglaVista) {
    setActualizando(regla.id);
    try {
      await fetch(`/api/agenda/${token}/fidelizacion/reglas/${regla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa: !regla.activa }),
      });
      cargarReglas();
    } finally {
      setActualizando(null);
    }
  }

  const serviciosSinRegla = servicios.filter((s) => !reglas?.some((r) => r.servicioId === s.id));

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Fidelización" subtitle="Recupera clientas que no vuelven hace tiempo" />

      {error && <p className="text-sm text-danger-text">{error}</p>}

      <div>
        <AmoreSectionTitle
          title="Reglas por servicio"
          action={
            <button type="button" onClick={() => setCreandoRegla(true)} className="flex items-center gap-1 text-sm font-medium text-lime-text">
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
                  <AmoreSwitch activo={r.activa} onChange={() => alternarRegla(r)} disabled={actualizando === r.id} />
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

      {creandoRegla && (
        <NuevaReglaModal
          token={token}
          servicios={serviciosSinRegla}
          onClose={() => setCreandoRegla(false)}
          onCreada={() => {
            setCreandoRegla(false);
            cargarReglas();
          }}
        />
      )}
    </div>
  );
}

function NuevaReglaModal({
  token,
  servicios,
  onClose,
  onCreada,
}: {
  token: string;
  servicios: ServicioOpcion[];
  onClose: () => void;
  onCreada: () => void;
}) {
  const [servicioId, setServicioId] = useState(servicios[0]?.id ?? "");
  const [dias, setDias] = useState("20");
  const [mensaje, setMensaje] = useState(MENSAJE_SUGERIDO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!servicioId) {
      setError("Selecciona un servicio");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/agenda/${token}/fidelizacion/reglas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ servicioId, dias: Number(dias), mensaje }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo crear la regla");
      onCreada();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error guardando");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <AmoreCard className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-fg">Nueva regla de fidelización</p>

          {servicios.length === 0 ? (
            <p className="text-sm text-mist">Todos tus servicios activos ya tienen una regla configurada.</p>
          ) : (
            <>
              <div>
                <p className="mb-1 text-xs font-medium text-mist">Servicio</p>
                <select
                  value={servicioId}
                  onChange={(e) => setServicioId(e.target.value)}
                  className="w-full rounded-xl border border-edge bg-card px-3 py-2 text-sm text-fg"
                >
                  {servicios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-mist">Días sin volver</p>
                <input
                  type="number"
                  min={1}
                  value={dias}
                  onChange={(e) => setDias(e.target.value)}
                  className="w-full rounded-xl border border-edge bg-card px-3 py-2 text-sm text-fg"
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-mist">Mensaje ({"{{nombre}}"}, {"{{servicio}}"}, {"{{dias}}"})</p>
                <textarea
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-edge bg-card px-3 py-2 text-sm text-fg"
                />
              </div>
            </>
          )}

          {error && <p className="text-xs text-danger-text">{error}</p>}

          <div className="mt-1 flex gap-2.5">
            <AmoreSecondaryButton onClick={onClose} className="flex-1">
              Cancelar
            </AmoreSecondaryButton>
            {servicios.length > 0 && (
              <AmorePrimaryButton disabled={guardando} onClick={guardar} className="flex-1">
                {guardando ? <Loader2 className="size-4 animate-spin" /> : "Crear regla"}
              </AmorePrimaryButton>
            )}
          </div>
        </AmoreCard>
      </div>
    </div>
  );
}
