"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, CheckCircle2, Clock, XCircle, Phone, PhoneOff, Bot, Pause, AlertTriangle, CreditCard } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader, StatTile } from "@/components/dashboard/shell/ui";

type Resumen = {
  totalClientes: number;
  clientesActivos: number;
  clientesPorEstadoPago: Record<string, number>;
  whatsapp: { conectados: number; desconectados: number };
  bots: { activos: number; pausados: number };
  flowsConErrores: number;
  alertasCriticas: number;
  pagosPendientes: number;
  pagosFallidos: number;
};

function Card({ href, label, value, icon: Icon }: { href: string; label: string; value: number | string; icon: typeof Users }) {
  return (
    <Link href={href} className="block">
      <StatTile label={label} value={String(value)} icon={Icon} />
    </Link>
  );
}

export default function AdminResumenPage() {
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

  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Resumen" description="Cómo están todos los clientes de DuLabs, ahora mismo." />
      <div className="px-4 py-6 md:px-8">
        {error && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card href="/admin/clientes" label="Total clientes" value={resumen?.totalClientes ?? "—"} icon={Users} />
          <Card href="/admin/clientes?estado_pago=activa" label="Activos" value={resumen?.clientesPorEstadoPago.activa ?? "—"} icon={CheckCircle2} />
          <Card href="/admin/clientes?estado_pago=pendiente_pago" label="Pago pendiente" value={resumen?.clientesPorEstadoPago.pendiente_pago ?? "—"} icon={Clock} />
          <Card href="/admin/clientes?estado_pago=vencida" label="Vencidos" value={resumen?.clientesPorEstadoPago.vencida ?? "—"} icon={XCircle} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card href="/admin/whatsapp?estado=conectado" label="WhatsApp conectados" value={resumen?.whatsapp.conectados ?? "—"} icon={Phone} />
          <Card href="/admin/whatsapp?estado=desconectado" label="WhatsApp desconectados" value={resumen?.whatsapp.desconectados ?? "—"} icon={PhoneOff} />
          <Card href="/admin/bots?health=healthy" label="Bots activos" value={resumen?.bots.activos ?? "—"} icon={Bot} />
          <Card href="/admin/bots?health=warning" label="Bots pausados" value={resumen?.bots.pausados ?? "—"} icon={Pause} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
          <Card href="/admin/bots?health=critical" label="Flows con errores" value={resumen?.flowsConErrores ?? "—"} icon={AlertTriangle} />
          <Card href="/admin/billing" label="Pagos fallidos recientes" value={resumen?.pagosFallidos ?? "—"} icon={CreditCard} />
          <Card href="/admin/alertas" label="Alertas críticas" value={resumen?.alertasCriticas ?? "—"} icon={AlertTriangle} />
        </div>
      </div>
    </div>
  );
}
