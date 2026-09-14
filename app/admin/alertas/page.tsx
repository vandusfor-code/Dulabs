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
  /** F16.1 (Dunning, autorizado) -- solo presente en tipo="dunning_en_curso". */
  dunning?: { intentos: number; proximoIntentoEn: string | null; motivoUltimoFallo: string | null };
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

  // F16.1 (Commercial Scale -- Dunning, autorizado) -- acciones directas
  // sobre el ciclo de dunning de un cliente, sin salir de /admin/alertas
  // (no se crea un panel admin nuevo, per el pedido).
  const [accionando, setAccionando] = useState<string | null>(null);
  async function accionDunning(idTenant: string, body: { accion: string; tipo_notificacion?: string }) {
    if (!session || accionando) return;
    setAccionando(idTenant);
    try {
      const res = await fetch(`/api/dashboard/admin/clientes/${idTenant}/dunning`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo completar la acción");
      await cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setAccionando(null);
    }
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
                  {a.tipo === "dunning_en_curso" && a.dunning?.proximoIntentoEn && (
                    <p className="text-xs text-mist">Próximo reintento automático: {new Date(a.dunning.proximoIntentoEn).toLocaleString("es-CO")}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {a.tipo === "dunning_en_curso" && (
                  <>
                    <button
                      onClick={() => accionDunning(a.idTenant, { accion: "reintentar" })}
                      disabled={accionando === a.idTenant}
                      className="rounded-lg border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-medium text-lime-text hover:bg-lime/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {accionando === a.idTenant ? "Procesando…" : "Reintentar cobro"}
                    </button>
                    <button
                      onClick={() => accionDunning(a.idTenant, { accion: "reenviar_notificacion", tipo_notificacion: "payment_failed" })}
                      disabled={accionando === a.idTenant}
                      className="rounded-lg border border-edge px-3 py-1.5 text-xs text-fg hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Reenviar aviso
                    </button>
                  </>
                )}
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
