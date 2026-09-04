"use client";

import { Check, Clock, Gem } from "lucide-react";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { AMORE, serifAmore } from "./tema";

// AMORE (Fase 3 del portal, autorizado) — pantalla de éxito. Mismo
// `resultado` real que ya devuelve el POST de app/api/reservar/[tenant]/route.ts
// (reservarCitaPorServicio) -- ninguna lógica nueva, solo presentación con
// identidad propia. NO envía WhatsApp (pedido explícito de esta fase).

type ResultadoExito = { codigo: string; servicio: string; profesional: string; inicio: string; fin: string; duracionMin: number };

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

function formatearDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const minutos = min % 60;
  return minutos === 0 ? `${horas} h` : `${horas} h ${minutos} min`;
}

export function PasoExitoAmore({ resultado, negocio }: { resultado: ResultadoExito; negocio: string }) {
  const fecha = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", weekday: "long", timeZone: "America/Bogota" }).format(new Date(resultado.inicio));
  const hora = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(new Date(resultado.inicio));

  return (
    <div className={`relative min-h-screen w-full ${playfairDisplay.variable}`} style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col items-center px-6 pb-9 pt-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.verdeSuave }}>
          <Check className="size-8" style={{ color: AMORE.verde }} strokeWidth={2} />
        </div>

        <h1 className="mt-5 text-[28px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
          ¡Cita confirmada!
        </h1>
        <p className="mt-1 text-[13.5px]" style={{ color: AMORE.textoSecundario }}>
          Te esperamos en {negocio}
        </p>

        <div className="mt-3 flex items-center gap-2">
          <span className="h-px w-14" style={{ backgroundColor: AMORE.dorado }} />
          <Gem className="size-3.5 shrink-0" style={{ color: AMORE.dorado }} strokeWidth={1.5} />
          <span className="h-px w-14" style={{ backgroundColor: AMORE.dorado }} />
        </div>

        <div className="mt-7 w-full rounded-[28px] p-5 text-left" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
          <div className="divide-y" style={{ borderColor: AMORE.borde }}>
            <Fila label="Servicio" valor={resultado.servicio} />
            <Fila label="Profesional" valor={resultado.profesional} />
            <Fila label="Fecha" valor={fecha} />
            <Fila label="Hora" valor={hora} />
            <Fila label="Duración" valor={formatearDuracion(resultado.duracionMin)} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: AMORE.borde }}>
            <span className="flex items-center gap-1.5 text-[12.5px]" style={{ color: AMORE.textoSecundario }}>
              <Clock className="size-3.5" strokeWidth={1.6} /> Código
            </span>
            <span className="rounded-full px-3 py-1 font-mono text-[12.5px] font-semibold" style={{ backgroundColor: AMORE.burdeosSuave, color: AMORE.burdeos }}>
              {resultado.codigo}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
