"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { formatearFechaLarga, formatearHora, mismoDia } from "@/components/spa-panel/format";
import { AmoreCard, AmoreScreenTitle, AmoreSectionTitle, AmoreBadge, AmoreEmptyState } from "../ui";
import { rutaCitas } from "../amore-routes";

// Login AMORE (autorizado) — inicio de la colaboradora (spec Fase 30): solo
// SU propio día, su próxima cita y cuántos servicios ha completado este
// mes -- nada financiero, nada de otras profesionales. `datos.citas` YA
// viene scopeada a su especialista_id desde el backend (ver
// app/api/agenda/[token]/route.ts) -- ningún fetch ni filtro adicional
// necesario acá, solo lectura.
export function ColaboradoraInicio() {
  const { token, datos } = useAgenda();
  const router = useRouter();
  const nombre = datos.sesion?.nombre ?? datos.especialista.nombre;

  const citasHoy = useMemo(
    () =>
      datos.citas
        .filter((c) => mismoDia(c.inicio, new Date()) && c.estado !== "rechazada" && c.estado !== "cancelada")
        .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime()),
    [datos.citas]
  );

  const proxima = citasHoy.find((c) => c.estado === "confirmada" || c.estado === "pendiente");

  const completadasEsteMes = useMemo(() => {
    const ahora = new Date();
    return datos.citas.filter((c) => {
      if (c.estado !== "completada") return false;
      const d = new Date(c.inicio);
      return d.getUTCFullYear() === ahora.getUTCFullYear() && d.getUTCMonth() === ahora.getUTCMonth();
    }).length;
  }, [datos.citas]);

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title={`Hola, ${nombre} 💕`} subtitle={formatearFechaLarga(new Date())} />

      <AmoreCard className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-lime-soft text-lime-text">
          <CalendarClock className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold text-fg">{citasHoy.length}</p>
          <p className="text-sm text-mist">Citas de hoy</p>
        </div>
      </AmoreCard>

      <div>
        <AmoreSectionTitle title="Próxima cita" />
        <div className="mt-2.5">
          {proxima ? (
            <AmoreCard className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{formatearHora(proxima.inicio)} · {proxima.nombre_cliente}</p>
                <p className="truncate text-xs text-mist">{proxima.servicio}</p>
              </div>
              <AmoreBadge tono={proxima.estado === "confirmada" ? "success" : "warning"}>
                {proxima.estado === "confirmada" ? "Confirmada" : "Pendiente"}
              </AmoreBadge>
            </AmoreCard>
          ) : (
            <AmoreEmptyState icono={<CalendarClock className="size-6 text-mist" />} mensaje="No tienes más citas hoy." />
          )}
        </div>
      </div>

      <AmoreCard className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-success text-success-text">
          <CheckCircle2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold text-fg">{completadasEsteMes}</p>
          <p className="text-sm text-mist">Servicios realizados este mes</p>
        </div>
      </AmoreCard>

      <button
        type="button"
        onClick={() => router.push(rutaCitas(token))}
        className="rounded-2xl bg-lime-soft py-3 text-center text-sm font-medium text-lime-text"
      >
        Ver todas mis citas
      </button>
    </div>
  );
}
