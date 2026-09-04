"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, ChevronLeft, ShieldCheck, CalendarPlus, Clock } from "lucide-react";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { PortalHeaderAmore } from "./PortalHeaderAmore";
import { AMORE, serifAmore } from "./tema";

// AMORE (Fase 3 del portal, autorizado) — SOLO esta pantalla ("Selecciona
// tu horario"). `horarios` son EXACTAMENTE los slots reales que devolvió
// listarHorariosDisponiblesPorServicio vía /api/reservar/[tenant]/disponibilidad
// -- ya respeta jornada de la profesional, duración del servicio, bloqueos
// y citas existentes. Esta pantalla NO calcula disponibilidad ni crea la
// cita, solo muestra lo que el backend ya resolvió.

type Servicio = { id: string; nombre: string; duracion_min: number; precio: number | null };

const DIAS_LABEL = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

function fechaDesdeISO(fechaISO: string): Date {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
function isoDesdeFecha(f: Date): string {
  return f.toISOString().slice(0, 10);
}
function sumarDias(fechaISO: string, n: number): string {
  const f = fechaDesdeISO(fechaISO);
  f.setUTCDate(f.getUTCDate() + n);
  return isoDesdeFecha(f);
}
function formatearMesAnio(fechaISO: string): string {
  const texto = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "America/Bogota" }).format(fechaDesdeISO(fechaISO));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
function formatearFechaLarga(fechaISO: string): string {
  const texto = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", weekday: "long", timeZone: "America/Bogota" }).format(fechaDesdeISO(fechaISO));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
function formatearHora12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const periodo = h >= 12 ? "p. m." : "a. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${periodo}`;
}
function formatearDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const minutos = min % 60;
  return minutos === 0 ? `${horas} h` : `${horas} h ${minutos} min`;
}

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

