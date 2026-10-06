"use client";

import { Check, ChevronRight, Loader2, User } from "lucide-react";
import type { ServicioDelPortal } from "@/lib/reservar-amore-servicios";
import { FranjaServiciosAmore } from "./FranjaServiciosAmore";
import { MarcoPasoAmore } from "./MarcoPasoAmore";
import { AMORE } from "./tema";

// AMORE (portal) — paso 2, «Elige tu profesional». `especialistas` es EXACTAMENTE la lista real y ya filtrada que devuelve
// /api/reservar/[tenant]/especialistas: con varios servicios, solo las profesionales que hacen TODOS (una misma persona atiende la cita completa). Esta
// pantalla no calcula elegibilidad, solo la muestra. Tocar a una profesional avanza solo: no hay botón «Continuar» que buscar.

type EspecialistaOpcion = { id: number; nombre: string };

export function PasoSeleccionProfesionalAmore({
  negocio,
  servicios,
  especialistas,
  cargando,
  errorCarga,
  sinProfesionalComun,
  especialistaSeleccionadoId,
  onElegir,
  onReintentar,
  onCambiarServicios,
  onVolver,
}: {
  negocio: string;
  servicios: Pick<ServicioDelPortal, "nombre" | "duracion_min" | "precio">[];
  especialistas: EspecialistaOpcion[];
  cargando: boolean;
  /** No se pudo consultar (sin conexión, error del servidor): se distingue de «no hay profesionales». */
  errorCarga: boolean;
  /** Hay varios servicios y ninguna profesional los hace todos juntos. */
  sinProfesionalComun: boolean;
  especialistaSeleccionadoId: number | null;
  onElegir: (e: EspecialistaOpcion) => void;
  onReintentar: () => void;
  onCambiarServicios: () => void;
  onVolver: () => void;
}) {
  const varios = servicios.length > 1;

  return (
    <MarcoPasoAmore
      negocio={negocio}
      onVolver={onVolver}
      paso={2}
      titulo="Elige tu profesional"
      subtitulo={varios ? "Una misma profesional atenderá todos tus servicios." : "¿Con quién prefieres tu cita?"}
    >
      <FranjaServiciosAmore servicios={servicios} />

      <div className="mt-4 flex flex-col gap-3">
        {cargando ? (
          <div className="flex justify-center py-10" role="status" aria-label="Buscando profesionales">
            <Loader2 className="size-5 animate-spin" style={{ color: AMORE.textoSecundario }} />
          </div>
        ) : errorCarga ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl px-4 py-6 text-center" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
            <p className="text-[13.5px]" style={{ color: AMORE.textoSecundario }}>
              No pudimos consultar las profesionales. Verifica tu conexión e intenta de nuevo.
            </p>
            <button type="button" onClick={onReintentar} className="h-11 rounded-full px-6 text-[14px] font-semibold text-white" style={{ backgroundColor: AMORE.burdeos }}>
              Reintentar
            </button>
          </div>
        ) : especialistas.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl px-4 py-6 text-center" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
            <p className="text-[13.5px] leading-relaxed" style={{ color: AMORE.textoSecundario }}>
              {sinProfesionalComun
                ? "Ninguna profesional realiza todos estos servicios en una misma cita. Cambia tu selección o reserva cada servicio por separado."
                : "No hay profesionales disponibles para este servicio en este momento."}
            </p>
            <button type="button" onClick={onCambiarServicios} className="h-11 rounded-full px-6 text-[14px] font-semibold text-white" style={{ backgroundColor: AMORE.burdeos }}>
              Cambiar servicios
            </button>
          </div>
        ) : (
          especialistas.map((e) => {
            const seleccionada = e.id === especialistaSeleccionadoId;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onElegir(e)}
                className="flex min-h-[64px] items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors active:scale-[0.99]"
                style={{ backgroundColor: seleccionada ? AMORE.burdeosSuave : "#fff", border: `1.5px solid ${seleccionada ? AMORE.burdeos : AMORE.borde}` }}
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.doradoSuave }}>
                  <User className="size-5" style={{ color: AMORE.dorado }} strokeWidth={1.6} />
                </div>
                <span className="flex-1 text-[15px] font-semibold" style={{ color: AMORE.texto }}>
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
    </MarcoPasoAmore>
  );
}
