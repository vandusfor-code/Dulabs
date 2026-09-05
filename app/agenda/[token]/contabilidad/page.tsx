"use client";

import { useState } from "react";
import { Wallet, TrendingUp, CalendarCheck, Clock } from "lucide-react";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreSegmentedTabs, AmoreBadge, AmoreDivider } from "@/components/spa-panel/amore/ui";
import { formatearCOP } from "@/components/spa-panel/amore/amore-dashboard-mock";
import { accountingMock } from "@/components/spa-panel/amore/amore-contabilidad-mock";

type Filtro = "hoy" | "semana" | "mes";

// AMORE (Fase 5, diseño visual completo, autorizado) — SOLO diseño visual.
// Ningún valor se calcula de verdad -- ver amore-contabilidad-mock.ts.
// Conectar esto a citas/pagos reales es lógica funcional para una fase
// posterior.
export default function ContabilidadPage() {
  return (
    <AmoreOnlyScreen>
      <ContabilidadContenido />
    </AmoreOnlyScreen>
  );
}

function ContabilidadContenido() {
  const [filtro, setFiltro] = useState<Filtro>("mes");

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Contabilidad" subtitle="Resumen de ingresos y comisiones" />

      <AmoreSegmentedTabs
        opciones={[
          { valor: "hoy", etiqueta: "Hoy" },
          { valor: "semana", etiqueta: "Semana" },
          { valor: "mes", etiqueta: "Mes" },
        ]}
        activo={filtro}
        onChange={setFiltro}
      />

      <div className="grid grid-cols-2 gap-3">
        <AmoreCard>
          <div className="flex size-11 items-center justify-center rounded-2xl bg-success text-success-text">
            <TrendingUp className="size-5" />
          </div>
          <p className="mt-3 text-2xl font-bold text-fg">{formatearCOP(accountingMock.ingresosDia)}</p>
          <p className="text-sm text-fg">Ingresos del día</p>
        </AmoreCard>
        <AmoreCard>
          <div className="flex size-11 items-center justify-center rounded-2xl bg-lime-soft text-lime-text">
            <Wallet className="size-5" />
          </div>
          <p className="mt-3 text-2xl font-bold text-fg">{formatearCOP(accountingMock.ingresosMes)}</p>
          <p className="text-sm text-fg">Ingresos del mes</p>
        </AmoreCard>
        <AmoreCard>
          <div className="flex size-11 items-center justify-center rounded-2xl bg-[#FDEEE1] text-[#D97B3F]">
            <CalendarCheck className="size-5" />
          </div>
          <p className="mt-3 text-2xl font-bold text-fg">{accountingMock.citasCobradas}</p>
          <p className="text-sm text-fg">Citas cobradas</p>
        </AmoreCard>
        <AmoreCard>
          <div className="flex size-11 items-center justify-center rounded-2xl bg-warning text-warning-text">
            <Clock className="size-5" />
          </div>
          <p className="mt-3 text-2xl font-bold text-fg">{accountingMock.citasPendientes}</p>
          <p className="text-sm text-fg">Pendientes</p>
        </AmoreCard>
      </div>

      <div>
        <AmoreSectionTitle title="Ingresos por servicio" />
        <AmoreCard className="mt-2.5 !p-0">
          {accountingMock.porServicio.map((s, i) => (
            <div key={s.servicio}>
              <div className="flex items-center justify-between p-3.5">
                <p className="text-sm font-medium text-fg">{s.servicio}</p>
                <p className="text-sm font-semibold text-fg">{formatearCOP(s.ingresos)}</p>
              </div>
              {i < accountingMock.porServicio.length - 1 && <AmoreDivider />}
            </div>
          ))}
        </AmoreCard>
      </div>

      <div>
        <AmoreSectionTitle title="Comisiones" />
        <AmoreCard className="mt-2.5 !p-0">
          {accountingMock.comisiones.map((c, i) => (
            <div key={c.profesional}>
              <div className="flex items-center justify-between p-3.5">
                <p className="text-sm font-medium text-fg">{c.profesional}</p>
                <p className="text-sm font-semibold text-fg">{formatearCOP(c.comision)}</p>
              </div>
              {i < accountingMock.comisiones.length - 1 && <AmoreDivider />}
            </div>
          ))}
        </AmoreCard>
      </div>

      <div>
        <AmoreSectionTitle title="Movimientos" />
        <div className="mt-2.5 flex flex-col gap-2.5">
          {accountingMock.movimientos.map((m) => (
            <AmoreCard key={m.id} className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium text-fg">{m.nombreCliente}</p>
                <AmoreBadge tono={m.estado === "pagado" ? "success" : "warning"}>{m.estado === "pagado" ? "Pagado" : "Pendiente"}</AmoreBadge>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-3">
                <p className="truncate text-xs text-mist">
                  {m.servicio} · {m.fecha}
                </p>
                <p className="shrink-0 text-sm font-semibold text-fg">{formatearCOP(m.valor)}</p>
              </div>
            </AmoreCard>
          ))}
        </div>
      </div>
    </div>
  );
}
