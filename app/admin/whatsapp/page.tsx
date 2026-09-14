"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { formatearTelefono } from "@/lib/format";

type NumeroAdmin = { idTenant: string; nombreTenant: string | null; phoneNumberId: string; nombreNegocio: string; telefonoNegocio: string; estadoConexion: string };

export default function AdminWhatsappPage() {
  const { session } = useDashboard();
  const [numeros, setNumeros] = useState<NumeroAdmin[] | null>(null);
  const [filtro, setFiltro] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("estado") ?? ""));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const params = filtro ? `?estado=${filtro}` : "";
    fetch(`/api/dashboard/admin/whatsapp${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando WhatsApp");
        setNumeros(data.numeros);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, filtro]);

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="WhatsApp" description="Estado de conexión de cada número.">
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="rounded-lg border border-edge bg-ink-2 px-3 py-2 text-sm text-fg">
          <option value="">Todos</option>
          <option value="conectado">Conectados</option>
          <option value="desconectado">Desconectados</option>
        </select>
      </PageHeader>
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
        <div className="overflow-x-auto rounded-xl border border-edge bg-card">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Número</th>
                <th className="px-5 py-3">Teléfono</th>
                <th className="px-5 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {(numeros ?? []).map((n) => (
                <tr key={n.phoneNumberId} className="transition-colors hover:bg-ink">
                  <td className="px-5 py-3"><Link href={`/admin/clientes/${n.idTenant}`} className="font-medium text-fg hover:text-lime-text">{n.nombreTenant ?? "Sin nombre"}</Link></td>
                  <td className="px-5 py-3 text-fg">{n.nombreNegocio}</td>
                  <td className="px-5 py-3 text-fg">{formatearTelefono(n.telefonoNegocio)}</td>
                  <td className="px-5 py-3"><Pill tone={n.estadoConexion === "conectado" ? "success" : "danger"}>{n.estadoConexion}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
          {numeros !== null && numeros.length === 0 && <p className="px-5 py-8 text-center text-sm text-mist">Sin resultados.</p>}
        </div>
      </div>
    </div>
  );
}
