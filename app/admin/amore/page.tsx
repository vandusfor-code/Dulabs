"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Users, Sparkles, TrendingUp, Cake, Bell, ChevronRight } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { ColaboradoraDesktopInicio } from "@/components/admin-web/colaboradora/ColaboradoraDesktopInicio";
import { DonutChart, type SegmentoDonut } from "@/components/admin-web/DonutChart";
import { formatearHora, mismoDia } from "@/components/spa-panel/format";
import { formatearCOP } from "@/components/spa-panel/amore/amore-dashboard-mock";
import { RUTA_CITAS, RUTA_CUMPLEANOS, RUTA_COMUNICACIONES } from "@/components/admin-web/admin-web-routes";
import type { ReporteContabilidad } from "@/lib/contabilidad/tipos";

type Cumpleanos = { id: number; nombre: string; esHoy: boolean; diasHasta: number; fecha: string };
type ConfigComunicaciones = { confirmacionActiva: boolean; recordatorioActivo: boolean; recordatorioAnticipacionHoras: number };

const COLORES_DONUT = ["#b85c78", "#8f7cc9", "#e0a85c", "#5cae82", "#5c9ecf", "#c96b6b"];

// Panel web AMORE (autorizado) — Inicio desktop, fiel al mockup aprobado.
// Reutiliza EXACTAMENTE los mismos endpoints que ya usa el dashboard móvil
// (AmoreDashboardHome.tsx) más /contabilidad, /cumpleanos y
// /comunicaciones/config -- cero endpoint nuevo, cero cálculo duplicado.
//
// Reglas de Hooks: este componente exterior llama UN SOLO hook
// (useAdminWeb) y decide qué renderizar antes de que cualquier otro hook
// se ejecute -- el resto de los hooks (fetches, estado, memos) viven en
// AdminInicioContenido, un componente aparte que SOLO se monta para
// administrador, así nunca hay una llamada condicional a un hook.
export default function AdminAmoreInicioPage() {
  const { datos } = useAdminWeb();
  if (datos.sesion?.rol === "colaboradora") return <ColaboradoraDesktopInicio />;
  return <AdminInicioContenido />;
}

