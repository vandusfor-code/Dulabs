"use client";

import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { PageHeader } from "@/components/developer/PageHeader";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { ErrorState } from "@/components/developer/ErrorState";
import { EmptyState } from "@/components/developer/EmptyState";
import { CardsSkeleton } from "@/components/developer/Skeleton";

function Fila({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-edge py-3 last:border-0">
      <span className="text-sm text-mist">{label}</span>
      <span className={`text-sm text-fg ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { client, email, userId, selectedWorkspaceId, rol } = useDeveloper();
  const { data, loading, error, reload } = useDevResource(selectedWorkspaceId, async () => (selectedWorkspaceId ? await client.usage() : null));

  return (
    <>
      <PageHeader title="Settings" description="Workspace and developer account details." />
      {loading ? (
        <CardsSkeleton count={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !selectedWorkspaceId ? (
        <EmptyState title="Select a workspace" />
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-edge bg-card p-5">
            <h2 className="mb-2 text-sm font-semibold text-fg">Workspace</h2>
            <Fila label="Workspace ID" value={selectedWorkspaceId} mono />
            <Fila label="Plan" value={data?.plan ?? "—"} />
            <Fila label="Your role" value={rol ?? "—"} />
          </section>

          <section className="rounded-lg border border-edge bg-card p-5">
            <h2 className="mb-2 text-sm font-semibold text-fg">Developer account</h2>
            <Fila label="Email" value={email ?? "—"} />
            <Fila label="User ID" value={userId} mono />
          </section>

          <section className="rounded-lg border border-edge bg-card p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-fg">Plan &amp; billing</h2>
              <StatusBadge tono="neutral">Coming soon</StatusBadge>
            </div>
            <p className="mt-2 text-sm text-mist">Subscriptions, invoices and plan changes will be available in a later phase.</p>
          </section>
        </div>
      )}
    </>
  );
}
