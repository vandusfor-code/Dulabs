"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, ChevronLeft, ShieldCheck, CalendarPlus, Clock, Heart } from "lucide-react";
import { cormorantGaramond, parisienne } from "@/lib/fonts-portal-daniela";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";

// Fase 8A.9 (autorizado) — SOLO esta pantalla ("Selecciona tu horario").
// Puramente de presentación: consume EXACTAMENTE lo que ya devuelve el
// flujo/motor existentes (servicio real, especialistaNombre YA resuelto por
// el endpoint único de la Fase 8A.8.1, y `horarios` = los slots reales que
// devolvió listarHorariosDisponiblesPorServicio vía
// /api/reservar/[tenant]/disponibilidad -- Fases 8A.5/8A.6, sin tocar).
// NO calcula disponibilidad, NO resuelve profesional, NO crea la cita --
// eso sigue pasando exactamente donde ya pasaba (page.tsx: cargarHorarios/
// elegirFecha/elegirHora, sin cambios de firma ni de comportamiento).
//
// El mockup combinaba fecha+hora en una sola pantalla (antes eran dos pasos
// separados, "fecha" y "horario") -- esta pantalla unifica la PRESENTACIÓN
// de ambos pasos existentes en un solo componente visual, llamando a los
// mismos handlers (onSeleccionarFecha = elegirFecha, onContinuar = elegirHora
// con la hora ya elegida localmente) sin crear ningún estado ni lógica de
// disponibilidad nueva.

type Servicio = {
  id: string;
  nombre: string;
  duracion_min: number;
  precio: number | null;
  imagen_url: string | null;
};

const ROSA = "#C94B78";
const ROSA_SUAVE = "#F8E8ED";
const ROSA_FONDO = "#FDF5F7";
const TEXTO = "#111111";
const TEXTO_SECUNDARIO = "#555555";
const BORDE = "#E8DDE1";
const VERDE = "#3FA96A";

const serif = { fontFamily: "var(--font-cormorant-daniela), 'Cormorant Garamond', serif" };

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
  const texto = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", weekday: "long", timeZone: "America/Bogota" }).format(
    fechaDesdeISO(fechaISO)
  );
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

