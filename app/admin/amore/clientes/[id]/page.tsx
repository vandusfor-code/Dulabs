"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ArrowLeft, Phone, Mail, Cake, CalendarPlus } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import { inicialesDe, formatearFechaCorta, formatearHora } from "@/components/spa-panel/format";
import { StatusBadge } from "@/components/spa-panel/ui";
import type { EstadoCita } from "@/components/spa-panel/types";
import { RUTA_CLIENTES } from "@/components/admin-web/admin-web-routes";

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

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function formatearCumpleanos(dia: number | null, mes: number | null): string | null {
  if (!dia || !mes) return null;
  return `${dia} de ${MESES[mes - 1]}`;
}

// Panel web AMORE (autorizado) — detalle de cliente desktop, MISMO endpoint
// que ya usa el móvil (AmoreClienteDetalleScreen.tsx). Admin-only.
export default function AdminAmoreClienteDetallePage() {
  return (
    <AdminOnlyDesktop>
      <ClienteDetalleContenido />
    </AdminOnlyDesktop>
  );
}

function ClienteDetalleContenido() {
  const { token } = useAdminWeb();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [cliente, setCliente] = useState<ClienteDetalle | null>(null);
  const [historial, setHistorial] = useState<ReservaHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/agenda/${token}/clientes/${id}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else {
          setCliente(body.cliente);
          setHistorial(body.historial);
        }
      })
      .catch(() => setError("No se pudo cargar el cliente"));
  }, [token, id]);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <button
        type="button"
        onClick={() => router.push(RUTA_CLIENTES)}
        className="flex w-fit items-center gap-1.5 text-sm font-medium text-mist hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Volver a clientes
      </button>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!cliente && !error ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : cliente ? (
        <>
          <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-5 shadow-sm">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-lime-soft text-base font-semibold text-lime-text">
              {inicialesDe(cliente.nombre)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-fg">{cliente.nombre}</p>
              <p className="text-sm text-mist">Cliente desde {formatearFechaCorta(cliente.fechaRegistro)}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3.5">
              <Phone className="size-4 shrink-0 text-mist" />
              <span className="truncate text-sm text-fg">{cliente.telefono}</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3.5">
              <Mail className="size-4 shrink-0 text-mist" />
              <span className="truncate text-sm text-fg">{cliente.correo ?? "Sin email"}</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-edge bg-card p-3.5">
              <Cake className="size-4 shrink-0 text-mist" />
              <span className="truncate text-sm text-fg">{formatearCumpleanos(cliente.cumpleDia, cliente.cumpleMes) ?? "Sin registrar"}</span>
            </div>
          </div>

          <div>
            <h2 className="mb-2.5 text-base font-semibold text-fg">Historial de reservas</h2>
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
              <div className="rounded-2xl border border-edge bg-card shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-mist">
                      <th className="px-5 py-3 font-medium">Servicio</th>
                      <th className="px-5 py-3 font-medium">Profesional</th>
                      <th className="px-5 py-3 font-medium">Fecha</th>
                      <th className="px-5 py-3 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge">
                    {historial.map((r) => (
                      <tr key={r.id}>
                        <td className="px-5 py-3 font-medium text-fg">{r.servicio}</td>
                        <td className="px-5 py-3 text-fg">{r.profesional}</td>
                        <td className="px-5 py-3 text-fg">
                          {formatearFechaCorta(r.inicio)} · {formatearHora(r.inicio)}
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge estado={r.estado} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