export function PasoSeleccionHorarioAmore({
  negocio,
  servicio,
  especialistaNombre,
  fecha,
  fechaMinima,
  fechaMaxima,
  horarios,
  cargandoHorarios,
  onSeleccionarFecha,
  onContinuar,
  onVolver,
}: {
  negocio: string;
  servicio: Servicio;
  especialistaNombre: string | null;
  fecha: string | null;
  fechaMinima: string;
  fechaMaxima: string;
  horarios: string[];
  cargandoHorarios: boolean;
  onSeleccionarFecha: (fecha: string) => void;
  onContinuar: (hora: string) => void;
  onVolver: () => void;
}) {
  const [inicioSemana, setInicioSemana] = useState(fecha ?? fechaMinima);
  const [horaSeleccionada, setHoraSeleccionada] = useState<string | null>(null);

  const diasVisibles = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(inicioSemana, i)), [inicioSemana]);
  const puedeRetroceder = sumarDias(inicioSemana, -7) >= fechaMinima || diasVisibles.some((d) => d > fechaMinima && d <= fechaMaxima);
  const puedeAvanzar = sumarDias(inicioSemana, 7) <= fechaMaxima;

  function elegirDia(dia: string) {
    if (dia < fechaMinima || dia > fechaMaxima) return;
    setHoraSeleccionada(null);
    onSeleccionarFecha(dia);
  }

  return (
    <div className={`relative min-h-screen w-full ${playfairDisplay.variable}`} style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-8">
        <PortalHeaderAmore negocio={negocio} onVolver={onVolver} />

        <div className="mt-6 flex w-full items-start justify-between">
          {[
            { n: 1, label: "Servicio", estado: "completado" as const },
            { n: 2, label: "Profesional", estado: "completado" as const },
            { n: 3, label: "Horario", estado: "activo" as const },
            { n: 4, label: "Datos", estado: "pendiente" as const },
            { n: 5, label: "Listo", estado: "pendiente" as const },
          ].map((paso, i, arr) => (
            <div key={paso.n} className="contents">
              <PasoIndicador estado={paso.estado} numero={paso.n} label={paso.label} />
              {i < arr.length - 1 && <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: paso.estado === "completado" ? AMORE.burdeos : AMORE.borde }} />}
            </div>
          ))}
        </div>

        <h1 className="mt-7 text-center text-[27px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
          Selecciona tu horario
        </h1>
        <p className="mt-1 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
          Elige la fecha y hora que mejor te convenga.
        </p>

        <div className="mt-6 rounded-[28px] p-5" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
          <div className="flex items-center gap-2">
            <CalendarPlus className="size-5" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
            <span className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
              Selecciona una fecha
            </span>
          </div>
          <p className="mt-2.5 text-[15px] font-medium" style={{ ...serifAmore, color: AMORE.texto }}>
            {formatearMesAnio(inicioSemana)}
          </p>

          <div className="mt-3 flex items-center gap-1">
            <button
              type="button"
              onClick={() => puedeRetroceder && setInicioSemana(sumarDias(inicioSemana, -7))}
              disabled={!puedeRetroceder}
              aria-label="Semana anterior"
              className="flex size-7 shrink-0 items-center justify-center disabled:opacity-25"
              style={{ color: AMORE.burdeos }}
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="grid flex-1 grid-cols-7 gap-1">
              {diasVisibles.map((dia) => {
                const fueraDeRango = dia < fechaMinima || dia > fechaMaxima;
                const seleccionado = dia === fecha;
                const d = fechaDesdeISO(dia);
                return (
                  <button
                    key={dia}
                    type="button"
                    disabled={fueraDeRango}
                    onClick={() => elegirDia(dia)}
                    className="flex flex-col items-center gap-1 rounded-xl py-2 disabled:opacity-30"
                    style={{ backgroundColor: seleccionado ? AMORE.burdeosSuave : "transparent" }}
                  >
                    <span className="text-[10px] font-semibold uppercase" style={{ color: seleccionado ? AMORE.burdeos : AMORE.textoSecundario }}>
                      {DIAS_LABEL[d.getUTCDay()]}
                    </span>
                    <span
                      className="flex size-7 items-center justify-center rounded-full text-[13px] font-semibold"
                      style={seleccionado ? { backgroundColor: AMORE.burdeos, color: "#fff" } : { color: AMORE.texto }}
                    >
                      {d.getUTCDate()}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => puedeAvanzar && setInicioSemana(sumarDias(inicioSemana, 7))}
              disabled={!puedeAvanzar}
              aria-label="Semana siguiente"
              className="flex size-7 shrink-0 items-center justify-center disabled:opacity-25"
              style={{ color: AMORE.burdeos }}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-[28px] p-5" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
          <div className="flex items-center gap-2">
            <Clock className="size-5" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
            <div>
              <p className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
                Horarios disponibles
              </p>
              {fecha && (
                <p className="text-[11.5px]" style={{ color: AMORE.textoSecundario }}>
                  {formatearFechaLarga(fecha)}
                </p>
              )}
            </div>
          </div>

          {!fecha ? (
            <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
              Elige una fecha para ver los horarios reales.
            </p>
          ) : cargandoHorarios ? (
            <p className="mt-4 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
              Consultando horarios reales...
            </p>
          ) : horarios.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 text-center">
              <p className="text-[13px]" style={{ color: AMORE.textoSecundario }}>
                No encontramos horarios disponibles para esta fecha.
              </p>
              <p className="text-[12px] font-medium" style={{ color: AMORE.burdeos }}>
                Elige otra fecha en el calendario de arriba.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {horarios.map((h) => {
                const seleccionado = h === horaSeleccionada;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHoraSeleccionada(h)}
                    className="flex flex-col items-center gap-1 rounded-xl py-2.5"
                    style={{ backgroundColor: seleccionado ? AMORE.burdeosSuave : "#fff", border: `1.5px solid ${seleccionado ? AMORE.burdeos : AMORE.borde}` }}
                  >
                    <span className="text-[13px] font-medium" style={{ color: AMORE.texto }}>
                      {formatearHora12h(h)}
                    </span>
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: seleccionado ? AMORE.burdeos : AMORE.verde }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-2xl p-3.5" style={{ backgroundColor: AMORE.doradoSuave }}>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: "#fff" }}>
            <CalendarPlus className="size-5" style={{ color: AMORE.burdeos }} strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold" style={{ color: AMORE.texto }}>
              {servicio.nombre}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]" style={{ color: AMORE.textoSecundario }}>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" strokeWidth={1.6} />
                {formatearDuracion(servicio.duracion_min)}
              </span>
              {servicio.precio != null && (
                <span className="font-semibold" style={{ color: AMORE.burdeos }}>
                  {formatearPrecioCop(servicio.precio)}
                </span>
              )}
              {especialistaNombre && <span>{especialistaNombre}</span>}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!fecha || !horaSeleccionada}
          onClick={() => horaSeleccionada && onContinuar(horaSeleccionada)}
          className="mt-5 flex w-full items-center justify-center gap-2 py-4 text-[15.5px] font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: AMORE.burdeos, borderRadius: 999 }}
        >
          Continuar
          <ChevronRight className="size-5" strokeWidth={2} />
        </button>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          <ShieldCheck className="size-3.5" style={{ color: AMORE.dorado }} strokeWidth={1.5} />
          <span className="text-[11px]" style={{ color: AMORE.textoSecundario }}>
            Tus datos están protegidos
          </span>
        </div>
      </div>
    </div>
  );
}
