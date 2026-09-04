"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Users, Search, Cake, ChevronRight } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { inicialesDe, formatearFechaCorta } from "@/components/spa-panel/format";
import { filtrarClientes } from "@/components/spa-panel/filtrar-clientes";

type ClienteVista = {
  id: number;
  nombre: string;
  telefono: string;
  correo: string | null;
  fechaRegistro: string;
  cumpleDia: number | null;
  cumpleMes: number | null;
  citasRegistradas: number;
  ultimaCita: string | null;
};

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatearCumpleanos(dia: number | null, mes: number | null): string | null {
  if (!dia || !mes) return null;
  return `${dia} de ${MESES_CORTOS[mes - 1]}`;
}

// Fase 5 (panel administrativo) — vista de solo lectura sobre
// dulabs_clientes_conocidos (Fase 3/4), sin convertirla en CRM: solo
// nombre/teléfono/correo + un par de métricas derivadas de forma segura
// (conteo y última cita), todo ya filtrado por tenant en el backend.
//
// AMORE (Fase 4, base de clientes, autorizado) — agrega búsqueda (nombre o
// WhatsApp, filtrado en el cliente sobre el listado ya cargado), fecha de
// nacimiento y fecha de registro, y navegación al detalle de cada cliente
// (historial real de reservas). Genérico para cualquier tenant que use este
// panel, no exclusivo de AMORE.
export default function ClientesPage() {
  const { token } = useAgenda();
  const [clientes, setClientes] = useState<ClienteVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/agenda/${token}/clientes`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelado) return;
        if (body.error) setError(body.error);
        else setClientes(body.clientes);
      })
      .catch(() => !cancelado && setError("No se pudieron cargar los clientes"));
    return () => {
      cancelado = true;
    };
  }, [token]);

  const clientesFiltrados = useMemo(() => (clientes ? filtrarClientes(clientes, busqueda) : null), [clientes, busqueda]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-fg">Clientes</h1>
        <p className="text-xs text-mist">Todas las personas que han agendado contigo</p>
      </div>

      {clientes && clientes.length > 0 && (
        <label className="flex items-center gap-2.5 rounded-2xl border border-edge bg-card px-4 py-2.5">
          <Search className="size-4 shrink-0 text-mist" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o WhatsApp..."
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
          />
        </label>
      )}

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!clientes && !error ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : clientes && clientes.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-edge bg-card p-10 text-center">
          <Users className="size-6 text-mist" />
          <p className="mt-2 text-sm text-mist">Todavía no tienes clientes registrados.</p>
        </div>
      ) : clientesFiltrados && clientesFiltrados.length === 0 ? (
        <p className="py-6 text-center text-sm text-mist">Ningún cliente coincide con &quot;{busqueda}&quot;.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {clientesFiltrados?.map((c) => {
            const cumple = formatearCumpleanos(c.cumpleDia, c.cumpleMes);
            return (
              <Link
                key={c.id}
                href={`/agenda/${token}/clientes/${c.id}`}
                className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-colors hover:border-lime/40"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime-soft text-xs font-semibold text-lime-text">
                  {inicialesDe(c.nombre)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{c.nombre}</p>
                  <p className="truncate text-xs text-mist">
                    {c.telefono}
                    {c.correo ? ` · ${c.correo}` : ""}
                  </p>
                  {cumple && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-mist">
                      <Cake className="size-3" /> {cumple}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium text-fg">
                    {c.citasRegistradas} {c.citasRegistradas === 1 ? "cita" : "citas"}
                  </p>
                  {c.ultimaCita && <p className="text-[11px] text-mist">Última: {formatearFechaCorta(c.ultimaCita)}</p>}
                </div>
                <ChevronRight className="size-4 shrink-0 text-mist" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
