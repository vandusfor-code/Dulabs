"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Check, X, Loader2 } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";

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

const ESTADO_TONO = { pendiente: "bg-warning text-warning-text", contactado: "bg-success text-success-text", descartado: "bg-ink-2 text-mist" } as const;
const ESTADO_LABEL = { pendiente: "Pendiente", contactado: "Contactado", descartado: "Descartado" } as const;
const MENSAJE_SUGERIDO =
  "Hola {{nombre}} 💗 Notamos que hace {{dias}} días no vienes por tu {{servicio}}. ¡Nos encantaría verte pronto de nuevo en AMORE!";

// Panel web AMORE (autorizado) — Fidelización desktop: MISMAS APIs reales
// que ya usa el móvil (CRUD de reglas + oportunidades). Sin envío real
// (Fase 9 pendiente de número dedicado) -- mismo alcance. Admin-only.
export default function AdminAmoreFidelizacionPage() {
  return (
    <AdminOnlyDesktop>
      <FidelizacionContenido />
    </AdminOnlyDesktop>
  );
}

function FidelizacionContenido() {
  const { token } = useAdminWeb();
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
    <div className="grid max-w-5xl grid-cols-2 gap-5">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-fg">Fidelización</h1>
          <p className="text-sm text-mist">Recupera clientas que no vuelven hace tiempo</p>
        </div>
        {error && <p className="text-sm text-danger-text">{error}</p>}

        <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">Reglas por servicio</h2>
            <button
              type="button"
              onClick={() => setCreandoRegla(true)}
              className="flex items-center gap-1 text-sm font-medium text-lime-text hover:underline"
            >
              <Plus className="size-3.5" /> Nueva regla
            </button>
          </div>
          {!reglas ? (
            <div className="mt-4 flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-mist" />
            </div>
          ) : reglas.length === 0 ? (
            <p className="mt-6 text-center text-sm text-mist">Todavía no hay reglas de fidelización configuradas.</p>
          ) : (
            <div className="mt-3 flex flex-col divide-y divide-edge">
              {reglas.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{r.servicio}</p>
                    <p className="text-xs text-mist">
                      Después de {r.dias} días · {r.pendientes} pendiente{r.pendientes === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.activa}
                    disabled={actualizando === r.id}
                    onClick={() => alternarRegla(r)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${r.activa ? "bg-lime" : "bg-ink-2"}`}
                  >
                    <span className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${r.activa ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-fg">Clientes para contactar</h2>
        {!oportunidades ? (
          <div className="mt-4 flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : oportunidades.length === 0 ? (
          <p className="mt-6 text-center text-sm text-mist">Todavía no hay clientes para contactar.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2.5">
            {oportunidades.map((o) => (
              <div key={o.id} className="rounded-xl bg-ink-2 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-fg">{o.cliente}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${ESTADO_TONO[o.estado]}`}>
                    {ESTADO_LABEL[o.estado]}
                  </span>
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
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-success py-2 text-xs font-medium text-success-text disabled:opacity-50"
                    >
                      <Check className="size-3.5" /> Contactado
                    </button>
                    <button
                      type="button"
                      disabled={actualizando === o.id}
                      onClick={() => actualizarEstado(o.id, "descartado")}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink py-2 text-xs font-medium text-mist disabled:opacity-50"
                    >
                      <X className="size-3.5" /> Descartar
                    </button>
                  </div>
                )}
              </div>
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
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-edge bg-card p-5 shadow-lg">
        <p className="text-sm font-semibold text-fg">Nueva regla de fidelización</p>

        {servicios.length === 0 ? (
          <p className="mt-3 text-sm text-mist">Todos tus servicios activos ya tienen una regla configurada.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-mist">Servicio</p>
              <select
                value={servicioId}
                onChange={(e) => setServicioId(e.target.value)}
                className="w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm text-fg"
              >
                {servicios.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
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
                className="w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm text-fg"
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-mist">Mensaje ({"{{nombre}}"}, {"{{servicio}}"}, {"{{dias}}"})</p>
              <textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm text-fg"
              />
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-danger-text">{error}</p>}

        <div className="mt-4 flex gap-2.5">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-ink-2 py-2.5 text-sm font-medium text-fg">
            Cancelar
          </button>
          {servicios.length > 0 && (
            <button
              type="button"
              disabled={guardando}
              onClick={guardar}
              className="flex-1 rounded-xl bg-lime py-2.5 text-sm font-medium text-lime-fg disabled:opacity-50"
            >
              {guardando ? <Loader2 className="mx-auto size-4 animate-spin" /> : "Crear regla"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
