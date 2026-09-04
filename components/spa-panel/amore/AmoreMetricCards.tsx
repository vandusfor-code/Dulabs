import { CalendarCheck, Users, Flower2, TrendingUp } from "lucide-react";
import type { DashboardDataMock } from "./amore-dashboard-mock";
import { formatearCOP } from "./amore-dashboard-mock";

// AMORE (Fase 5, panel administrativo móvil, autorizado) — 4 métricas
// compactas en grid 2x2, fiel al mockup. Solo estas cuatro -- sin gráficos,
// desempeño, cumpleaños ni comisiones en esta fase.
function Tarjeta({
  icono,
  bgIcono,
  colorIcono,
  valor,
  etiqueta,
  subtexto,
  colorSubtexto,
}: {
  icono: React.ReactNode;
  bgIcono: string;
  colorIcono: string;
  valor: string;
  etiqueta: string;
  subtexto: string;
  colorSubtexto: string;
}) {
  return (
    <div className="rounded-[22px] border border-edge bg-card p-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
      <div className={`flex size-11 items-center justify-center rounded-2xl ${bgIcono}`} style={{ color: colorIcono }}>
        {icono}
      </div>
      <p className="mt-3 text-2xl font-bold text-fg">{valor}</p>
      <p className="text-sm text-fg">{etiqueta}</p>
      <p className="mt-0.5 text-xs font-medium" style={{ color: colorSubtexto }}>
        {subtexto}
      </p>
    </div>
  );
}

export function AmoreMetricCards({ datos }: { datos: DashboardDataMock }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3">
      <Tarjeta
        icono={<CalendarCheck className="size-5" />}
        bgIcono="bg-lime-soft"
        colorIcono="var(--color-lime-text)"
        valor={String(datos.citasHoy.total)}
        etiqueta="Citas hoy"
        subtexto={`${datos.citasHoy.pendientes} pendientes`}
        colorSubtexto="var(--color-lime-text)"
      />
      <Tarjeta
        icono={<Users className="size-5" />}
        bgIcono="bg-[#EEEAFB]"
        colorIcono="#7C6FC9"
        valor={String(datos.clientesActivos.total)}
        etiqueta="Clientes activos"
        subtexto={`+${datos.clientesActivos.nuevosEsteMes} este mes`}
        colorSubtexto="var(--color-success-text)"
      />
      <Tarjeta
        icono={<Flower2 className="size-5" />}
        bgIcono="bg-[#FDEEE1]"
        colorIcono="#D97B3F"
        valor={String(datos.serviciosHoy.total)}
        etiqueta="Servicios hoy"
        subtexto={`${datos.serviciosHoy.diferentes} diferentes`}
        colorSubtexto="var(--color-mist)"
      />
      <Tarjeta
        icono={<TrendingUp className="size-5" />}
        bgIcono="bg-success"
        colorIcono="var(--color-success-text)"
        valor={formatearCOP(datos.ingresosMes.total)}
        etiqueta="Ingresos del mes"
        subtexto={`+${datos.ingresosMes.variacionPct}% vs mes anterior`}
        colorSubtexto="var(--color-success-text)"
      />
    </div>
  );
}
