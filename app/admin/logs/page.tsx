"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";

type EventoFlow = { id: string; tenant_id: string; phone_number_id: string; status: string; last_activity_at: string };
type EventoIA = { id: number; id_tenant: string; phone_number_id: string; tipo: string; mensaje: string; http_status: number | null; created_at: string };

export default function AdminLogsPage() {
  const { session } = useDashboard();
  const [modulo, setModulo] = useState<"flow" | "ia">("flow");
  const [soloErrores, setSoloErrores] = useState(true);
  const [eventosFlow, setEventosFlow] = useState<EventoFlow[]>([]);
  const [eventosIA, setEventosIA] = useState<EventoIA[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams({ modulo });
    if (modulo === "flow" && soloErrores) params.set("solo_errores", "1");
    fetch(`/api/dashboard/admin/logs?${params.toString()}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando logs");
        if (modulo === "flow") setEventosFlow(data.eventos);
        else setEventosIA(data.eventos);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, modulo, soloErrores]);

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Logs" description="Logs técnicos -- distintos de la Auditoría (que registra acciones del operador).">
        <div className="flex items-center gap-2">
          <select value={modulo} onChange={(e) => setModulo(e.target.value as "flow" | "ia")} className="rounded-lg border border-edge bg-ink-2 px-3 py-2 text-sm text-fg">
            <option value="flow">Ejecuciones de Flow</option>
            <option value="ia">Fallos de IA</option>
          </select>
          {modulo === "flow" && (
            <label className="flex items-center gap-1.5 text-sm text-mist">
              <input type="checkbox" checked={soloErrores} onChange={(e) => setSoloErrores(e.target.checked)} /> Solo errores
            </label>
          )}
        </div>
      </PageHeader>
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
        {modulo === "flow" ? (
          <div className="overflow-x-auto rounded-xl border border-edge bg-card">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-edge text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                  <th className="px-5 py-3">Fecha</th>
                  <th className="px-5 py-3">Número</th>
                  <th className="px-5 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {eventosFlow.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-3 text-mist">{new Date(e.last_activity_at).toLocaleString("es-CO")}</td>
                    <td className="px-5 py-3 text-fg">{e.phone_number_id}</td>
                    <td className="px-5 py-3"><Pill tone={e.status === "failed" ? "danger" : "neutral"}>{e.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {eventosFlow.length === 0 && <p className="px-5 py-8 text-center text-sm text-mist">Sin eventos.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-edge bg-card">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-edge text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                  <th className="px-5 py-3">Fecha</th>
                  <th className="px-5 py-3">Número</th>
                  <th className="px-5 py-3">Tipo</th>
                  <th className="px-5 py-3">Mensaje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {eventosIA.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-3 text-mist">{new Date(e.created_at).toLocaleString("es-CO")}</td>
                    <td className="px-5 py-3 text-fg">{e.phone_number_id}</td>
                    <td className="px-5 py-3 text-fg">{e.tipo}</td>
                    <td className="px-5 py-3 text-mist">{e.mensaje}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {eventosIA.length === 0 && <p className="px-5 py-8 text-center text-sm text-mist">Sin eventos.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
