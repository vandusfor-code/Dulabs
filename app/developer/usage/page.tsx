"use client";

import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { PageHeader } from "@/components/developer/PageHeader";
import { StatCard } from "@/components/developer/StatCard";
import { UsageProgress } from "@/components/developer/UsageProgress";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { ErrorState } from "@/components/developer/ErrorState";
import { EmptyState } from "@/components/developer/EmptyState";
import { CardsSkeleton } from "@/components/developer/Skeleton";
import { estadoCuota, tonoEstadoCuota, formatearLimite } from "@/lib/dev-dashboard/dev-format";

export default function UsagePage() {
  const { client, selectedWorkspaceId } = useDeveloper();
  const { data, loading, error, reload } = useDevResource(selectedWorkspaceId, async () => (selectedWorkspaceId ? await client.usage() : null));

  const msgUsados = data ? data.messages.reserved + data.messages.confirmed : 0;
  const estado = data ? estadoCuota(msgUsados, data.messages.included) : "normal";

  return (
    <>
      <PageHeader
        title="Usage"
        description="Monthly usage for the selected workspace."
        actions={<button disabled className="cursor-not-allowed rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-mist" title="Coming soon">Manage plan</button>}
      />
      {loading ? (
        <CardsSkeleton count={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <EmptyState title="Select a workspace" />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tono="info">{data.plan}</StatusBadge>
            <span className="text-sm text-mist">Period {data.period}</span>
            {estado === "limite" ? <StatusBadge tono="danger">Limit reached</StatusBadge> : estado === "cerca" ? <StatusBadge tono="warning">Near limit</StatusBadge> : null}
          </div>

          <div className="rounded-lg border border-edge bg-card p-5">
            <h2 className="text-sm font-semibold text-fg">Messages</h2>
            <div className="mt-4">
              <UsageProgress used={msgUsados} included={data.messages.included} unidad="messages" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-4">
              <div><p className="text-xs uppercase tracking-wide text-mist">Reserved</p><p className="mt-1 text-lg font-semibold tabular-nums text-fg">{data.messages.reserved.toLocaleString("en-US")}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-mist">Confirmed</p><p className="mt-1 text-lg font-semibold tabular-nums text-fg">{data.messages.confirmed.toLocaleString("en-US")}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-mist">Available</p><p className={`mt-1 text-lg font-semibold tabular-nums ${tonoEstadoCuota(estado) === "danger" ? "text-danger-text" : "text-fg"}`}>{data.messages.available === null ? "∞" : data.messages.available.toLocaleString("en-US")}</p></div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Numbers included" value={formatearLimite(data.numbers.included)} />
            <StatCard label="Numbers used" value={`${data.numbers.used}`} hint={data.numbers.available === null ? "Unlimited" : `${data.numbers.available} available`} />
          </div>

          <p className="text-xs text-mist">Rate limit: {formatearLimite(data.limits.messagesPerSecondPerNumber)} msg/s per number.</p>
        </div>
      )}
    </>
  );
}
