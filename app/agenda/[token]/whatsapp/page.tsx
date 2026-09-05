"use client";

import { MessageCircle } from "lucide-react";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreSecondaryButton, AmoreDivider } from "@/components/spa-panel/amore/ui";
import { useAmoreUi } from "@/components/spa-panel/amore/AmoreUiContext";
import { whatsappMock } from "@/components/spa-panel/amore/amore-whatsapp-mock";

// AMORE (Fase 5, diseño visual completo, autorizado) — SOLO diseño visual.
// El estado mostrado es mock (ver amore-whatsapp-mock.ts) -- conectar/
// desconectar de verdad (QR, Meta) es lógica funcional para una fase
// posterior. Ningún mensaje se envía desde acá.
export default function WhatsappPage() {
  return (
    <AmoreOnlyScreen>
      <WhatsappContenido />
    </AmoreOnlyScreen>
  );
}

function WhatsappContenido() {
  const { avisarProximamente } = useAmoreUi();

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="WhatsApp" subtitle="Conexión con tus clientas" />

      <AmoreCard className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-success text-success-text">
          <MessageCircle className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
            <span className="size-2 rounded-full bg-success-text" /> Conectado
          </p>
          <p className="truncate text-xs text-mist">{whatsappMock.numero}</p>
        </div>
      </AmoreCard>

      <div className="flex gap-2.5">
        <AmoreSecondaryButton onClick={avisarProximamente} className="flex-1">
          Conectar WhatsApp
        </AmoreSecondaryButton>
        <AmoreSecondaryButton onClick={avisarProximamente} className="flex-1 !bg-danger !text-danger-text">
          Desconectar
        </AmoreSecondaryButton>
      </div>

      <div>
        <AmoreSectionTitle title="Uso de WhatsApp" />
        <AmoreCard className="mt-2.5 !p-0">
          {whatsappMock.uso.map((u, i) => (
            <div key={u.label}>
              <div className="flex items-center justify-between p-3.5">
                <p className="text-sm text-fg">{u.label}</p>
                <p className="text-sm font-semibold text-fg">{u.cantidad}</p>
              </div>
              {i < whatsappMock.uso.length - 1 && <AmoreDivider />}
            </div>
          ))}
        </AmoreCard>
      </div>
    </div>
  );
}
