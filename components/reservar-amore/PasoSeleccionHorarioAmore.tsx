"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { ServicioDelPortal } from "@/lib/reservar-amore-servicios";
import { FranjaServiciosAmore } from "./FranjaServiciosAmore";
import { ContinuarAmore, MarcoPasoAmore } from "./MarcoPasoAmore";
import { fechaDesdeISO, formatearFechaCorta, formatearFechaLarga, formatearHora12h, formatearMesAnio, sumarDias } from "./formato";
import { AMORE, serifAmore } from "./tema";

// AMORE (portal) — paso 3, «Elige tu horario». `horarios` son EXACTAMENTE los slots reales que devolvió /api/reservar/[tenant]/disponibilidad: con varios
// servicios, bloques CONTINUOS de la duración sumada, de la profesional elegida (jornada, bloqueos, citas y Google Calendar ya descontados). Esta pantalla NO
// calcula disponibilidad ni crea la cita, solo muestra lo que el backend ya resolvió. Al elegir la fecha, la lista de horas se desplaza sola a la vista.

const DIAS_LABEL = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

const esManana = (hhmm: string) => Number(hhmm.slice(0, 2)) < 12;

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
  const [inicioSemana, setInicioSemana] = useState(fecha ?? fechaMinima);
  const [horaSeleccionada, setHoraSeleccionada] = useState<string | null>(hora);

  const diasVisibles = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(inicioSemana, i)), [inicioSemana]);
  const puedeRetroceder = sumarDias(inicioSemana, -1) >= fechaMinima;
  const puedeAvanzar = sumarDias(inicioSemana, 7) <= fechaMaxima;

  function elegirDia(dia: string) {
    if (dia < fechaMinima || dia > fechaMaxima) return;
    setHoraSeleccionada(null);
    onSeleccionarFecha(dia);
  }

  // Con la fecha elegida (y las horas ya cargadas) la lista de horas se acerca sola a la vista, sin que haya que buscarla bajando.
  const horasRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (fecha && !cargandoHorarios) horasRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [fecha, cargandoHorarios]);

  const grupos = useMemo(
    () => [
      { nombre: "Mañana", horas: horarios.filter(esManana) },
      { nombre: "Tarde", horas: horarios.filter((h) => !esManana(h)) },
    ].filter((g) => g.horas.length > 0),
    [horarios],
  );

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

      <section className="mt-3 rounded-3xl p-4" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
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

      <section ref={horasRef} className="mt-3 scroll-mb-28 scroll-mt-20 rounded-3xl p-4" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
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
              No pudimos confirmar los horarios en este momento.
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
                    const seleccionado = h === horaSeleccionada;
                    return (
                      <button
                        key={h}
                        type="button"
                        aria-pressed={seleccionado}
                        onClick={() => setHoraSeleccionada(h)}
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
    </MarcoPasoAmore>
  );
}
