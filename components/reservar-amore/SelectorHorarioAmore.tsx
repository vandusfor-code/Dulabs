"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { fechaDesdeISO, formatearFechaLarga, formatearHora12h, formatearMesAnio, sumarDias } from "./formato";
import { AMORE, serifAmore } from "./tema";

// AMORE — selector de fecha y hora compartido por el portal de reservas («Elige tu horario») y por «Mi cita» («Elige tu nuevo horario»): una semana de 7 días
// (con flechas para cambiar de semana) y, debajo, las horas del día elegido agrupadas en mañana/tarde. Las horas son EXACTAMENTE las que devolvió el backend (con
// Google Calendar ya descontado): este componente no calcula disponibilidad. Es CONTROLADO: la fecha y la hora elegidas viven en la pantalla que lo usa. Al elegir
// la fecha (y cargar sus horas) la lista de horas se acerca sola a la vista.

const DIAS_LABEL = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

const esManana = (hhmm: string) => Number(hhmm.slice(0, 2)) < 12;

export function SelectorHorarioAmore({
  fecha,
  hora,
  fechaMinima,
  fechaMaxima,
  horarios,
  cargandoHorarios,
  errorHorarios,
  onSeleccionarFecha,
  onSeleccionarHora,
  onReintentar,
}: {
  fecha: string | null;
  hora: string | null;
  fechaMinima: string;
  fechaMaxima: string;
  horarios: string[];
  cargandoHorarios: boolean;
  /** Texto cuando NO se pudieron consultar las horas (sin conexión, Google Calendar sin confirmar…): se distingue de «no hay horarios». null = sin error. */
  errorHorarios: string | null;
  onSeleccionarFecha: (fecha: string) => void;
  onSeleccionarHora: (hora: string) => void;
  onReintentar: () => void;
}) {
  const [inicioSemana, setInicioSemana] = useState(fecha ?? fechaMinima);

  const diasVisibles = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(inicioSemana, i)), [inicioSemana]);
  const puedeRetroceder = sumarDias(inicioSemana, -1) >= fechaMinima;
  const puedeAvanzar = sumarDias(inicioSemana, 7) <= fechaMaxima;

  function elegirDia(dia: string) {
    if (dia < fechaMinima || dia > fechaMaxima) return;
    onSeleccionarFecha(dia);
  }

  // Con la fecha elegida (y las horas ya cargadas) la lista de horas se acerca sola a la vista, sin que haya que buscarla bajando.
  const horasRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (fecha && !cargandoHorarios) horasRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [fecha, cargandoHorarios]);

  const grupos = useMemo(
    () =>
      [
        { nombre: "Mañana", horas: horarios.filter(esManana) },
        { nombre: "Tarde", horas: horarios.filter((h) => !esManana(h)) },
      ].filter((g) => g.horas.length > 0),
    [horarios],
  );

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-3xl p-4" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarPlus className="size-5" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
            <span className="text-[15px] font-medium" style={{ ...serifAmore, color: AMORE.texto }}>
              {formatearMesAnio(inicioSemana)}
            </span>
          </div>
          <div className="-mr-2 flex items-center">
            <button
              type="button"
              onClick={() => puedeRetroceder && setInicioSemana(sumarDias(inicioSemana, -7))}
              disabled={!puedeRetroceder}
              aria-label="Semana anterior"
              className="flex size-10 items-center justify-center rounded-full disabled:opacity-25"
              style={{ color: AMORE.burdeos }}
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => puedeAvanzar && setInicioSemana(sumarDias(inicioSemana, 7))}
              disabled={!puedeAvanzar}
              aria-label="Semana siguiente"
              className="flex size-10 items-center justify-center rounded-full disabled:opacity-25"
              style={{ color: AMORE.burdeos }}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1">
          {diasVisibles.map((dia) => {
            const fueraDeRango = dia < fechaMinima || dia > fechaMaxima;
            const seleccionado = dia === fecha;
            const d = fechaDesdeISO(dia);
            return (
              <button
                key={dia}
                type="button"
                disabled={fueraDeRango}
                aria-pressed={seleccionado}
                aria-label={formatearFechaLarga(dia)}
                onClick={() => elegirDia(dia)}
                className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl py-1.5 disabled:opacity-30"
                style={{ backgroundColor: seleccionado ? AMORE.burdeosSuave : "transparent" }}
              >
                <span className="text-[10px] font-semibold uppercase" style={{ color: seleccionado ? AMORE.burdeos : AMORE.textoSecundario }}>
                  {DIAS_LABEL[d.getUTCDay()]}
                </span>
                <span
                  className="flex size-8 items-center justify-center rounded-full text-[14px] font-semibold"
                  style={seleccionado ? { backgroundColor: AMORE.burdeos, color: "#fff" } : { color: AMORE.texto }}
                >
                  {d.getUTCDate()}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section ref={horasRef} className="scroll-mb-28 scroll-mt-20 rounded-3xl p-4" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
        <div className="flex items-center gap-2">
          <Clock className="size-5 shrink-0" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
          <div>
            <p className="text-[14px] font-semibold" style={{ color: AMORE.texto }}>
              Horas disponibles
            </p>
            {fecha && (
              <p className="text-[12px]" style={{ color: AMORE.textoSecundario }}>
                {formatearFechaLarga(fecha)}
              </p>
            )}
          </div>
        </div>

        {!fecha ? (
          <p className="mt-3 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
            Elige una fecha para ver las horas disponibles.
          </p>
        ) : cargandoHorarios ? (
          <p className="mt-3 text-center text-[13px]" style={{ color: AMORE.textoSecundario }} role="status">
            Consultando horarios reales...
          </p>
        ) : errorHorarios ? (
          <div className="mt-3 flex flex-col items-center gap-2.5 text-center">
            <p className="text-[13px]" style={{ color: AMORE.textoSecundario }}>
              {errorHorarios}
            </p>
            <button type="button" onClick={onReintentar} className="h-10 rounded-full px-5 text-[13.5px] font-semibold text-white" style={{ backgroundColor: AMORE.burdeos }}>
              Reintentar
            </button>
          </div>
        ) : horarios.length === 0 ? (
          <div className="mt-3 flex flex-col items-center gap-1.5 text-center">
            <p className="text-[13px]" style={{ color: AMORE.textoSecundario }}>
              No encontramos horarios disponibles para esta fecha.
            </p>
            <p className="text-[12px] font-medium" style={{ color: AMORE.burdeos }}>
              Elige otra fecha en el calendario de arriba.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {grupos.map((grupo) => (
              <div key={grupo.nombre}>
                {grupos.length > 1 && (
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: AMORE.textoSecundario }}>
                    {grupo.nombre}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2">
                  {grupo.horas.map((h) => {
                    const seleccionado = h === hora;
                    return (
                      <button
                        key={h}
                        type="button"
                        aria-pressed={seleccionado}
                        onClick={() => onSeleccionarHora(h)}
                        className="h-11 rounded-xl text-[13.5px] font-medium"
                        style={seleccionado ? { backgroundColor: AMORE.burdeos, color: "#fff", border: `1.5px solid ${AMORE.burdeos}` } : { backgroundColor: "#fff", color: AMORE.texto, border: `1.5px solid ${AMORE.borde}` }}
                      >
                        {formatearHora12h(h)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
