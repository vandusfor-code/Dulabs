import { CalendarDays, ChevronRight } from "lucide-react";
import { inicialesDe } from "@/components/spa-panel/format";
import type { CitaMock } from "./amore-dashboard-mock";

const ESTADO_ESTILO: Record<CitaMock["estado"], string> = {
  confirmada: "bg-success text-success-text",
  pendiente: "bg-warning text-warning-text",
};

const ESTADO_LABEL: Record<CitaMock["estado"], string> = {
  confirmada: "Confirmada",
  pendiente: "Pendiente",
};

// AMORE (Fase 5, panel administrativo móvil, autorizado) — tarjeta principal
// del dashboard. "Ver todas" y "Ver calendario completo" quedan preparados
// para enlazar al módulo Citas cuando exista (Fase futura) -- por ahora
// avisan que la función aún no está disponible en vez de navegar a un
// módulo que todavía no se construyó.
export function AmoreUpcomingAppointments({
  citas,
  onVerTodas,
  onVerCalendario,
}: {
  citas: CitaMock[];
  onVerTodas: () => void;
  onVerCalendario: () => void;
}) {
  return (
    <div className="mt-5 rounded-[22px] border border-edge bg-card p-4 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">Próximas citas</h2>
        <button type="button" onClick={onVerTodas} className="text-sm font-medium text-lime-text">
          Ver todas
        </button>
      </div>

      <div className="mt-3 flex flex-col">
        {citas.map((cita, i) => (
          <div
            key={cita.id}
            className={`flex items-center gap-3 py-3 ${i < citas.length - 1 ? "border-b border-edge" : ""}`}
          >
            <span className="w-[62px] shrink-0 text-xs font-semibold text-fg">{cita.hora}</span>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime-soft text-[11px] font-semibold text-lime-text">
              {inicialesDe(cita.nombreCliente)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{cita.nombreCliente}</p>
              <p className="truncate text-xs text-mist">{cita.servicio}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${ESTADO_ESTILO[cita.estado]}`}>
              {ESTADO_LABEL[cita.estado]}
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onVerCalendario}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-lime-soft py-3 text-sm font-medium text-lime-text"
      >
        <CalendarDays className="size-4" />
        Ver calendario completo
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
