import { CalendarDays, ChevronRight } from "lucide-react";
import { AmoreCard, AmoreSecondaryButton, AmoreSectionTitle } from "./ui";
import { AmoreAppointmentRow } from "./AmoreAppointmentRow";
import type { CitaMock } from "./amore-dashboard-mock";

// AMORE (Fase 5, panel administrativo móvil, autorizado) — tarjeta principal
// del dashboard. "Ver todas" y "Ver calendario completo" quedan preparados
// para enlazar al módulo Citas cuando exista (Fase futura) -- por ahora
// avisan que la función aún no está disponible en vez de navegar a un
// módulo que todavía no se construyó.
//
// Fase 5 (diseño visual completo, autorizado) — reescrito para usar el kit
// compartido (AmoreCard/AmoreAppointmentRow) en vez de repetir el marcado a
// mano; el HTML/clases resultantes son EXACTAMENTE los mismos de antes, cero
// cambio visual en Inicio (ya desplegado).
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
    <AmoreCard className="mt-5">
      <AmoreSectionTitle
        title="Próximas citas"
        action={
          <button type="button" onClick={onVerTodas} className="text-sm font-medium text-lime-text">
            Ver todas
          </button>
        }
      />

      <div className="mt-3 flex flex-col">
        {citas.map((cita, i) => (
          <AmoreAppointmentRow key={cita.id} cita={cita} conBorde={i < citas.length - 1} />
        ))}
      </div>

      <AmoreSecondaryButton onClick={onVerCalendario} className="mt-3 w-full">
        <CalendarDays className="size-4" />
        Ver calendario completo
        <ChevronRight className="size-4" />
      </AmoreSecondaryButton>
    </AmoreCard>
  );
}
