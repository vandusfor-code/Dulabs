"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { PLANES, resolverPlanId } from "@/lib/planes";
import { labelEstadoPago, toneEstadoPago } from "@/lib/admin-ui";

type ClienteFila = { idTenant: string; nombre: string | null; correo: string | null; plan: string; estadoPago: string; fechaCompra: string };

export default function AdminBillingPage() {
  const { session } = useDashboard();
  const [clientes, setClientes] = useState<ClienteFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/admin/clientes?por_pagina=200", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando billing");
        setClientes(data.clientes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Billing" description="Plan, estado de pago y próximo cobro de cada cliente. Las acciones viven en el detalle de cada cliente." />
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
        <div className="overflow-x-auto rounded-xl border border-edge bg-card">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Plan</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3">Alta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {(clientes ?? []).map((c) => (
                <tr key={c.idTenant} className="transition-colors hover:bg-ink">
                  <td className="px-5 py-3">
                    <Link href={`/admin/clientes/${c.idTenant}`} className="font-medium text-fg hover:text-lime-text">
                      {c.nombre ?? "Sin nombre"}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-fg">{PLANES[resolverPlanId(c.plan)].nombre}</td>
                  <td className="px-5 py-3"><Pill tone={toneEstadoPago(c.estadoPago)}>{labelEstadoPago(c.estadoPago)}</Pill></td>
                  <td className="px-5 py-3 text-mist">{new Date(c.fechaCompra).toLocaleDateString("es-CO")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
