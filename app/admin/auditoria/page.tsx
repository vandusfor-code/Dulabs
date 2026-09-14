"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader } from "@/components/dashboard/shell/ui";

type Evento = { id: number; operador_email: string | null; accion: string; id_tenant: string | null; recurso: string | null; resultado: string; motivo: string | null; created_at: string };

export default function AdminAuditoriaPage() {
  const { session } = useDashboard();
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/admin/auditoria", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando auditoría");
        setEventos(data.eventos);
        setCursor(data.siguienteCursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  async function cargarMas() {
    if (!session || !cursor) return;
    const res = await fetch(`/api/dashboard/admin/auditoria?cursor=${encodeURIComponent(cursor)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const data = await res.json();
    if (res.ok) {
      setEventos((prev) => [...prev, ...data.eventos]);
      setCursor(data.siguienteCursor);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Auditoría" description="Todas las acciones administrativas ejecutadas desde este panel." />
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
        <div className="overflow-x-auto rounded-xl border border-edge bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <th className="px-5 py-3">Fecha</th>
                <th className="px-5 py-3">Operador</th>
                <th className="px-5 py-3">Acción</th>
                <th className="px-5 py-3">Tenant</th>
                <th className="px-5 py-3">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {eventos.map((e) => (
                <tr key={e.id}>
                  <td className="px-5 py-3 text-mist">{new Date(e.created_at).toLocaleString("es-CO")}</td>
                  <td className="px-5 py-3 text-fg">{e.operador_email ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-xs text-fg">{e.accion}</td>
                  <td className="px-5 py-3 font-mono text-xs text-mist">{e.id_tenant ?? "—"}</td>
                  <td className={`px-5 py-3 ${e.resultado === "error" ? "text-red-400" : "text-lime-text"}`}>{e.resultado}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {eventos.length === 0 && <p className="px-5 py-8 text-center text-sm text-mist">Sin eventos todavía (o la migración de auditoría no está aplicada).</p>}
        </div>
        {cursor && (
          <button onClick={cargarMas} className="mt-4 rounded-lg border border-edge px-4 py-2 text-sm text-fg hover:bg-ink">
            Cargar más
          </button>
        )}
      </div>
    </div>
  );
}