export function PasoSeleccionHorario({
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
    <div className={`relative min-h-screen w-full ${cormorantGaramond.variable} ${parisienne.variable}`} style={{ backgroundColor: ROSA_FONDO }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-9">
        {/* Header */}
        <header className="flex items-center justify-between">
          <button type="button" onClick={onVolver} aria-label="Volver" className="flex size-9 items-center justify-center rounded-full" style={{ color: TEXTO }}>
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </button>
          <div className="flex flex-col items-center gap-0.5">
            <Heart className="size-3.5" style={{ color: ROSA }} strokeWidth={1.5} />
            <p className="text-[17px] font-semibold uppercase tracking-tight" style={{ ...serif, color: TEXTO }}>
              Daniela Manco
            </p>
            <p className="text-[9px] font-medium uppercase tracking-[0.25em]" style={{ color: TEXTO_SECUNDARIO }}>
              Nails Spa
            </p>
          </div>
          <span className="w-9" />
        </header>

        {/* Indicador de pasos -- refleja el estado REAL: 1 (servicio) completado, 2 (horario) activo */}
        <div className="mt-7 flex w-full items-start justify-between">
          {[
            { n: 1, label: "Servicio", estado: "completado" as const },
            { n: 2, label: "Horario", estado: "activo" as const },
            { n: 3, label: "Tus datos", estado: "pendiente" as const },
            { n: 4, label: "Confirmación", estado: "pendiente" as const },
          ].map((paso, i, arr) => (
            <div key={paso.n} className="contents">
              <div className="flex flex-col items-center gap-2">
                <div
                  className="flex size-9 items-center justify-center rounded-full text-[14px] font-semibold"
                  style={
                    paso.estado !== "pendiente"
                      ? { backgroundColor: ROSA, color: "#fff" }
                      : { backgroundColor: "#fff", color: TEXTO_SECUNDARIO, border: `1px solid ${BORDE}` }
                  }
                >
                  {paso.estado === "completado" ? <Check className="size-4" strokeWidth={2.5} /> : paso.n}
                </div>
                <span className="text-center text-[11px] font-medium leading-tight" style={{ color: paso.estado !== "pendiente" ? TEXTO : TEXTO_SECUNDARIO }}>
                  {paso.label}
                </span>
              </div>
              {i < arr.length - 1 && <div className="mt-4 h-px flex-1" style={{ backgroundColor: paso.estado === "completado" ? ROSA : BORDE }} />}
            </div>
          ))}
        </div>

        {/* Título */}
        <h1 className="mt-8 text-center text-[32px] font-semibold" style={{ ...serif, color: TEXTO }}>
          Selecciona tu horario
        </h1>
        <p className="mt-1 text-center text-[13.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          Elige la fecha y hora que mejor se adapte a ti.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <span className="h-px w-14" style={{ backgroundColor: ROSA }} />
          <Heart className="size-3.5 shrink-0" style={{ color: ROSA }} strokeWidth={1.5} />
          <span className="h-px w-14" style={{ backgroundColor: ROSA }} />
        </div>

        {/* Calendario */}
        <div className="mt-6 rounded-[32px] p-5" style={{ backgroundColor: "rgba(255,255,255,0.94)", boxShadow: "0 20px 60px -30px rgba(201,75,120,0.25)" }}>
          <div className="flex items-center gap-2">
            <CalendarPlus className="size-5" style={{ color: ROSA }} strokeWidth={1.6} />
            <span className="text-[14px] font-semibold" style={{ color: TEXTO }}>
              Selecciona una fecha
            </span>
          </div>
          <p className="mt-3 text-[15px] font-medium" style={{ ...serif, color: TEXTO }}>
            {formatearMesAnio(inicioSemana)}
          </p>

          <div className="mt-3 flex items-center gap-1">
            <button
              type="button"
              onClick={() => puedeRetroceder && setInicioSemana(sumarDias(inicioSemana, -7))}
              disabled={!puedeRetroceder}
              aria-label="Semana anterior"
              className="flex size-7 shrink-0 items-center justify-center disabled:opacity-25"
              style={{ color: ROSA }}
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
                    style={{ backgroundColor: seleccionado ? ROSA_SUAVE : "transparent" }}
                  >
                    <span className="text-[10px] font-semibold uppercase" style={{ color: seleccionado ? ROSA : TEXTO_SECUNDARIO }}>
                      {DIAS_LABEL[d.getUTCDay()]}
                    </span>
                    <span
                      className="flex size-7 items-center justify-center rounded-full text-[13px] font-semibold"
                      style={seleccionado ? { backgroundColor: ROSA, color: "#fff" } : { color: TEXTO }}
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
              style={{ color: ROSA }}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>

        {/* Horarios */}
        <div className="mt-4 rounded-[32px] p-5" style={{ backgroundColor: "rgba(255,255,255,0.94)", boxShadow: "0 20px 60px -30px rgba(201,75,120,0.25)" }}>
          <div className="flex items-center gap-2">
            <Clock className="size-5" style={{ color: ROSA }} strokeWidth={1.6} />
            <div>
              <p className="text-[14px] font-semibold" style={{ color: TEXTO }}>
                Horarios disponibles
              </p>
              {fecha && (
                <p className="text-[12px]" style={{ color: TEXTO_SECUNDARIO }}>
                  {formatearFechaLarga(fecha)}
                </p>
              )}
            </div>
          </div>

          {!fecha ? (
            <p className="mt-4 text-center text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>
              Elige una fecha para ver los horarios reales.
            </p>
          ) : cargandoHorarios ? (
            <p className="mt-4 text-center text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>
              Consultando horarios reales...
            </p>
          ) : horarios.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 text-center">
              <p className="text-[13.5px]" style={{ color: TEXTO_SECUNDARIO }}>
                No encontramos horarios disponibles para esta fecha.
              </p>
              <p className="text-[12.5px] font-medium" style={{ color: ROSA }}>
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
                    style={{ backgroundColor: seleccionado ? ROSA_SUAVE : "#fff", border: `1.5px solid ${seleccionado ? ROSA : BORDE}` }}
                  >
                    <span className="text-[13px] font-medium" style={{ color: TEXTO }}>
                      {formatearHora12h(h)}
                    </span>
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: seleccionado ? ROSA : VERDE }} />
                  </button>
                );
              })}
            </div>
          )}

          {horarios.length > 0 && (
            <div className="mt-4 flex items-center justify-center gap-4 text-[11px]" style={{ color: TEXTO_SECUNDARIO }}>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: VERDE }} /> Disponible
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: ROSA }} /> Seleccionado
              </span>
            </div>
          )}
        </div>

        {/* Resumen del servicio real */}
        <div className="mt-4 flex items-center gap-3 rounded-2xl p-3.5" style={{ backgroundColor: ROSA_SUAVE }}>
          {servicio.imagen_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={servicio.imagen_url} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: "#fff" }}>
              <CalendarPlus className="size-6" style={{ color: ROSA }} strokeWidth={1.5} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold" style={{ color: TEXTO }}>
              {servicio.nombre}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" strokeWidth={1.6} />
                {formatearDuracion(servicio.duracion_min)}
              </span>
              {servicio.precio != null && (
                <span className="font-semibold" style={{ color: ROSA }}>
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
          className="mt-5 flex w-full items-center justify-center gap-2 py-4 text-[16px] font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: ROSA, borderRadius: 32 }}
        >
          Continuar
          <ChevronRight className="size-5" strokeWidth={2} />
        </button>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          <ShieldCheck className="size-3.5" style={{ color: ROSA }} strokeWidth={1.5} />
          <span className="text-[11.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            Tus datos están protegidos
          </span>
        </div>
      </div>
    </div>
  );
}
