"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";

type BotAdmin = {
  idTenant: string;
  nombreTenant: string | null;
  phoneNumberId: string;
  nombreNegocio: string;
  iaPausada: boolean;
  flowActivo: boolean;
  fallosRecientes: number;
  ultimaEjecucion: string | null;
  health: "healthy" | "warning" | "critical";
};

const TONO: Record<BotAdmin["health"], "success" | "warning" | "danger"> = { healthy: "success", warning: "warning", critical: "danger" };
const LABEL: Record<BotAdmin["health"], string> = { healthy: "Saludable", warning: "Advertencia", critical: "Crítico" };

export default function AdminBotsPage() {
  const { session } = useDashboard();
  const [bots, setBots] = useState<BotAdmin[] | null>(null);
  const [filtro, setFiltro] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("health") ?? ""));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const params = filtro ? `?health=${filtro}` : "";
    fetch(`/api/dashboard/admin/bots${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando bots");
        setBots(data.bots);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, filtro]);

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Bots & Flows" description="Salud derivada de señales reales -- nunca 'saludable' solo porque una flag diga activo.">
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="rounded-lg border border-edge bg-ink-2 px-3 py-2 text-sm text-fg">
          <option value="">Todos</option>
          <option value="critical">Críticos</option>
          <option value="warning">Advertencia</option>
          <option value="healthy">Saludables</option>
        </select>
      </PageHeader>
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
        <div className="overflow-x-auto rounded-xl border border-edge bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Número</th>
                <th className="px-5 py-3">IA</th>
                <th className="px-5 py-3">Flow</th>
                <th className="px-5 py-3">Fallos recientes</th>
                <th className="px-5 py-3">Salud</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {(bots ?? []).map((b) => (
                <tr key={b.phoneNumberId} className="transition-colors hover:bg-ink">
                  <td className="px-5 py-3"><Link href={`/admin/clientes/${b.idTenant}`} className="font-medium text-fg hover:text-lime-text">{b.nombreTenant ?? "Sin nombre"}</Link></td>
                  <td className="px-5 py-3 text-fg">{b.nombreNegocio}</td>
                  <td className="px-5 py-3 text-fg">{b.iaPausada ? "Pausada" : "Activa"}</td>
                  <td className="px-5 py-3 text-fg">{b.flowActivo ? "Activo" : "Sin Flow"}</td>
                  <td className="px-5 py-3 text-fg">{b.fallosRecientes}</td>
                  <td className="px-5 py-3"><Pill tone={TONO[b.health]}>{LABEL[b.health]}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
          {bots !== null && bots.length === 0 && <p className="px-5 py-8 text-center text-sm text-mist">Sin resultados.</p>}
        </div>
      </div>
    </div>
  );
}
