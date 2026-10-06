"use client";

import { Check, Clock, Gem } from "lucide-react";
import type { ServicioDelPortal } from "@/lib/reservar-amore-servicios";
import { FilaResumenAmore as Fila } from "./FilaResumenAmore";
import { BotonPrincipalAmore, MarcoPasoAmore } from "./MarcoPasoAmore";
import { formatearDuracion, formatearFechaLargaDeInstante, formatearHoraDeInstante } from "./formato";
import { AMORE, serifAmore } from "./tema";

// AMORE (portal) — pantalla de éxito. Muestra lo que devolvió el POST de app/api/reservar/[tenant]/route.ts, incluido el enlace personal «Mi cita»
// (enlaceGestion) para ver, modificar o cancelar la cita. Solo presentación: el enlace lo emite el servidor. Con varios servicios los lista uno por uno (la
// respuesta trae «A + B» y la duración TOTAL); el botón del enlace queda en la barra de abajo, siempre a la vista.

type ResultadoExito = { codigo: string; servicio: string; profesional: string; inicio: string; fin: string; duracionMin: number; enlaceGestion?: string | null };

export function PasoExitoAmore({ resultado, negocio, servicios }: { resultado: ResultadoExito; negocio: string; servicios: Pick<ServicioDelPortal, "id" | "nombre">[] }) {
  const fecha = formatearFechaLargaDeInstante(resultado.inicio);
  const hora = formatearHoraDeInstante(resultado.inicio);
  const varios = servicios.length > 1;

  return (
    <MarcoPasoAmore
      negocio={negocio}
      accion={
        resultado.enlaceGestion ? (
          <div>
            <p className="mb-2 text-center text-[12px] leading-snug" style={{ color: AMORE.textoSecundario }}>
              También te enviamos este enlace por WhatsApp para modificar o cancelar tu cita.
            </p>
            <BotonPrincipalAmore llena href={resultado.enlaceGestion}>
              Ver o modificar mi cita
            </BotonPrincipalAmore>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col items-center pt-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.verdeSuave }}>
          <Check className="size-8" style={{ color: AMORE.verde }} strokeWidth={2} />
        </div>

        <h1 className="mt-4 text-[26px] font-semibold leading-tight" style={{ ...serifAmore, color: AMORE.texto }}>
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

        <div className="mt-6 w-full rounded-[28px] p-4 text-left" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
          {varios ? (
            <div className="border-b py-2.5" style={{ borderColor: AMORE.borde }}>
              <span className="text-[12.5px]" style={{ color: AMORE.textoSecundario }}>
                Servicios
              </span>
              <ul className="mt-1 flex flex-col gap-0.5">
                {servicios.map((s) => (
                  <li key={s.id} className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
                    {s.nombre}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Fila label="Servicio" valor={resultado.servicio} />
          )}
          <div>
            <Fila label="Profesional" valor={resultado.profesional} />
            <Fila label="Fecha" valor={fecha} />
            <Fila label="Hora" valor={hora} />
            <Fila label={varios ? "Duración total" : "Duración"} valor={formatearDuracion(resultado.duracionMin)} />
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: AMORE.borde }}>
            <span className="flex items-center gap-1.5 text-[12.5px]" style={{ color: AMORE.textoSecundario }}>
              <Clock className="size-3.5" strokeWidth={1.6} /> Código
            </span>
            <span className="rounded-full px-3 py-1 font-mono text-[12.5px] font-semibold" style={{ backgroundColor: AMORE.burdeosSuave, color: AMORE.burdeos }}>
              {resultado.codigo}
            </span>
          </div>
        </div>
      </div>
    </MarcoPasoAmore>
  );
}
