"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet, TrendingUp, TrendingDown, CalendarCheck, Loader2 } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import { formatearCOP } from "@/components/spa-panel/amore/amore-dashboard-mock";
import type { ReporteContabilidad, TipoPeriodo } from "@/lib/contabilidad/tipos";

type Opcion = { id: string | number; nombre: string };

// Panel web AMORE (autorizado) — Contabilidad desktop: MISMO endpoint real
// (Fase 10) que ya usa el móvil, en layout de tablas. Admin-only. Unifica
// en una sola vista "Desempeño"/"Pagos y Comisiones"/"Reportes" del mockup
// (ver nota en DesktopSidebar.tsx) porque las tres muestran el mismo
// reporte real.
export default function AdminAmoreContabilidadPage() {
  return (
    <AdminOnlyDesktop>
      <ContabilidadContenido />
    </AdminOnlyDesktop>
  );
}

function ContabilidadContenido() {
  const { token } = useAdminWeb();
  const [periodo, setPeriodo] = useState<TipoPeriodo>("mes");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [especialistaId, setEspecialistaId] = useState("");
  const [servicioId, setServicioId] = useState("");
  const [especialistas, setEspecialistas] = useState<Opcion[]>([]);
  const [servicios, setServicios] = useState<Opcion[]>([]);
  const [reporte, setReporte] = useState<ReporteContabilidad | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/agenda/${token}/especialistas`)
      .then((r) => r.json())
      .then((body) => setEspecialistas((body.especialistas ?? []).map((e: { id: number; nombre: string }) => ({ id: e.id, nombre: e.nombre }))))
      .catch(() => {});
    fetch(`/api/agenda/${token}/servicios`)
      .then((r) => r.json())
      .then((body) => setServicios((body.servicios ?? []).map((s: { id: string; nombre: string }) => ({ id: s.id, nombre: s.nombre }))))
      .catch(() => {});
  }, [token]);

  const cargarReporte = useCallback(() => {
    if (periodo === "personalizado" && (!desde || !hasta)) return;
    const params = new URLSearchParams({ periodo });
    if (periodo === "personalizado") {
      params.set("desde", desde);
      params.set("hasta", hasta);
    }
    if (especialistaId) params.set("especialistaId", especialistaId);
    if (servicioId) params.set("servicioId", servicioId);

    fetch(`/api/agenda/${token}/contabilidad?${params.toString()}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else {
          setReporte(body);
          setError(null);
        }
      })
      .catch(() => setError("No se pudo cargar la contabilidad"));
  }, [token, periodo, desde, hasta, especialistaId, servicioId]);

  useEffect(() => cargarReporte(), [cargarReporte]);

  const variacion = reporte?.ingresos.variacionPorcentual ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Contabilidad</h1>
        <p className="text-sm text-mist">Ingresos, desempeño y comisiones reales</p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-card p-3">
        <div className="flex gap-1.5">
          {(["hoy", "semana", "mes", "personalizado"] as TipoPeriodo[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriodo(p)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${periodo === p ? "bg-lime text-lime-fg" : "bg-ink-2 text-mist"}`}
            >
              {p === "hoy" ? "Hoy" : p === "semana" ? "Semana" : p === "mes" ? "Mes" : "Rango"}
            </button>
          ))}
        </div>
        {periodo === "personalizado" && (
          <div className="flex items-center gap-2">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-edge bg-ink px-2.5 py-1.5 text-sm text-fg" />
            <span className="text-xs text-mist">a</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-edge bg-ink px-2.5 py-1.5 text-sm text-fg" />
          </div>
        )}
        <div className="flex gap-2">
          <select value={especialistaId} onChange={(e) => setEspecialistaId(e.target.value)} className="rounded-lg border border-edge bg-ink px-2.5 py-1.5 text-sm text-fg">
            <option value="">Todas las profesionales</option>
            {especialistas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
          <select value={servicioId} onChange={(e) => setServicioId(e.target.value)} className="rounded-lg border border-edge bg-ink px-2.5 py-1.5 text-sm text-fg">
            <option value="">Todos los servicios</option>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!reporte ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-lime-soft text-lime-text">
                <Wallet className="size-5" />
              </div>
              <p className="mt-3 text-2xl font-bold text-fg">{formatearCOP(reporte.ingresos.actual)}</p>
              <p className="text-sm text-fg">Ingresos del período</p>
              {variacion !== null ? (
                <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${variacion >= 0 ? "text-success-text" : "text-danger-text"}`}>
                  {variacion >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                  {Math.abs(variacion).toFixed(1)}% vs período anterior
                </p>
              ) : (
                <p className="mt-1 text-xs text-mist">Sin período anterior para comparar</p>
              )}
            </div>
            <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-success text-success-text">
                <CalendarCheck className="size-5" />
              </div>
              <p className="mt-3 text-2xl font-bold text-fg">{reporte.citasCompletadas}</p>
              <p className="text-sm text-fg">Citas completadas</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
              <h2 className="text-base font-semibold text-fg">Ingresos por servicio</h2>
              {reporte.porServicio.length === 0 ? (
                <p className="mt-6 text-center text-sm text-mist">Sin servicios completados en este período.</p>
              ) : (
                <div className="mt-3 flex flex-col divide-y divide-edge">
                  {reporte.porServicio.map((s) => (
                    <div key={s.servicioId ?? s.servicio} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{s.servicio}</p>
                        <p className="text-xs text-mist">{s.cantidad} {s.cantidad === 1 ? "servicio" : "servicios"}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-fg">{formatearCOP(s.ingresos)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-edge bg-card p-5 shadow-sm">
              <h2 className="text-base font-semibold text-fg">Desempeño y comisiones</h2>
              {reporte.porProfesional.length === 0 ? (
                <p className="mt-6 text-center text-sm text-mist">Sin servicios completados en este período.</p>
              ) : (
                <div className="mt-3 flex flex-col divide-y divide-edge">
                  {reporte.porProfesional.map((p) => (
                    <div key={p.especialistaId} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{p.profesional}</p>
                        <p className="text-xs text-mist">
                          {p.cantidad} {p.cantidad === 1 ? "servicio" : "servicios"} · {formatearCOP(p.ingresos)}
                        </p>
                      </div>
                      {p.comision.estado === "configurada" ? (
                        <p className="shrink-0 text-sm font-semibold text-fg">{formatearCOP(p.comision.monto)}</p>
                      ) : (
                        <span className="shrink-0 rounded-full bg-ink-2 px-2.5 py-1 text-[11px] font-medium text-mist">No configurada</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-edge bg-card shadow-sm">
            <h2 className="p-5 pb-0 text-base font-semibold text-fg">Movimientos</h2>
            {reporte.movimientos.length === 0 ? (
              <p className="p-10 text-center text-sm text-mist">Sin movimientos en este período.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-mist">
                    <th className="px-5 py-3 font-medium">Fecha</th>
                    <th className="px-5 py-3 font-medium">Cliente</th>
                    <th className="px-5 py-3 font-medium">Servicio</th>
                    <th className="px-5 py-3 font-medium">Profesional</th>
                    <th className="px-5 py-3 font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {reporte.movimientos.map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-3 text-fg">{new Date(m.fecha).toLocaleString("es-CO")}</td>
                      <td className="px-5 py-3 text-fg">{m.cliente}</td>
                      <td className="px-5 py-3 text-fg">{m.servicio}</td>
                      <td className="px-5 py-3 text-fg">{m.profesional}</td>
                      <td className="px-5 py-3">
                        {m.valor !== null ? (
                          <span className="font-semibold text-fg">{formatearCOP(m.valor)}</span>
                        ) : (
                          <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-medium text-warning-text">Sin precio configurado</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
