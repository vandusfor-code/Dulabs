"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";

type Cupo = { usados: number; limite: number | null };
type ClienteConsumo = {
  idTenant: string;
  nombre: string | null;
  plan: string;
  numeros: Cupo;
  usuarios: Cupo;
  agentesIA: Cupo;
  mensajesIA: Cupo & { porcentaje: number | null };
};

function CeldaCupo({ cupo }: { cupo: Cupo }) {
  return <span>{cupo.usados}{cupo.limite !== null && ` / ${cupo.limite}`}{cupo.limite === null && " (ilimitado)"}</span>;
}

export default function AdminConsumoPage() {
  const { session } = useDashboard();
  const [clientes, setClientes] = useState<ClienteConsumo[] | null>(null);
  const [filtro, setFiltro] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const params = filtro ? `?filtro=${filtro}` : "";
    fetch(`/api/dashboard/admin/consumo${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando consumo");
        setClientes(data.clientes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, filtro]);

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Consumo" description="Uso real contra los límites de cada plan.">
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="rounded-lg border border-edge bg-ink-2 px-3 py-2 text-sm text-fg">
          <option value="">Todos</option>
          <option value="80">Mensajes IA &gt;= 80%</option>
          <option value="90">Mensajes IA &gt;= 90%</option>
          <option value="excedido">Mensajes IA excedido</option>
        </select>
      </PageHeader>
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
        <div className="overflow-x-auto rounded-xl border border-edge bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Plan</th>
                <th className="px-5 py-3">Números</th>
                <th className="px-5 py-3">Usuarios</th>
                <th className="px-5 py-3">Agentes IA</th>
                <th className="px-5 py-3">Mensajes IA/mes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {(clientes ?? []).map((c) => (
                <tr key={c.idTenant} className="transition-colors hover:bg-ink">
                  <td className="px-5 py-3"><Link href={`/admin/clientes/${c.idTenant}`} className="font-medium text-fg hover:text-lime-text">{c.nombre ?? "Sin nombre"}</Link></td>
                  <td className="px-5 py-3 text-fg">{c.plan}</td>
                  <td className="px-5 py-3 text-fg"><CeldaCupo cupo={c.numeros} /></td>
                  <td className="px-5 py-3 text-fg"><CeldaCupo cupo={c.usuarios} /></td>
                  <td className="px-5 py-3 text-fg"><CeldaCupo cupo={c.agentesIA} /></td>
                  <td className="px-5 py-3 text-fg">
                    <CeldaCupo cupo={c.mensajesIA} />
                    {c.mensajesIA.porcentaje !== null && (
                      <Pill tone={c.mensajesIA.porcentaje >= 100 ? "danger" : c.mensajesIA.porcentaje >= 80 ? "warning" : "neutral"} className="ml-2">
                        {c.mensajesIA.porcentaje}%
                      </Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {clientes !== null && clientes.length === 0 && <p className="px-5 py-8 text-center text-sm text-mist">Sin resultados.</p>}
        </div>
      </div>
    </div>
  );
}