function AdminInicioContenido() {
  const { token, datos } = useAdminWeb();
  const router = useRouter();

  const [clientesNuevosEsteMes, setClientesNuevosEsteMes] = useState(0);
  const [reporte, setReporte] = useState<ReporteContabilidad | null>(null);
  const [cumpleanos, setCumpleanos] = useState<Cumpleanos[]>([]);
  const [comunicaciones, setComunicaciones] = useState<ConfigComunicaciones | null>(null);

  useEffect(() => {
    const ahora = new Date();
    fetch(`/api/agenda/${token}/clientes`)
      .then((r) => r.json())
      .then((body) => {
        const clientes = (body.clientes ?? []) as { created_at: string }[];
        const nuevos = clientes.filter((c) => {
          const d = new Date(c.created_at);
          return d.getUTCFullYear() === ahora.getUTCFullYear() && d.getUTCMonth() === ahora.getUTCMonth();
        }).length;
        setClientesNuevosEsteMes(nuevos);
      })
      .catch(() => {});

    fetch(`/api/agenda/${token}/contabilidad?periodo=mes`)
      .then((r) => r.json())
      .then((body) => setReporte(body))
      .catch(() => {});

    fetch(`/api/agenda/${token}/cumpleanos`)
      .then((r) => r.json())
      .then((body) => setCumpleanos(body.cumpleanos ?? []))
      .catch(() => {});

    fetch(`/api/agenda/${token}/comunicaciones/config`)
      .then((r) => r.json())
      .then((body) => setComunicaciones(body.config))
      .catch(() => {});
  }, [token]);

  const citasHoy = useMemo(
    () => datos.citas.filter((c) => mismoDia(c.inicio, new Date()) && c.estado !== "rechazada" && c.estado !== "cancelada"),
    [datos.citas]
  );
  const pendientesHoy = citasHoy.filter((c) => c.estado === "pendiente" || c.estado === "propuesta").length;
  const serviciosHoyDistintos = new Set(citasHoy.map((c) => c.servicio)).size;

  const segmentosDonut: SegmentoDonut[] = (reporte?.porServicio ?? [])
    .slice(0, 6)
    .map((s, i) => ({ etiqueta: s.servicio, valor: s.cantidad, color: COLORES_DONUT[i % COLORES_DONUT.length] }));
  const totalServiciosDonut = segmentosDonut.reduce((acc, s) => acc + s.valor, 0);

  const cumpleanosHoy = cumpleanos.filter((c) => c.esHoy);
  const cumpleanosSemana = cumpleanos.filter((c) => !c.esHoy && c.diasHasta <= 7);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-4 gap-4">
        <CardMetrica
          icono={<CalendarDays className="size-5" />}
          bg="bg-lime-soft"
          color="var(--color-lime-text)"
          titulo="Citas de hoy"
          valor={String(citasHoy.length)}
          subtexto={pendientesHoy > 0 ? `${pendientesHoy} pendientes` : "Sin pendientes"}
        />
        <CardMetrica
          icono={<Users className="size-5" />}
          bg="bg-[#EEEAFB]"
          color="#7C6FC9"
          titulo="Clientes activos"
          valor={String(datos.resumen.clientesRegistrados)}
          subtexto={`+${clientesNuevosEsteMes} este mes`}
        />
        <CardMetrica
          icono={<Sparkles className="size-5" />}
          bg="bg-[#FDEEE1]"
          color="#D97B3F"
          titulo="Servicios hoy"
          valor={String(citasHoy.length)}
          subtexto={`${serviciosHoyDistintos} diferentes`}
        />
        <CardMetrica
          icono={<TrendingUp className="size-5" />}
          bg="bg-success"
          color="var(--color-success-text)"
          titulo="Ingresos del mes"
          valor={formatearCOP(reporte?.ingresos.actual ?? 0)}
          subtexto={
            reporte?.ingresos.variacionPorcentual !== null && reporte?.ingresos.variacionPorcentual !== undefined
              ? `${reporte.ingresos.variacionPorcentual >= 0 ? "+" : ""}${reporte.ingresos.variacionPorcentual}% vs mes anterior`
              : "Sin período anterior"
          }
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-1 rounded-2xl border border-edge bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">Citas de hoy</h2>
            <button type="button" onClick={() => router.push(RUTA_CITAS)} className="text-sm font-medium text-lime-text hover:underline">
              Ver todas
            </button>
          </div>
          {citasHoy.length === 0 ? (
            <p className="mt-6 text-center text-sm text-mist">No hay citas para hoy.</p>
          ) : (
            <div className="mt-3 flex flex-col divide-y divide-edge">
              {citasHoy.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{formatearHora(c.inicio)}</p>
                    <p className="truncate text-xs text-mist">
                      {c.nombre_cliente} · {c.servicio} · {c.profesional}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      c.estado === "confirmada" ? "bg-success text-success-text" : "bg-warning text-warning-text"
                    }`}
                  >
                    {c.estado === "confirmada" ? "Confirmada" : "Pendiente"}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => router.push(RUTA_CITAS)}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-lime-soft py-2.5 text-sm font-medium text-lime-text"
          >
            <CalendarDays className="size-4" /> Ver calendario completo
          </button>
        </div>

        <div className="col-span-1 rounded-2xl border border-edge bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">Cumpleaños</h2>
            <button type="button" onClick={() => router.push(RUTA_CUMPLEANOS)} className="text-sm font-medium text-lime-text hover:underline">
              Ver todos
            </button>
          </div>
          {cumpleanosHoy.length === 0 && cumpleanosSemana.length === 0 ? (
            <p className="mt-6 text-center text-sm text-mist">Sin cumpleaños próximos.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {cumpleanosHoy.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-mist">Hoy</p>
                  {cumpleanosHoy.map((c) => (
                    <div key={c.id} className="mt-1.5 flex items-center gap-2.5">
                      <Cake className="size-4 shrink-0 text-lime-text" />
                      <p className="truncate text-sm text-fg">{c.nombre} · ¡Feliz cumpleaños!</p>
                    </div>
                  ))}
                </div>
              )}
              {cumpleanosSemana.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-mist">Esta semana</p>
                  {cumpleanosSemana.slice(0, 4).map((c) => (
                    <div key={c.id} className="mt-1.5 flex items-center gap-2.5 text-sm">
                      <span className="w-16 shrink-0 text-mist">{c.fecha}</span>
                      <span className="truncate text-fg">{c.nombre}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="col-span-1 rounded-2xl border border-edge bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">Servicios más realizados</h2>
            <span className="text-xs font-medium text-mist">Este mes</span>
          </div>
          {totalServiciosDonut === 0 ? (
            <p className="mt-6 text-center text-sm text-mist">Sin servicios completados este mes.</p>
          ) : (
            <div className="mt-3 flex items-center gap-4">
              <DonutChart segmentos={segmentosDonut} tamano={130} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {segmentosDonut.map((s) => (
                  <div key={s.etiqueta} className="flex items-center gap-2 text-xs">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="truncate text-fg">{s.etiqueta}</span>
                    <span className="ml-auto shrink-0 text-mist">{Math.round((s.valor / totalServiciosDonut) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 rounded-2xl border border-edge bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">Desempeño de trabajadoras</h2>
            <span className="text-xs font-medium text-mist">Este mes</span>
          </div>
          {!reporte || reporte.porProfesional.length === 0 ? (
            <p className="mt-6 text-center text-sm text-mist">Sin datos de desempeño este mes.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-mist">
                  <th className="pb-2 font-medium">Trabajadora</th>
                  <th className="pb-2 font-medium">Servicios</th>
                  <th className="pb-2 font-medium">Ingresos</th>
                  <th className="pb-2 font-medium">Comisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {reporte.porProfesional.map((p) => (
                  <tr key={p.especialistaId}>
                    <td className="py-2.5 text-fg">{p.profesional}</td>
                    <td className="py-2.5 text-fg">{p.cantidad}</td>
                    <td className="py-2.5 text-fg">{formatearCOP(p.ingresos)}</td>
                    <td className="py-2.5 text-fg">
                      {p.comision.estado === "configurada" ? formatearCOP(p.comision.monto) : <span className="text-mist">No configurada</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="col-span-1 rounded-2xl border border-edge bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">Recordatorios</h2>
            <button
              type="button"
              onClick={() => router.push(RUTA_COMUNICACIONES)}
              className="text-sm font-medium text-lime-text hover:underline"
            >
              Configurar
            </button>
          </div>
          {!comunicaciones ? (
            <p className="mt-6 text-center text-sm text-mist">Cargando…</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              <FilaRecordatorio activo={comunicaciones.confirmacionActiva} texto="Confirmaciones de cita" />
              <FilaRecordatorio
                activo={comunicaciones.recordatorioActivo}
                texto={`Recordatorio (${comunicaciones.recordatorioAnticipacionHoras}h antes)`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CardMetrica({
  icono,
  bg,
  color,
  titulo,
  valor,
  subtexto,
}: {
  icono: React.ReactNode;
  bg: string;
  color: string;
  titulo: string;
  valor: string;
  subtexto: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-edge bg-card p-4 shadow-sm">
      <div className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${bg}`} style={{ color }}>
        {icono}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-tight text-fg">{valor}</p>
        <p className="truncate text-sm text-fg">{titulo}</p>
        <p className="truncate text-xs text-mist">{subtexto}</p>
      </div>
    </div>
  );
}

function FilaRecordatorio({ activo, texto }: { activo: boolean; texto: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-ink-2 px-3 py-2.5">
      <Bell className={`size-4 shrink-0 ${activo ? "text-lime-text" : "text-mist"}`} />
      <p className="flex-1 truncate text-sm text-fg">{texto}</p>
      <span className={`shrink-0 text-xs font-medium ${activo ? "text-success-text" : "text-mist"}`}>{activo ? "Activo" : "Inactivo"}</span>
      <ChevronRight className="size-3.5 shrink-0 text-mist" />
    </div>
  );
}
