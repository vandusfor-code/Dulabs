"use client";

import { Check, ChevronRight, Loader2, User } from "lucide-react";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { PortalHeaderAmore } from "./PortalHeaderAmore";
import { AMORE, serifAmore } from "./tema";

// AMORE (Fase 3 del portal, autorizado) — SOLO esta pantalla ("Selecciona
// tu profesional"). `especialistas` es EXACTAMENTE la lista real y ya
// filtrada que devuelve /api/reservar/[tenant]/especialistas
// (resolverEspecialistasElegiblesParaServicio -- respeta dulabs_servicio_especialista,
// nunca decide "quién puede" por su cuenta). Esta pantalla no calcula
// elegibilidad, solo la muestra.

type EspecialistaOpcion = { id: number; nombre: string };

function PasoIndicador({ estado, numero, label }: { estado: "completado" | "activo" | "pendiente"; numero: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="flex size-8 items-center justify-center rounded-full text-[13px] font-semibold"
        style={
          estado !== "pendiente"
            ? { backgroundColor: AMORE.burdeos, color: "#fff" }
            : { backgroundColor: "#fff", color: AMORE.textoSecundario, border: `1px solid ${AMORE.borde}` }
        }
      >
        {estado === "completado" ? <Check className="size-3.5" strokeWidth={2.5} /> : numero}
      </div>
      <span className="text-center text-[10px] font-medium leading-tight" style={{ color: estado !== "pendiente" ? AMORE.texto : AMORE.textoSecundario }}>
        {label}
      </span>
    </div>
  );
}

export function PasoSeleccionProfesionalAmore({
  negocio,
  servicioNombre,
  especialistas,
  cargando,
  especialistaSeleccionadoId,
  onElegir,
  onVolver,
}: {
  negocio: string;
  servicioNombre: string;
  especialistas: EspecialistaOpcion[];
  cargando: boolean;
  especialistaSeleccionadoId: number | null;
  onElegir: (e: EspecialistaOpcion) => void;
  onVolver: () => void;
}) {
  return (
    <div className={`relative min-h-screen w-full ${playfairDisplay.variable}`} style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-8">
        <PortalHeaderAmore negocio={negocio} onVolver={onVolver} />

        <div className="mt-6 flex w-full items-start justify-between">
          <PasoIndicador estado="completado" numero={1} label="Servicio" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.burdeos }} />
          <PasoIndicador estado="activo" numero={2} label="Profesional" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
          <PasoIndicador estado="pendiente" numero={3} label="Horario" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
          <PasoIndicador estado="pendiente" numero={4} label="Datos" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
          <PasoIndicador estado="pendiente" numero={5} label="Listo" />
        </div>

        <h1 className="mt-7 text-center text-[27px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
          Selecciona tu profesional
        </h1>
        <p className="mt-1 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
          ¿Con quién prefieres tu {servicioNombre.toLowerCase()}?
        </p>

        <div className="mt-7 flex flex-col gap-3">
          {cargando ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin" style={{ color: AMORE.textoSecundario }} />
            </div>
          ) : especialistas.length === 0 ? (
            <p className="text-center text-[13.5px]" style={{ color: AMORE.textoSecundario }}>
              No hay profesionales disponibles para este servicio en este momento.
            </p>
          ) : (
            especialistas.map((e) => {
              const seleccionada = e.id === especialistaSeleccionadoId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onElegir(e)}
                  className="flex items-center gap-3 rounded-2xl p-4 text-left transition-colors"
                  style={{ backgroundColor: seleccionada ? AMORE.burdeosSuave : "#fff", border: `1.5px solid ${seleccionada ? AMORE.burdeos : AMORE.borde}` }}
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.doradoSuave }}>
                    <User className="size-5" style={{ color: AMORE.dorado }} strokeWidth={1.6} />
                  </div>
                  <span className="flex-1 text-[14.5px] font-semibold" style={{ color: AMORE.texto }}>
                    {e.nombre}
                  </span>
                  {seleccionada ? (
                    <div className="flex size-6 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.burdeos }}>
                      <Check className="size-3.5 text-white" strokeWidth={2.5} />
                    </div>
                  ) : (
                    <ChevronRight className="size-5" style={{ color: AMORE.borde }} />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
