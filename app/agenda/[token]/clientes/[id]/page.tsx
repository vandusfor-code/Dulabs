"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft, Phone, Mail, Cake, CalendarPlus } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { inicialesDe, formatearFechaCorta, formatearHora } from "@/components/spa-panel/format";
import { StatusBadge } from "@/components/spa-panel/ui";
import type { EstadoCita } from "@/components/spa-panel/types";

type ClienteDetalle = {
  id: number;
  nombre: string;
  telefono: string;
  correo: string | null;
  fechaRegistro: string;
  cumpleDia: number | null;
  cumpleMes: number | null;
};

type ReservaHistorial = { id: number; servicio: string; profesional: string; inicio: string; fin: string; estado: EstadoCita };

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function formatearCumpleanos(dia: number | null, mes: number | null): string | null {
  if (!dia || !mes) return null;
  return `${dia} de ${MESES[mes - 1]}`;
}

// AMORE (Fase 4, base de clientes, autorizado) — detalle de UN cliente:
// sus datos + su historial real de reservas (servicio/profesional/fecha/
// hora/estado), leído de app/api/agenda/[token]/clientes/[id]/route.ts
// (mismas tablas ya existentes, sin ningún sistema paralelo). Genérico para
// cualquier tenant que use este panel.
export default function ClienteDetallePage() {
  const { token } = useAgenda();
  const { id } = useParams<{ id: string }>();
  const [cliente, setCliente] = useState<ClienteDetalle | null>(null);
  const [historial, setHistorial] = useState<ReservaHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/agenda/${token}/clientes/${id}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelado) return;
        if (body.error) setError(body.error);
        else {
          setCliente(body.cliente);
          setHistorial(body.historial);
        }
      })
      .catch(() => !cancelado && setError("No se pudo cargar el cliente"));
    return () => {
      cancelado = true;
    };
  }, [token, id]);

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/agenda/${token}/clientes`} className="flex items-center gap-1.5 text-xs font-medium text-mist hover:text-fg">
        <ArrowLeft className="size-3.5" /> Volver a clientes
      </Link>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!cliente && !error ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : cliente ? (
        <>
          <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-lime-soft text-sm font-semibold text-lime-text">
              {inicialesDe(cliente.nombre)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-fg">{cliente.nombre}</p>
              <p className="text-xs text-mist">Cliente desde {formatearFechaCorta(cliente.fechaRegistro)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3">
              <Phone className="size-4 shrink-0 text-mist" />
              <span className="truncate text-sm text-fg">{cliente.telefono}</span>
            </div>
            {cliente.correo && (
              <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3">
                <Mail className="size-4 shrink-0 text-mist" />
                <span className="truncate text-sm text-fg">{cliente.correo}</span>
              </div>
            )}
            {formatearCumpleanos(cliente.cumpleDia, cliente.cumpleMes) && (
              <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3">
                <Cake className="size-4 shrink-0 text-mist" />
                <span className="truncate text-sm text-fg">{formatearCumpleanos(cliente.cumpleDia, cliente.cumpleMes)}</span>
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-2.5 text-sm font-semibold text-fg">Historial de reservas</h2>
            {!historial ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-mist" />
              </div>
            ) : historial.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-8 text-center">
                <CalendarPlus className="size-6 text-mist" />
                <p className="mt-2 text-sm text-mist">Todavía no tiene reservas registradas.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {historial.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{r.servicio}</p>
                      <p className="truncate text-xs text-mist">
                        {r.profesional} · {formatearFechaCorta(r.inicio)} · {formatearHora(r.inicio)}
                      </p>
                    </div>
                    <StatusBadge estado={r.estado} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
