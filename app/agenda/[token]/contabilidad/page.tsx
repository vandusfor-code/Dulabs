"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet, TrendingUp, TrendingDown, CalendarCheck, Loader2, Receipt } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import {
  AmoreCard,
  AmoreScreenTitle,
  AmoreSectionTitle,
  AmoreSegmentedTabs,
  AmoreBadge,
  AmoreDivider,
  AmoreEmptyState,
} from "@/components/spa-panel/amore/ui";
import { formatearCOP } from "@/components/spa-panel/amore/amore-dashboard-mock";

type Periodo = "hoy" | "semana" | "mes" | "personalizado";

type ReporteContabilidad = {
  periodo: { tipo: Periodo; desde: string; hasta: string };
  ingresos: { actual: number; anterior: number; variacionPorcentual: number | null };
  citasCompletadas: number;
  porServicio: { servicioId: string | null; servicio: string; cantidad: number; ingresos: number }[];
  porProfesional: {
    especialistaId: number;
    profesional: string;
    cantidad: number;
    ingresos: number;
    comision: { estado: "configurada"; tipo: string; valor: number; monto: number } | { estado: "no_configurada" };
  }[];
  movimientos: { id: number; fecha: string; cliente: string; servicio: string; profesional: string; valor: number | null; estado: string }[];
};

type Opcion = { id: string | number; nombre: string };

// AMORE (Fase 10, autorizado) — MISMO Design System de la Fase 5
// (AmoreCard/AmoreScreenTitle/AmoreSegmentedTabs/AmoreBadge...), ahora
// conectado a datos reales (ver app/api/agenda/[token]/contabilidad). Solo
// se agregaron los filtros/secciones que pide la funcionalidad
// (personalizado, por profesional, comisiones, "sin precio configurado")
// sobre los MISMOS componentes visuales -- nada del kit se modificó.
export default function ContabilidadPage() {
  return (
    <AmoreOnlyScreen>
      <ContabilidadContenido />
    </AmoreOnlyScreen>
  );
}

