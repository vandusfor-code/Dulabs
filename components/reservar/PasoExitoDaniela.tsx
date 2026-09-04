"use client";

import { Check, Clock, Heart } from "lucide-react";
import { cormorantGaramond, parisienne } from "@/lib/fonts-portal-daniela";

// Fase 8A.10 (autorizado) — reestilizado visual de la pantalla de éxito
// existente (mismos datos, mismo `resultado` que ya devolvía el POST de
// app/api/reservar/[tenant]/route.ts) -- ninguna lógica nueva, solo
// coherencia visual con el resto del portal rediseñado.

type ResultadoExito = { codigo: string; servicio: string; profesional: string; inicio: string; fin: string; duracionMin: number };

const ROSA = "#C94B78";
const ROSA_SUAVE = "#F8E8ED";
const ROSA_FONDO = "#FDF5F7";
const TEXTO = "#111111";
const TEXTO_SECUNDARIO = "#555555";
const BORDE = "#E8DDE1";
const VERDE = "#3FA96A";
const VERDE_SUAVE = "#E9F7EF";

const serif = { fontFamily: "var(--font-cormorant-daniela), 'Cormorant Garamond', serif" };

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

function formatearDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const minutos = min % 60;
  return minutos === 0 ? `${horas} h` : `${horas} h ${minutos} min`;
}

export function PasoExitoDaniela({ resultado, negocio }: { resultado: ResultadoExito; negocio: string }) {
  const fecha = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", weekday: "long", timeZone: "America/Bogota" }).format(
    new Date(resultado.inicio)
  );
  const hora = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(
    new Date(resultado.inicio)
  );

  return (
    <div className={`relative min-h-screen w-full ${cormorantGaramond.variable} ${parisienne.variable}`} style={{ backgroundColor: ROSA_FONDO }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col items-center px-6 pb-9 pt-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-full" style={{ backgroundColor: VERDE_SUAVE }}>
          <Check className="size-8" style={{ color: VERDE }} strokeWidth={2} />
        </div>

        <h1 className="mt-5 text-[32px] font-semibold" style={{ ...serif, color: TEXTO }}>
          ¡Cita confirmada!
        </h1>
        <p className="mt-1 text-[14px]" style={{ color: TEXTO_SECUNDARIO }}>
          Te esperamos en {negocio}
        </p>

        <div className="mt-3 flex items-center gap-2">
          <span className="h-px w-14" style={{ backgroundColor: ROSA }} />
          <Heart className="size-3.5 shrink-0" style={{ color: ROSA }} strokeWidth={1.5} />
          <span className="h-px w-14" style={{ backgroundColor: ROSA }} />
        </div>

        <div
          className="mt-7 w-full rounded-[32px] p-5 text-left"
          style={{ backgroundColor: "rgba(255,255,255,0.94)", boxShadow: "0 20px 60px -30px rgba(201,75,120,0.25)" }}
        >
          <div className="divide-y" style={{ borderColor: BORDE }}>
            <Fila label="Servicio" valor={resultado.servicio} />
            <Fila label="Profesional" valor={resultado.profesional} />
            <Fila label="Fecha" valor={fecha} />
            <Fila label="Hora" valor={hora} />
            <Fila label="Duración" valor={formatearDuracion(resultado.duracionMin)} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: BORDE }}>
            <span className="flex items-center gap-1.5 text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>
              <Clock className="size-3.5" strokeWidth={1.6} /> Código
            </span>
            <span
              className="rounded-full px-3 py-1 font-mono text-[13px] font-semibold"
              style={{ backgroundColor: ROSA_SUAVE, color: ROSA }}
            >
              {resultado.codigo}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
