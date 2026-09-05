"use client";

import { Heart, Plus } from "lucide-react";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreBadge, AmorePrimaryButton, AmoreDivider } from "@/components/spa-panel/amore/ui";
import { useAmoreUi } from "@/components/spa-panel/amore/AmoreUiContext";
import { loyaltyRulesMock, loyaltyContactsMock, loyaltyMessageMock } from "@/components/spa-panel/amore/amore-fidelizacion-mock";

// AMORE (Fase 5, diseño visual completo, autorizado) — SOLO diseño visual.
// Ninguna regla se evalúa de verdad y ningún mensaje se envía -- ver
// amore-fidelizacion-mock.ts. Automatizar esto es lógica funcional para una
// fase posterior.
export default function FidelizacionPage() {
  return (
    <AmoreOnlyScreen>
      <FidelizacionContenido />
    </AmoreOnlyScreen>
  );
}

function FidelizacionContenido() {
  const { avisarProximamente } = useAmoreUi();

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Fidelización" subtitle="Recupera clientas que no vuelven hace tiempo" />

      <div>
        <AmoreSectionTitle
          title="Reglas por servicio"
          action={
            <button type="button" onClick={avisarProximamente} className="flex items-center gap-1 text-sm font-medium text-lime-text">
              <Plus className="size-3.5" /> Nueva regla
            </button>
          }
        />
        <AmoreCard className="mt-2.5 !p-0">
          {loyaltyRulesMock.map((r, i) => (
            <div key={r.id}>
              <div className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{r.servicio}</p>
                  <p className="text-xs text-mist">Fidelizar después de {r.dias} días</p>
                </div>
                <AmoreBadge tono={r.activa ? "success" : "neutral"}>{r.activa ? "Activa" : "Inactiva"}</AmoreBadge>
              </div>
              {i < loyaltyRulesMock.length - 1 && <AmoreDivider />}
            </div>
          ))}
        </AmoreCard>
      </div>

      <div>
        <AmoreSectionTitle title="Clientes para contactar" />
        <div className="mt-2.5 flex flex-col gap-2.5">
          {loyaltyContactsMock.map((c) => (
            <AmoreCard key={c.id} className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium text-fg">{c.nombre}</p>
                <AmoreBadge tono="lime">{c.proximoContacto}</AmoreBadge>
              </div>
              <p className="mt-0.5 text-xs text-mist">
                {c.servicio} · Última visita: {c.ultimaVisita}
              </p>
            </AmoreCard>
          ))}
        </div>
      </div>

      <div>
        <AmoreSectionTitle title="Editor de mensaje" />
        <AmoreCard className="mt-2.5">
          <p className="rounded-2xl border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg">{loyaltyMessageMock}</p>
          <div className="mt-3 flex justify-center rounded-2xl bg-ink-2 p-4">
            <AmorePrimaryButton onClick={avisarProximamente} type="button">
              <Heart className="size-4" />
              Agendar mi cita
            </AmorePrimaryButton>
          </div>
          <p className="mt-2 text-center text-[11px] text-mist">Vista previa de cómo lo vería tu clienta</p>
        </AmoreCard>
      </div>
    </div>
  );
}
