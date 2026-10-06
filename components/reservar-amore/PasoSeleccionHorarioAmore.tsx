"use client";

import { useState } from "react";
import type { ServicioDelPortal } from "@/lib/reservar-amore-servicios";
import { FranjaServiciosAmore } from "./FranjaServiciosAmore";
import { ContinuarAmore, MarcoPasoAmore } from "./MarcoPasoAmore";
import { SelectorHorarioAmore } from "./SelectorHorarioAmore";
import { formatearFechaCorta, formatearHora12h } from "./formato";
import { AMORE } from "./tema";

// AMORE (portal) — paso 3, «Elige tu horario». `horarios` son EXACTAMENTE los slots reales que devolvió /api/reservar/[tenant]/disponibilidad: con varios
// servicios, bloques CONTINUOS de la duración sumada, de la profesional elegida (jornada, bloqueos, citas y Google Calendar ya descontados). Esta pantalla NO
// calcula disponibilidad ni crea la cita, solo muestra lo que el backend ya resolvió (el selector de fecha y hora es el mismo de «Mi cita»).

export function PasoSeleccionHorarioAmore({
  negocio,
  servicios,
  especialistaNombre,
  fecha,
  hora,
  fechaMinima,
  fechaMaxima,
  horarios,
  cargandoHorarios,
  errorHorarios,
  onSeleccionarFecha,
  onReintentar,
  onContinuar,
  onVolver,
}: {
  negocio: string;
  servicios: Pick<ServicioDelPortal, "nombre" | "duracion_min" | "precio">[];
  especialistaNombre: string | null;
  fecha: string | null;
  /** Hora ya elegida antes (al volver desde un paso posterior). */
  hora: string | null;
  fechaMinima: string;
  fechaMaxima: string;
  horarios: string[];
  cargandoHorarios: boolean;
  /** No se pudo consultar (sin conexión, o Google Calendar no confirmó): se distingue de «no hay horarios». */
  errorHorarios: boolean;
  onSeleccionarFecha: (fecha: string) => void;
  onReintentar: () => void;
  onContinuar: (hora: string) => void;
  onVolver: () => void;
}) {
  const [horaSeleccionada, setHoraSeleccionada] = useState<string | null>(hora);

  const accion = (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1" aria-live="polite">
        {fecha && horaSeleccionada ? (
          <>
            <p className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
              {formatearFechaCorta(fecha)}
            </p>
            <p className="text-[12px]" style={{ color: AMORE.textoSecundario }}>
              {formatearHora12h(horaSeleccionada)}
            </p>
          </>
        ) : (
          <p className="text-[12.5px] leading-snug" style={{ color: AMORE.textoSecundario }}>
            Elige una fecha y una hora
          </p>
        )}
      </div>
      <ContinuarAmore disabled={!fecha || !horaSeleccionada} onClick={() => horaSeleccionada && onContinuar(horaSeleccionada)} />
    </div>
  );

  return (
    <MarcoPasoAmore negocio={negocio} onVolver={onVolver} paso={3} titulo="Elige tu horario" accion={accion}>
      <FranjaServiciosAmore servicios={servicios} especialistaNombre={especialistaNombre} />

      <div className="mt-3">
        <SelectorHorarioAmore
          fecha={fecha}
          hora={horaSeleccionada}
          fechaMinima={fechaMinima}
          fechaMaxima={fechaMaxima}
          horarios={horarios}
          cargandoHorarios={cargandoHorarios}
          errorHorarios={errorHorarios ? "No pudimos confirmar los horarios en este momento." : null}
          onSeleccionarFecha={(dia) => {
            setHoraSeleccionada(null);
            onSeleccionarFecha(dia);
          }}
          onSeleccionarHora={setHoraSeleccionada}
          onReintentar={onReintentar}
        />
      </div>
    </MarcoPasoAmore>
  );
}
