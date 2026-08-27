"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, UserPlus, CreditCard, Clock, Wrench, FlaskConical, CheckCircle2, AlertTriangle, PhoneOff } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, StatTile, Pill } from "@/components/dashboard/shell/ui";
import { PLANES, resolverPlanId } from "@/lib/planes";
import { toneEstadoImplementacion, labelEstadoImplementacion } from "@/lib/admin-ui";

type MiniCliente = { idTenant: string; nombre: string | null; plan: string };

type Resumen = {
  totalClientes: number;
  clientesActivos: number;
  clientesNuevos: number;
  pagosRecientes: { id: number; id_tenant: string; monto_cop: number; estado: string; created_at: string }[];
  montoTotalReciente: number;
  contadoresImplementacion: Record<string, number>;
  contadoresOnboarding: { pendiente: number; completado: number; soporteSolicitado: number };
  atencion: {
    sinTelefonoParaOnboarding: MiniCliente[];
    onboardingCompletadoSinConfigurar: MiniCliente[];
    enConfiguracion: MiniCliente[];
    enPruebas: MiniCliente[];
    requiereAtencion: MiniCliente[];
  };
  metricas: { tiempoPagoAConfiguracionHoras: number | null; tiempoPagoAActivacionHoras: number | null };
  clientesRecientes: {
    idTenant: string;
    nombre: string | null;
    plan: string;
    fechaCompra: string;
    estadoPago: string;
    estadoImplementacion: string | null;
  }[];
};

function GrupoAtencion({ titulo, clientes, vacio }: { titulo: string; clientes: MiniCliente[]; vacio: string }) {
  if (clientes.length === 0) return null;
  return (
    <div className="border-t border-edge px-5 py-4 first:border-t-0">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
        {titulo} <span className="font-mono text-xs text-mist">({clientes.length})</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {clientes.map((c) => (
          <Link
            key={c.idTenant}
            href={`/dashboard/admin/clientes/${c.idTenant}`}
            className="rounded-lg border border-edge bg-ink px-3 py-1.5 text-xs text-fg transition-colors hover:border-lime/40 hover:text-lime-text"
          >
            {c.nombre ?? "Sin nombre"} · {PLANES[resolverPlanId(c.plan)].nombre}
          </Link>
        ))}
      </div>
      <p className="sr-only">{vacio}</p>
    </div>
  );
}

function formatearHoras(horas: number | null): string {
  if (horas === null) return "Sin datos suficientes";
  if (horas < 24) return `${horas}h`;
  return `${Math.round((horas / 24) * 10) / 10} días`;
}

export default function AdminDashboardPage() {
  const { session } = useDashboard();
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/admin/resumen", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando el resumen");
        setResumen(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  const totalAtencion = resumen
    ? resumen.atencion.sinTelefonoParaOnboarding.length +
      resumen.atencion.onboardingCompletadoSinConfigurar.length +
      resumen.atencion.enConfiguracion.length +
      resumen.atencion.enPruebas.length +
      resumen.atencion.requiereAtencion.length
    : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Panel de Operaciones"
        title="Dashboard"
        description="Qué pasó desde que un cliente paga hasta que su bot queda funcionando."
      />
      <div className="px-4 py-6 md:px-8">
        {error && (
          <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Total clientes" value={String(resumen?.totalClientes ?? "—")} icon={Users} />
          <StatTile label="Clientes activos" value={String(resumen?.clientesActivos ?? "—")} icon={CheckCircle2} />
          <StatTile label="Nuevos (7 días)" value={String(resumen?.clientesNuevos ?? "—")} icon={UserPlus} />
          <StatTile
            label="Monto reciente"
            value={resumen ? `$${resumen.montoTotalReciente.toLocaleString("es-CO")}` : "—"}
            icon={CreditCard}
          />
          <StatTile label="Pendientes" value={String(resumen?.contadoresImplementacion.PENDIENTE ?? "—")} icon={Clock} />
          <StatTile label="En configuración" value={String(resumen?.contadoresImplementacion.EN_CONFIGURACION ?? "—")} icon={Wrench} />
          <StatTile label="En pruebas" value={String(resumen?.contadoresImplementacion.EN_PRUEBAS ?? "—")} icon={FlaskConical} />
          <StatTile label="Requieren atención" value={String(resumen?.contadoresImplementacion.REQUIERE_ATENCION ?? "—")} icon={AlertTriangle} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatTile label="Onboarding pendiente" value={String(resumen?.contadoresOnboarding.pendiente ?? "—")} icon={Clock} />
          <StatTile label="Pidieron soporte directo" value={String(resumen?.contadoresOnboarding.soporteSolicitado ?? "—")} icon={PhoneOff} />
          <StatTile label="Tiempo promedio: pago → configuración" value={formatearHoras(resumen?.metricas.tiempoPagoAConfiguracionHoras ?? null)} icon={Clock} />
        </div>

        <div className="mt-8 rounded-xl border border-edge bg-card">
          <div className="flex items-center justify-between border-b border-edge px-5 py-4">
            <p className="text-sm font-semibold text-fg">Necesita tu atención</p>
            {resumen && <Pill tone={totalAtencion > 0 ? "warning" : "success"}>{totalAtencion}</Pill>}
          </div>
          {resumen && totalAtencion === 0 && <p className="px-5 py-6 text-sm text-mist">Nada pendiente por ahora.</p>}
          {resumen && (
            <>
              <GrupoAtencion titulo="Pagaron pero sin WhatsApp para onboarding" clientes={resumen.atencion.sinTelefonoParaOnboarding} vacio="" />
              <GrupoAtencion titulo="Onboarding completo, falta iniciar configuración" clientes={resumen.atencion.onboardingCompletadoSinConfigurar} vacio="" />
              <GrupoAtencion titulo="En configuración" clientes={resumen.atencion.enConfiguracion} vacio="" />
              <GrupoAtencion titulo="En pruebas" clientes={resumen.atencion.enPruebas} vacio="" />
              <GrupoAtencion titulo="Requieren atención" clientes={resumen.atencion.requiereAtencion} vacio="" />
            </>
          )}
        </div>

        <div className="mt-8 rounded-xl border border-edge bg-card">
          <div className="flex items-center justify-between border-b border-edge px-5 py-4">
            <p className="text-sm font-semibold text-fg">Clientes recientes</p>
            <Link href="/dashboard/admin/clientes" className="text-xs font-medium text-lime-text hover:text-fg">
              Ver todos →
            </Link>
          </div>
          <div className="divide-y divide-edge">
            {resumen?.clientesRecientes.length === 0 && (
              <p className="px-5 py-6 text-sm text-mist">Todavía no hay clientes.</p>
            )}
            {resumen?.clientesRecientes.map((c) => (
              <Link
                key={c.idTenant}
                href={`/dashboard/admin/clientes/${c.idTenant}`}
                className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-ink"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{c.nombre ?? "Sin nombre"}</p>
                  <p className="mt-0.5 text-xs text-mist">
                    {PLANES[resolverPlanId(c.plan)].nombre} · {new Date(c.fechaCompra).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
                  </p>
                </div>
                {c.estadoImplementacion && (
                  <Pill tone={toneEstadoImplementacion(c.estadoImplementacion)}>{labelEstadoImplementacion(c.estadoImplementacion)}</Pill>
                )}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
