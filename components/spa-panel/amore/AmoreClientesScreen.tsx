"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Users, Search, Cake } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { formatearFechaCorta } from "@/components/spa-panel/format";
import { filtrarClientes } from "@/components/spa-panel/filtrar-clientes";
import { AmoreScreenTitle, AmoreCard, AmoreSearchInput, AmoreAvatar, AmoreEmptyState } from "./ui";

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

// AMORE (Fase 5, diseño visual completo, autorizado) — MISMA API real de
// clientes ya existente (Fase 4), solo con la piel del design system móvil
// de AMORE. Ningún dato ni ruta nueva -- el módulo funcional no se toca.
export function AmoreClientesScreen() {
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
      <AmoreScreenTitle title="Clientes" subtitle="Todas las personas que han agendado contigo" />

      {clientes && clientes.length > 0 && (
        <AmoreSearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar cliente..." icon={<Search className="size-4 shrink-0 text-mist" />} />
      )}

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!clientes && !error ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : clientes && clientes.length === 0 ? (
        <AmoreEmptyState icono={<Users className="size-6 text-mist" />} mensaje="Todavía no tienes clientes registrados." />
      ) : clientesFiltrados && clientesFiltrados.length === 0 ? (
        <p className="py-6 text-center text-sm text-mist">Ningún cliente coincide con &quot;{busqueda}&quot;.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {clientesFiltrados?.map((c) => {
            const cumple = formatearCumpleanos(c.cumpleDia, c.cumpleMes);
            return (
              <Link key={c.id} href={`/agenda/${token}/clientes/${c.id}`}>
                <AmoreCard className="flex items-center gap-3 p-3.5">
                  <AmoreAvatar nombre={c.nombre} />
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
                </AmoreCard>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
