"use client";

import { useState } from "react";
import { Cake, MessageCircle } from "lucide-react";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreSegmentedTabs, AmoreAvatar, AmoreEmptyState, AmoreSwitch } from "@/components/spa-panel/amore/ui";
import { useAmoreUi } from "@/components/spa-panel/amore/AmoreUiContext";
import { birthdaysMock, cumpleanosConfigMock } from "@/components/spa-panel/amore/amore-cumpleanos-mock";

type Filtro = "hoy" | "semana" | "mes";

// AMORE (Fase 5, diseño visual completo, autorizado) — SOLO diseño visual.
// Los cumpleaños mostrados son mock (ver amore-cumpleanos-mock.ts); el
// día/mes real de cada clienta ya vive en dulabs_clientes_conocidos, pero
// conectar esta pantalla a ese dato y automatizar el envío es lógica
// funcional para una fase posterior. Ningún mensaje se envía aquí.
export default function CumpleanosPage() {
  return (
    <AmoreOnlyScreen>
      <CumpleanosContenido />
    </AmoreOnlyScreen>
  );
}

function CumpleanosContenido() {
  const { avisarProximamente } = useAmoreUi();
  const [filtro, setFiltro] = useState<Filtro>("hoy");
  const [activo, setActivo] = useState(cumpleanosConfigMock.activo);

  const deHoy = birthdaysMock.filter((c) => c.esHoy);
  const proximos = birthdaysMock.filter((c) => !c.esHoy);

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Cumpleaños" subtitle="Detecta los cumpleaños de tus clientas" />

      <AmoreSegmentedTabs
        opciones={[
          { valor: "hoy", etiqueta: "Hoy" },
          { valor: "semana", etiqueta: "Esta semana" },
          { valor: "mes", etiqueta: "Este mes" },
        ]}
        activo={filtro}
        onChange={setFiltro}
      />

      <div>
        <AmoreSectionTitle title="Cumpleaños de hoy" />
        <div className="mt-2.5 flex flex-col gap-2.5">
          {deHoy.length === 0 ? (
            <AmoreEmptyState icono={<Cake className="size-6 text-mist" />} mensaje="Nadie cumple años hoy." />
          ) : (
            deHoy.map((c) => (
              <AmoreCard key={c.id} className="flex items-center gap-3 p-3.5">
                <AmoreAvatar nombre={c.nombre} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{c.nombre}</p>
                  <p className="truncate text-xs text-mist">{c.fecha}</p>
                </div>
                <button
                  type="button"
                  onClick={avisarProximamente}
                  aria-label="Enviar mensaje"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime-soft text-lime-text"
                >
                  <MessageCircle className="size-4" />
                </button>
              </AmoreCard>
            ))
          )}
        </div>
      </div>

      {(filtro === "semana" || filtro === "mes") && proximos.length > 0 && (
        <div>
          <AmoreSectionTitle title="Próximos cumpleaños" />
          <div className="mt-2.5 flex flex-col gap-2.5">
            {proximos.map((c) => (
              <AmoreCard key={c.id} className="flex items-center gap-3 p-3.5">
                <AmoreAvatar nombre={c.nombre} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{c.nombre}</p>
                  <p className="truncate text-xs text-mist">{c.fecha}</p>
                </div>
                <button
                  type="button"
                  onClick={avisarProximamente}
                  aria-label="Enviar mensaje"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime-soft text-lime-text"
                >
                  <MessageCircle className="size-4" />
                </button>
              </AmoreCard>
            ))}
          </div>
        </div>
      )}

      <AmoreCard>
        <AmoreSectionTitle title="Configuración de cumpleaños" />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-fg">Enviar mensaje automático</p>
            <p className="text-xs text-mist">Próximamente se enviará por WhatsApp</p>
          </div>
          <AmoreSwitch activo={activo} onChange={setActivo} />
        </div>
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-mist">Mensaje</p>
          <p className="rounded-2xl border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg">{cumpleanosConfigMock.mensaje}</p>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs font-medium text-mist">Hora de envío</p>
          <span className="rounded-full border border-edge bg-ink px-3 py-1.5 text-sm font-medium text-fg">{cumpleanosConfigMock.horaEnvio}</span>
        </div>
      </AmoreCard>
    </div>
  );
}
