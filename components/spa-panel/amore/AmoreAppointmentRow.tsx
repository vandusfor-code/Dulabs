import { AmoreAvatar, AmoreBadge } from "./ui";
import type { CitaMock, EstadoCitaMock } from "./amore-dashboard-mock";

// AMORE (Fase 5, diseño visual completo, autorizado) — fila de cita
// reutilizada entre Inicio ("Próximas citas") y Citas (agenda completa), para
// que ambas pantallas se vean como parte de la misma app. Extraído de
// AmoreUpcomingAppointments SIN cambiar su marcado -- cero diferencia visual
// en Inicio (ya desplegado).
const ESTADO_TONO: Record<EstadoCitaMock, "success" | "warning" | "neutral"> = {
  confirmada: "success",
  pendiente: "warning",
  completada: "success",
  cancelada: "neutral",
};

const ESTADO_LABEL: Record<EstadoCitaMock, string> = {
  confirmada: "Confirmada",
  pendiente: "Pendiente",
  completada: "Completada",
  cancelada: "Cancelada",
};

export function AmoreAppointmentRow({ cita, conBorde }: { cita: CitaMock; conBorde: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-3 ${conBorde ? "border-b border-edge" : ""}`}>
      <span className="w-[62px] shrink-0 text-xs font-semibold text-fg">{cita.hora}</span>
      <AmoreAvatar nombre={cita.nombreCliente} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{cita.nombreCliente}</p>
        <p className="truncate text-xs text-mist">{cita.servicio}</p>
      </div>
      <AmoreBadge tono={ESTADO_TONO[cita.estado]}>{ESTADO_LABEL[cita.estado]}</AmoreBadge>
    </div>
  );
}
