"use client";

import { Wand2 } from "lucide-react";
import { Seccion, Bloque } from "./AdminClienteUI";

// F15.2 (Operations Center, cierre) -- portado del admin legacy (ver
// SeccionImplementacion.tsx para el porqué). "Usar como base para
// configurar" copia el texto tal cual escribió el cliente al prompt del
// agente -- nunca lo aplica solo, siempre requiere que el operador guarde
// explícitamente desde SeccionAgente.

export type OnboardingDetalle = {
  estado: string;
  businessDescription: string | null;
  implementationIdea: string | null;
  additionalInformation: string | null;
  phoneNumberId: string;
  telefonoCliente: string;
} | null;

export function textoOnboardingComoPrompt(onboarding: NonNullable<OnboardingDetalle>): string {
  return [
    onboarding.businessDescription ? `Descripción del negocio:\n${onboarding.businessDescription}` : null,
    onboarding.implementationIdea ? `Qué quiere implementar:\n${onboarding.implementationIdea}` : null,
    onboarding.additionalInformation ? `Información adicional:\n${onboarding.additionalInformation}` : null,
  ]
    .filter((p): p is string => Boolean(p))
    .join("\n\n");
}

export function SeccionOnboarding({
  onboarding,
  hayAgenteSeleccionado,
  onUsarComoBase,
}: {
  onboarding: OnboardingDetalle;
  hayAgenteSeleccionado: boolean;
  onUsarComoBase: (texto: string) => void;
}) {
  return (
    <Seccion
      titulo="Información recibida en onboarding"
      accion={
        onboarding && hayAgenteSeleccionado ? (
          <button
            onClick={() => onUsarComoBase(textoOnboardingComoPrompt(onboarding))}
            className="flex items-center gap-1.5 rounded-lg border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-semibold text-lime-text transition-colors hover:bg-lime/15"
          >
            <Wand2 className="size-3.5" />
            Usar como base para configurar
          </button>
        ) : undefined
      }
    >
      {onboarding ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <Bloque label="Descripción del negocio" texto={onboarding.businessDescription} />
          <Bloque label="Qué quiere implementar" texto={onboarding.implementationIdea} />
          <Bloque label="Información adicional" texto={onboarding.additionalInformation} />
        </div>
      ) : (
        <p className="text-sm text-mist">Sin onboarding todavía.</p>
      )}
      {onboarding && !hayAgenteSeleccionado && (
        <p className="mt-3 text-xs text-mist">Crea un agente en la sección de abajo para poder usar esta información como base.</p>
      )}
    </Seccion>
  );
}