function ContabilidadContenido() {
  const { token } = useAgenda();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
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
      .then((body) => (body.error ? setError(body.error) : (setReporte(body), setError(null))))
      .catch(() => setError("No se pudo cargar la contabilidad"));
  }, [token, periodo, desde, hasta, especialistaId, servicioId]);

  useEffect(() => {
    cargarReporte();
  }, [cargarReporte]);

  const variacion = reporte?.ingresos.variacionPorcentual ?? null;

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Contabilidad" subtitle="Resumen de ingresos y comisiones" />

      <AmoreSegmentedTabs
        opciones={[
          { valor: "hoy", etiqueta: "Hoy" },
          { valor: "semana", etiqueta: "Semana" },
          { valor: "mes", etiqueta: "Mes" },
          { valor: "personalizado", etiqueta: "Rango" },
        ]}
        activo={periodo}
        onChange={setPeriodo}
      />

      {periodo === "personalizado" && (
        <div className="flex items-center gap-2.5">
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="flex-1 rounded-xl border border-edge bg-card px-3 py-2 text-sm text-fg"
          />
          <span className="text-xs text-mist">a</span>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="flex-1 rounded-xl border border-edge bg-card px-3 py-2 text-sm text-fg"
          />
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <select
          value={especialistaId}
          onChange={(e) => setEspecialistaId(e.target.value)}
          className="flex-1 rounded-xl border border-edge bg-card px-3 py-2 text-sm text-fg"
        >
          <option value="">Todos los profesionales</option>
          {especialistas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        <select
          value={servicioId}
          onChange={(e) => setServicioId(e.target.value)}
          className="flex-1 rounded-xl border border-edge bg-card px-3 py-2 text-sm text-fg"
        >
          <option value="">Todos los servicios</option>
          {servicios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!reporte ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <AmoreCard>
              <div className="flex size-11 items-center justify-center rounded-2xl bg-lime-soft text-lime-text">
                <Wallet className="size-5" />
              </div>
              <p className="mt-3 text-2xl font-bold text-fg">{formatearCOP(reporte.ingresos.actual)}</p>
              <p className="text-sm text-fg">Ingresos del período</p>
              {variacion !== null && (
                <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${variacion >= 0 ? "text-success-text" : "text-danger-text"}`}>
                  {variacion >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                  {Math.abs(variacion).toFixed(1)}% vs período anterior
                </p>
              )}
              {variacion === null && <p className="mt-1 text-xs text-mist">Sin período anterior para comparar</p>}
            </AmoreCard>
            <AmoreCard>
              <div className="flex size-11 items-center justify-center rounded-2xl bg-success text-success-text">
                <CalendarCheck className="size-5" />
              </div>
              <p className="mt-3 text-2xl font-bold text-fg">{reporte.citasCompletadas}</p>
              <p className="text-sm text-fg">Citas completadas</p>
            </AmoreCard>
          </div>

          <div>
            <AmoreSectionTitle title="Ingresos por servicio" />
            {reporte.porServicio.length === 0 ? (
              <div className="mt-2.5">
                <AmoreEmptyState icono={<Receipt className="size-6 text-mist" />} mensaje="No hay servicios completados en este período." />
              </div>
            ) : (
              <AmoreCard className="mt-2.5 !p-0">
                {reporte.porServicio.map((s, i) => (
                  <div key={s.servicioId ?? s.servicio}>
                    <div className="flex items-center justify-between p-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{s.servicio}</p>
                        <p className="text-xs text-mist">
                          {s.cantidad} {s.cantidad === 1 ? "servicio" : "servicios"}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-fg">{formatearCOP(s.ingresos)}</p>
                    </div>
                    {i < reporte.porServicio.length - 1 && <AmoreDivider />}
                  </div>
                ))}
              </AmoreCard>
            )}
          </div>

          <div>
            <AmoreSectionTitle title="Ingresos por profesional" />
            {reporte.porProfesional.length === 0 ? (
              <div className="mt-2.5">
                <AmoreEmptyState icono={<Receipt className="size-6 text-mist" />} mensaje="No hay servicios completados en este período." />
              </div>
            ) : (
              <AmoreCard className="mt-2.5 !p-0">
                {reporte.porProfesional.map((p, i) => (
                  <div key={p.especialistaId}>
                    <div className="flex items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{p.profesional}</p>
                        <p className="text-xs text-mist">
                          {p.cantidad} {p.cantidad === 1 ? "servicio" : "servicios"} · {formatearCOP(p.ingresos)}
                        </p>
                      </div>
                      {p.comision.estado === "configurada" ? (
                        <p className="shrink-0 text-sm font-semibold text-fg">{formatearCOP(p.comision.monto)}</p>
                      ) : (
                        <AmoreBadge tono="neutral" className="shrink-0">
                          Comisión no configurada
                        </AmoreBadge>
                      )}
                    </div>
                    {i < reporte.porProfesional.length - 1 && <AmoreDivider />}
                  </div>
                ))}
              </AmoreCard>
            )}
          </div>

          <div>
            <AmoreSectionTitle title="Movimientos" />
            {reporte.movimientos.length === 0 ? (
              <div className="mt-2.5">
                <AmoreEmptyState icono={<Receipt className="size-6 text-mist" />} mensaje="No hay movimientos en este período." />
              </div>
            ) : (
              <div className="mt-2.5 flex flex-col gap-2.5">
                {reporte.movimientos.map((m) => (
                  <AmoreCard key={m.id} className="p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-fg">{m.cliente}</p>
                      <AmoreBadge tono="success">Completada</AmoreBadge>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-3">
                      <p className="truncate text-xs text-mist">
                        {m.servicio} · {m.profesional} · {new Date(m.fecha).toLocaleString("es-CO")}
                      </p>
                      {m.valor !== null ? (
                        <p className="shrink-0 text-sm font-semibold text-fg">{formatearCOP(m.valor)}</p>
                      ) : (
                        <AmoreBadge tono="warning" className="shrink-0">
                          Sin precio configurado
                        </AmoreBadge>
                      )}
                    </div>
                  </AmoreCard>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
