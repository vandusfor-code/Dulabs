"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";

type Alerta = {
  clave: string;
  tipo: string;
  idTenant: string;
  nombre: string | null;
  detalle: string;
  severidad: "critica" | "advertencia";
  creadaEn: string;
  estado: "nueva" | "vista" | "resuelta";
};

export default function AdminAlertasPage() {
  const { session } = useDashboard();
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/admin/alertas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando alertas");
        setAlertas(data.alertas);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  useEffect(cargar, [cargar]);

  async function marcar(clave: string, estado: "vista" | "resuelta") {
    if (!session) return;
    await fetch("/api/dashboard/admin/alertas", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ clave, estado }),
    });
    cargar();
  }

  const activas = (alertas ?? []).filter((a) => a.estado !== "resuelta");

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Alertas" description={`${activas.length} alerta${activas.length === 1 ? "" : "s"} activa${activas.length === 1 ? "" : "s"}.`} />
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
        <div className="flex flex-col gap-3">
          {activas.map((a) => (
            <div key={a.clave} className="flex items-center justify-between rounded-xl border border-edge bg-card p-4">
              <div className="flex items-center gap-3">
                <Pill tone={a.severidad === "critica" ? "danger" : "warning"}>{a.severidad === "critica" ? "Crítica" : "Advertencia"}</Pill>
                <div>
                  <Link href={`/admin/clientes/${a.idTenant}`} className="text-sm font-medium text-fg hover:text-lime-text">
                    {a.nombre ?? "Sin nombre"}
                  </Link>
                  <p className="text-xs text-mist">{a.detalle}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {a.estado === "nueva" && (
                  <button onClick={() => marcar(a.clave, "vista")} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-fg hover:bg-ink">
                    Marcar vista
                  </button>
                )}
                <button onClick={() => marcar(a.clave, "resuelta")} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-fg hover:bg-ink">
                  Marcar resuelta
                </button>
              </div>
            </div>
          ))}
          {alertas !== null && activas.length === 0 && <p className="py-8 text-center text-sm text-mist">Sin alertas activas.</p>}
        </div>
      </div>
    </div>
  );
}
