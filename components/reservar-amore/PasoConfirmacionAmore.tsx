"use client";

import { ChevronRight, Loader2, User, CalendarPlus, Clock } from "lucide-react";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { PortalHeaderAmore } from "./PortalHeaderAmore";
import { AMORE, serifAmore } from "./tema";

// AMORE (Fase 3 del portal, autorizado) — SOLO esta pantalla ("Confirma tu
// cita"). Muestra el resumen REAL ya resuelto por los pasos anteriores y
// llama a `onConfirmar` -- el MISMO handler de page.tsx que hace el POST
// único a app/api/reservar/[tenant]/route.ts (reservarCitaPorServicio).
// Esta pantalla NUNCA crea la cita por sí sola.

type Servicio = { nombre: string; duracion_min: number; precio: number | null };
type DatosCliente = { nombre: string; telefono: string };

function fechaDesdeISO(fechaISO: string): Date {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
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

function Fila({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12.5px]" style={{ color: AMORE.textoSecundario }}>
        {label}
      </span>
      <span className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
        {valor}
      </span>
    </div>
  );
}

function PasoIndicador({ estado, numero, label }: { estado: "completado" | "activo"; numero: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex size-8 items-center justify-center rounded-full text-[13px] font-semibold" style={{ backgroundColor: AMORE.burdeos, color: "#fff" }}>
        {numero}
      </div>
      <span className="text-center text-[10px] font-medium leading-tight" style={{ color: estado === "activo" ? AMORE.texto : AMORE.textoSecundario }}>
        {label}
      </span>
    </div>
  );
}

export function PasoConfirmacionAmore({
  negocio,
  servicio,
  especialistaNombre,
  fecha,
  hora,
  datos,
  enviando,
  error,
  ocupado,
  onConfirmar,
  onElegirOtroHorario,
  onVolver,
}: {
  negocio: string;
  servicio: Servicio;
  especialistaNombre: string;
  fecha: string;
  hora: string;
  datos: DatosCliente;
  enviando: boolean;
  error: string | null;
  ocupado: boolean;
  onConfirmar: () => void;
  onElegirOtroHorario: () => void;
  onVolver: () => void;
}) {
  return (
    <div className={`relative min-h-screen w-full ${playfairDisplay.variable}`} style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-8">
        <PortalHeaderAmore negocio={negocio} onVolver={onVolver} />

        <div className="mt-6 flex w-full items-start justify-between">
          <PasoIndicador estado="completado" numero={1} label="Servicio" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.burdeos }} />
          <PasoIndicador estado="completado" numero={2} label="Profesional" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.burdeos }} />
          <PasoIndicador estado="completado" numero={3} label="Horario" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.burdeos }} />
          <PasoIndicador estado="completado" numero={4} label="Datos" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.burdeos }} />
          <PasoIndicador estado="activo" numero={5} label="Listo" />
        </div>

        <h1 className="mt-7 text-center text-[27px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
          Confirma tu cita
        </h1>
        <p className="mt-1 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
          Revisa que todo esté correcto antes de confirmar.
        </p>

        <div className="mt-6 rounded-[28px] p-5" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
          <div className="flex items-center gap-3 border-b pb-3" style={{ borderColor: AMORE.borde }}>
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.burdeosSuave }}>
              <CalendarPlus className="size-5" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
            </div>
            <div>
              <p className="text-[14.5px] font-semibold" style={{ color: AMORE.texto }}>
                {servicio.nombre}
              </p>
              <p className="flex items-center gap-1 text-[11.5px]" style={{ color: AMORE.textoSecundario }}>
                <Clock className="size-3.5" strokeWidth={1.6} />
                {formatearDuracion(servicio.duracion_min)}
                {servicio.precio != null && <span style={{ color: AMORE.burdeos }}> · {formatearPrecioCop(servicio.precio)}</span>}
              </p>
            </div>
          </div>

          <div className="divide-y" style={{ borderColor: AMORE.borde }}>
            <Fila label="Profesional" valor={especialistaNombre} />
            <Fila label="Fecha" valor={formatearFechaLarga(fecha)} />
            <Fila label="Hora" valor={formatearHora12h(hora)} />
            <Fila label="Nombre" valor={datos.nombre} />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl px-4 py-3 text-[12.5px]" style={{ backgroundColor: AMORE.rojoSuave, color: AMORE.rojo }}>
            {error}
            {ocupado && (
              <button type="button" onClick={onElegirOtroHorario} className="mt-1.5 block font-semibold underline">
                Elegir otro horario
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={enviando}
          onClick={onConfirmar}
          className="mt-6 flex w-full items-center justify-center gap-2 py-4 text-[15.5px] font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: AMORE.burdeos, borderRadius: 999 }}
        >
          {enviando ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              Confirmando...
            </>
          ) : (
            <>
              Confirmar mi cita
              <ChevronRight className="size-5" strokeWidth={2} />
            </>
          )}
        </button>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          <User className="size-3.5" style={{ color: AMORE.dorado }} strokeWidth={1.5} />
          <span className="text-[11px]" style={{ color: AMORE.textoSecundario }}>
            {datos.telefono}
          </span>
        </div>
      </div>
    </div>
  );
}
