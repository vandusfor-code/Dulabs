"use client";

import { ChevronRight, Loader2, User, CalendarPlus, Clock } from "lucide-react";
import { cormorantGaramond, parisienne } from "@/lib/fonts-portal-daniela";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { PortalHeader } from "@/components/reservar/PortalHeader";

// Fase 8A.10 (autorizado) — SOLO esta pantalla ("Confirma tu cita"). Muestra
// el resumen REAL del estado de la reserva (servicio/especialista/fecha/
// hora ya resueltos por los pasos anteriores) y llama a `onConfirmar` --
// EXACTAMENTE el mismo `confirmarReserva` de page.tsx que ya existía, que
// hace el POST único a app/api/reservar/[tenant]/route.ts
// (reservarCitaPorServicio). Esta pantalla NO crea la cita por sí sola, ni
// al entrar ni de ninguna otra forma -- solo dispara la MISMA acción que ya
// disparaba el botón "Confirmar reserva" anterior.

type Servicio = { nombre: string; duracion_min: number; precio: number | null };
type DatosCliente = { nombre: string; telefono: string; correo: string };

const ROSA = "#C94B78";
const ROSA_SUAVE = "#F8E8ED";
const ROSA_FONDO = "#FDF5F7";
const TEXTO = "#111111";
const TEXTO_SECUNDARIO = "#555555";
const BORDE = "#E8DDE1";

const serif = { fontFamily: "var(--font-cormorant-daniela), 'Cormorant Garamond', serif" };

function fechaDesdeISO(fechaISO: string): Date {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
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

function PasoIndicador({ estado, numero, label }: { estado: "completado" | "activo"; numero: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex size-9 items-center justify-center rounded-full text-[14px] font-semibold" style={{ backgroundColor: ROSA, color: "#fff" }}>
        {numero}
      </div>
      <span className="text-center text-[11px] font-medium leading-tight" style={{ color: estado === "activo" ? TEXTO : TEXTO_SECUNDARIO }}>
        {label}
      </span>
    </div>
  );
}

function Fila({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>
        {label}
      </span>
      <span className="text-[14px] font-semibold" style={{ color: TEXTO }}>
        {valor}
      </span>
    </div>
  );
}

export function PasoConfirmacion({
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
    <div className={`relative min-h-screen w-full ${cormorantGaramond.variable} ${parisienne.variable}`} style={{ backgroundColor: ROSA_FONDO }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-9">
        <PortalHeader negocio={negocio} onVolver={onVolver} />

        <div className="mt-7 flex w-full items-start justify-between">
          <PasoIndicador estado="completado" numero={1} label="Servicio" />
          <div className="mt-4 h-px flex-1" style={{ backgroundColor: ROSA }} />
          <PasoIndicador estado="completado" numero={2} label="Horario" />
          <div className="mt-4 h-px flex-1" style={{ backgroundColor: ROSA }} />
          <PasoIndicador estado="completado" numero={3} label="Tus datos" />
          <div className="mt-4 h-px flex-1" style={{ backgroundColor: ROSA }} />
          <PasoIndicador estado="activo" numero={4} label="Confirmación" />
        </div>

        <h1 className="mt-8 text-center text-[32px] font-semibold" style={{ ...serif, color: TEXTO }}>
          Confirma tu cita
        </h1>
        <p className="mt-1 text-center text-[13.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          Revisa que todo esté correcto antes de confirmar.
        </p>

        <div className="mt-7 rounded-[32px] p-5" style={{ backgroundColor: "rgba(255,255,255,0.94)", boxShadow: "0 20px 60px -30px rgba(201,75,120,0.25)" }}>
          <div className="flex items-center gap-3 border-b pb-3" style={{ borderColor: BORDE }}>
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: ROSA_SUAVE }}>
              <CalendarPlus className="size-5" style={{ color: ROSA }} strokeWidth={1.6} />
            </div>
            <div>
              <p className="text-[15px] font-semibold" style={{ color: TEXTO }}>
                {servicio.nombre}
              </p>
              <p className="flex items-center gap-1 text-[12px]" style={{ color: TEXTO_SECUNDARIO }}>
                <Clock className="size-3.5" strokeWidth={1.6} />
                {formatearDuracion(servicio.duracion_min)}
                {servicio.precio != null && <span style={{ color: ROSA }}> · {formatearPrecioCop(servicio.precio)}</span>}
              </p>
            </div>
          </div>

          <div className="divide-y" style={{ borderColor: BORDE }}>
            <Fila label="Profesional" valor={especialistaNombre} />
            <Fila label="Fecha" valor={formatearFechaLarga(fecha)} />
            <Fila label="Hora" valor={formatearHora12h(hora)} />
            <Fila label="Nombre" valor={datos.nombre} />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl px-4 py-3 text-[13px]" style={{ backgroundColor: "#FDECEC", color: "#B4232C" }}>
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
          className="mt-6 flex w-full items-center justify-center gap-2 py-4 text-[16px] font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: ROSA, borderRadius: 32 }}
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
          <User className="size-3.5" style={{ color: ROSA }} strokeWidth={1.5} />
          <span className="text-[11.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            {datos.telefono}
          </span>
        </div>
      </div>
    </div>
  );
}
