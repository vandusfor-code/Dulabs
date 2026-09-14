"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { PLANES, ORDEN_PLANES_ADMIN, resolverPlanId } from "@/lib/planes";
import { formatearTelefono } from "@/lib/format";
import { labelEstadoPago, toneEstadoPago } from "@/lib/admin-ui";

type ClienteFila = {
  idTenant: string;
  nombre: string | null;
  correo: string | null;
  telefono: string | null;
  plan: string;
  fechaCompra: string;
  estadoPago: string;
  onboarding: { estadoImplementacion: string; actualizadoAt: string } | null;
};

const ESTADOS_PAGO = ["activa", "pendiente_pago", "vencida", "cancelada"];

function fechaCorta(fecha: string): string {
  return new Date(fecha).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}

export default function AdminClientesPage() {
  const { session } = useDashboard();
  const [clientes, setClientes] = useState<ClienteFila[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filtroPago, setFiltroPago] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("estado_pago") ?? ""
  );
  const [filtroPlan, setFiltroPlan] = useState("");
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filtroPago) params.set("estado_pago", filtroPago);
    if (filtroPlan) params.set("plan", filtroPlan);
    params.set("pagina", String(pagina));
    params.set("por_pagina", "25");

    const timeout = setTimeout(() => {
      fetch(`/api/dashboard/admin/clientes?${params.toString()}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Error cargando clientes");
          setClientes(data.clientes);
          setTotal(data.total ?? data.clientes.length);
          setTotalPaginas(data.totalPaginas ?? 1);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 250);
    return () => clearTimeout(timeout);
  }, [session, q, filtroPago, filtroPlan, pagina]);

  const selectClass = "rounded-lg border border-edge bg-ink-2 px-3 py-2 text-sm text-fg outline-none focus:border-lime/50";

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Clientes" description={`${total} cliente${total === 1 ? "" : "s"} en total.`}>
        <Link href="/admin/clientes/nuevo" className="flex items-center gap-1.5 rounded-lg bg-lime px-3.5 py-2 text-sm font-semibold text-lime-fg hover:bg-lime-hover">
          <Plus className="size-4" /> Crear cliente
        </Link>
      </PageHeader>
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPagina(1);
              }}
              placeholder="Buscar por nombre, correo o teléfono…"
              className="w-full rounded-lg border border-edge bg-ink-2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-lime/50 sm:w-72"
            />
          </div>
          <select
            className={selectClass}
            value={filtroPago}
            onChange={(e) => {
              setFiltroPago(e.target.value);
              setPagina(1);
            }}
          >
            <option value="">Estado de pago</option>
            {ESTADOS_PAGO.map((e) => (
              <option key={e} value={e}>
                {labelEstadoPago(e)}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={filtroPlan}
            onChange={(e) => {
              setFiltroPlan(e.target.value);
              setPagina(1);
            }}
          >
            <option value="">Plan</option>
            {ORDEN_PLANES_ADMIN.map((p) => (
              <option key={p} value={p}>
                {PLANES[p].nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-edge bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Plan</th>
                <th className="px-5 py-3">Teléfono</th>
                <th className="px-5 py-3">Fecha de compra</th>
                <th className="px-5 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {(clientes ?? []).map((c) => (
                <tr key={c.idTenant} className="cursor-pointer transition-colors hover:bg-ink">
                  <td className="px-5 py-3">
                    <Link href={`/admin/clientes/${c.idTenant}`} className="block font-medium text-fg hover:text-lime-text">
                      {c.nombre ?? "Sin nombre"}
                    </Link>
                    {c.correo && <p className="text-xs text-mist">{c.correo}</p>}
                  </td>
                  <td className="px-5 py-3 text-fg">{PLANES[resolverPlanId(c.plan)].nombre}</td>
                  <td className="px-5 py-3 text-fg">{c.telefono ? formatearTelefono(c.telefono) : "—"}</td>
                  <td className="px-5 py-3 text-mist">{fechaCorta(c.fechaCompra)}</td>
                  <td className="px-5 py-3">
                    <Pill tone={toneEstadoPago(c.estadoPago)}>{labelEstadoPago(c.estadoPago)}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {clientes !== null && clientes.length === 0 && <p className="px-5 py-8 text-center text-sm text-mist">No hay clientes que coincidan con estos filtros.</p>}
        </div>

        {totalPaginas > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1}
              className="flex items-center gap-1 rounded-lg border border-edge px-3 py-1.5 text-sm text-mist disabled:opacity-40"
            >
              <ChevronLeft className="size-4" /> Anterior
            </button>
            <span className="text-sm text-mist">
              Página {pagina} de {totalPaginas}
            </span>
            <button
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas}
              className="flex items-center gap-1 rounded-lg border border-edge px-3 py-1.5 text-sm text-mist disabled:opacity-40"
            >
              Siguiente <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
