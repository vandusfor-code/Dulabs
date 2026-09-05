"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Sparkles, Clock3, BarChart3 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreAvatar, AmoreBadge, AmoreDivider } from "@/components/spa-panel/amore/ui";
import { formatearCOP } from "@/components/spa-panel/amore/amore-dashboard-mock";
import { teamMock } from "@/components/spa-panel/amore/amore-equipo-mock";

const ESTADO_TONO = { disponible: "success", ocupada: "warning", descanso: "neutral" } as const;
const ESTADO_LABEL = { disponible: "Disponible", ocupada: "Ocupada", descanso: "Descanso" } as const;

// AMORE (Fase 5, diseño visual completo, autorizado) — SOLO diseño visual.
export default function MiembroEquipoDetallePage() {
  return (
    <AmoreOnlyScreen>
      <Detalle />
    </AmoreOnlyScreen>
  );
}

function Detalle() {
  const { token } = useAgenda();
  const { id } = useParams<{ id: string }>();
  const miembro = teamMock.find((m) => m.id === id);

  if (!miembro) {
    return <p className="py-10 text-center text-sm text-mist">No se encontró a esta profesional.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/agenda/${token}/equipo`} className="flex items-center gap-1.5 text-xs font-medium text-mist hover:text-fg">
        <ArrowLeft className="size-3.5" /> Volver a equipo
      </Link>

      <AmoreCard className="flex items-center gap-3">
        <AmoreAvatar nombre={miembro.nombre} size="lg" />
        <div className="min-w-0 flex-1">
          <AmoreScreenTitle title={miembro.nombre} />
        </div>
        <AmoreBadge tono={ESTADO_TONO[miembro.estado]}>{ESTADO_LABEL[miembro.estado]}</AmoreBadge>
      </AmoreCard>

      <div className="grid grid-cols-1 gap-2.5">
        <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3">
          <Sparkles className="size-4 shrink-0 text-mist" />
          <span className="truncate text-sm text-fg">{miembro.servicios}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3">
          <Clock3 className="size-4 shrink-0 text-mist" />
          <span className="truncate text-sm text-fg">{miembro.horario}</span>
        </div>
      </div>

      <div>
        <AmoreSectionTitle title="Desempeño" action={<BarChart3 className="size-4 text-mist" />} />
        <AmoreCard className="mt-2.5 !p-0">
          <div className="flex items-center justify-between p-3.5">
            <p className="text-sm text-mist">Servicios realizados</p>
            <p className="text-sm font-semibold text-fg">{miembro.desempeno.serviciosRealizados}</p>
          </div>
          <AmoreDivider />
          <div className="flex items-center justify-between p-3.5">
            <p className="text-sm text-mist">Ingresos generados</p>
            <p className="text-sm font-semibold text-fg">{formatearCOP(miembro.desempeno.ingresos)}</p>
          </div>
          <AmoreDivider />
          <div className="flex items-center justify-between p-3.5">
            <p className="text-sm text-mist">Comisión</p>
            <p className="text-sm font-semibold text-fg">{formatearCOP(miembro.desempeno.comision)}</p>
          </div>
        </AmoreCard>
      </div>
    </div>
  );
}
