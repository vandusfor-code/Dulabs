"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreAvatar, AmoreBadge } from "@/components/spa-panel/amore/ui";
import { teamMock } from "@/components/spa-panel/amore/amore-equipo-mock";

const ESTADO_TONO = { disponible: "success", ocupada: "warning", descanso: "neutral" } as const;
const ESTADO_LABEL = { disponible: "Disponible", ocupada: "Ocupada", descanso: "Descanso" } as const;

// AMORE (Fase 5, diseño visual completo, autorizado) — SOLO diseño visual.
// Nombres y qué hace cada quién son reales; horario/estado/desempeño son
// mock (ver amore-equipo-mock.ts). Calcular desempeño real es lógica
// funcional para una fase posterior.
export default function EquipoPage() {
  const { token } = useAgenda();

  return (
    <AmoreOnlyScreen>
      <div className="flex flex-col gap-5">
        <AmoreScreenTitle title="Equipo" subtitle="Las profesionales de AMORE" />
        <div className="flex flex-col gap-2.5">
          {teamMock.map((m) => (
            <Link key={m.id} href={`/agenda/${token}/equipo/${m.id}`}>
              <AmoreCard className="flex items-center gap-3 p-3.5">
                <AmoreAvatar nombre={m.nombre} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{m.nombre}</p>
                  <p className="truncate text-xs text-mist">{m.servicios}</p>
                </div>
                <AmoreBadge tono={ESTADO_TONO[m.estado]}>{ESTADO_LABEL[m.estado]}</AmoreBadge>
                <ChevronRight className="size-4 shrink-0 text-mist" />
              </AmoreCard>
            </Link>
          ))}
        </div>
      </div>
    </AmoreOnlyScreen>
  );
}
