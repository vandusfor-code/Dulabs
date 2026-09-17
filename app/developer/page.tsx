"use client";

import Link from "next/link";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { PageHeader } from "@/components/developer/PageHeader";
import { StatCard } from "@/components/developer/StatCard";
import { UsageProgress } from "@/components/developer/UsageProgress";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { EmptyState } from "@/components/developer/EmptyState";
import { ErrorState } from "@/components/developer/ErrorState";
import { CardsSkeleton, TableSkeleton } from "@/components/developer/Skeleton";
import { DataTable } from "@/components/developer/DataTable";
import { OnboardingChecklist, type PasoOnboarding } from "@/components/developer/OnboardingChecklist";
import { labelEstadoJob, tonoEstadoJob, truncarWamid, formatearLimite, formatearFechaHora, formatearFecha } from "@/lib/dev-dashboard/dev-format";
import type { JobResumen } from "@/lib/dev-dashboard/dev-client";

// Código del plan base por defecto de un workspace nuevo (fuente: lib/developer/plans.ts).
// Se compara acá para saber si el usuario ya activó un plan de pago en el onboarding.
const PLAN_BASE = "DEVELOPER";

export default function OverviewPage() {
  const { client, selectedWorkspaceId, email } = useDeveloper();
  const { data, loading, error, reload } = useDevResource(selectedWorkspaceId, async () => {
    if (!selectedWorkspaceId) return null;
    const [usage, numbers, apiKeys, jobs] = await Promise.all([client.usage(), client.numbers.list(), client.apiKeys.list(), client.jobs({ limit: 6 })]);
    return { usage, numbers: numbers.numbers, apiKeys: apiKeys.apiKeys, jobs: jobs.jobs };
  });

  if (!selectedWorkspaceId) {
    return (
      <>
        <PageHeader title="Overview" />
        <EmptyState
          title="Aún no tienes un workspace"
          description="Crea tu workspace para empezar a conectar WhatsApp, generar API keys y construir flows sobre DuLabs."
          action={
            <Link href="/developer/settings" className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">
              Configurar mi cuenta
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={`Welcome back${email ? `, ${email.split("@")[0]}` : ""}`} description="Here's what's happening in your workspace." />
      {loading ? (
        <div className="space-y-6">
          <CardsSkeleton />
          <TableSkeleton rows={4} cols={4} />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data ? (
        <div className="space-y-8">
          {(() => {
            const planActivo = data.usage.plan !== PLAN_BASE;
            const whatsappConectado = data.numbers.length > 0;
            const apiKeyCreada = data.apiKeys.some((k) => !k.revoked_at);
            const setupCompleto = planActivo && whatsappConectado && apiKeyCreada;
            if (setupCompleto) return null;
            const pasos: PasoOnboarding[] = [
              { id: "plan", titulo: "Activa un plan", descripcion: "Elige el plan que se ajuste a tu volumen de mensajes y números.", href: "/developer/plan", cta: "Ver planes", hecho: planActivo },
              { id: "whatsapp", titulo: "Conecta WhatsApp", descripcion: "Vincula tu número vía Meta Embedded Signup para enviar y recibir mensajes.", href: "/developer/whatsapp", cta: "Conectar", hecho: whatsappConectado },
              { id: "apikey", titulo: "Genera tu API Key", descripcion: "Crea una clave dl_live_ para autenticar tus llamadas a la API.", href: "/developer/api-keys", cta: "Crear key", hecho: apiKeyCreada },
            ];
            return <OnboardingChecklist nombre={email ? email.split("@")[0] : ""} pasos={pasos} />;
          })()}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Plan" value={data.usage.plan} hint={`Period ${data.usage.period}`} />
            <StatCard label="Messages" value={`${(data.usage.messages.reserved + data.usage.messages.confirmed).toLocaleString("en-US")}`} hint={`of ${formatearLimite(data.usage.messages.included)} this month`}>
              <div className="mt-3">
                <UsageProgress used={data.usage.messages.reserved + data.usage.messages.confirmed} included={data.usage.messages.included} />
              </div>
            </StatCard>
            <StatCard label="WhatsApp numbers" value={`${data.usage.numbers.used} / ${formatearLimite(data.usage.numbers.included)}`} hint={data.usage.numbers.available === null ? "Unlimited" : `${data.usage.numbers.available} available`} />
            <StatCard label="Active API keys" value={data.apiKeys.filter((k) => !k.revoked_at).length} hint={`${data.apiKeys.length} total`} />
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">Recent jobs</h2>
              <Link href="/developer/jobs" className="text-xs text-dev-accent hover:underline">
                View all
              </Link>
            </div>
            <DataTable<JobResumen>
              rows={data.jobs}
              rowKey={(j) => j.id}
              empty={<EmptyState title="No activity yet" description="Send your first message through the API to see jobs here." action={<Link href="/developer/api" className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">Quick start</Link>} />}
              columns={[
                { key: "id", header: "Job", render: (j) => <span className="font-mono text-xs">{j.id.slice(0, 8)}…</span> },
                { key: "status", header: "Status", render: (j) => <StatusBadge tono={tonoEstadoJob(j.status)}>{labelEstadoJob(j.status)}</StatusBadge> },
                { key: "wamid", header: "wamid", render: (j) => <span className="font-mono text-xs text-mist">{truncarWamid(j.wamid)}</span> },
                { key: "created", header: "Created", align: "right", render: (j) => <span className="text-xs text-mist">{formatearFechaHora(j.created_at)}</span> },
              ]}
            />
          </section>

          <p className="text-xs text-mist">Workspace created activity is scoped to the selected workspace. Last refreshed {formatearFecha(new Date().toISOString())}.</p>
        </div>
      ) : null}
    </>
  );
}
