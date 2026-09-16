"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { esSesionExpirada, mensajeDeError } from "@/lib/dev-dashboard/dev-errors";
import { PageHeader } from "@/components/developer/PageHeader";
import { DataTable } from "@/components/developer/DataTable";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { EmptyState } from "@/components/developer/EmptyState";
import { ErrorState } from "@/components/developer/ErrorState";
import { TableSkeleton } from "@/components/developer/Skeleton";
import { labelEstadoJob, tonoEstadoJob, truncarWamid, formatearFechaHora } from "@/lib/dev-dashboard/dev-format";
import type { JobResumen, JobsResp } from "@/lib/dev-dashboard/dev-client";

type Extra = { ws: string | null; jobs: JobResumen[]; cursor: string | null };

export default function JobsPage() {
  const router = useRouter();
  const { client, selectedWorkspaceId } = useDeveloper();

  // Primera página vía el hook estándar (loading/error/reload). Las páginas
  // adicionales se acumulan en un handler de evento (nunca en un efecto).
  const base = useDevResource<JobsResp>(selectedWorkspaceId, async () =>
    selectedWorkspaceId ? client.jobs({ limit: 20 }) : Promise.resolve({ jobs: [], nextCursor: null })
  );

  const [extra, setExtra] = useState<Extra>({ ws: null, jobs: [], cursor: null });
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorMas, setErrorMas] = useState<string | null>(null);

  const extraVigente: Extra = extra.ws === selectedWorkspaceId ? extra : { ws: selectedWorkspaceId, jobs: [], cursor: null };
  const jobsMostrados = [...(base.data?.jobs ?? []), ...extraVigente.jobs];
  const cursorActual = extraVigente.jobs.length ? extraVigente.cursor : base.data?.nextCursor ?? null;

  const refrescar = () => {
    setExtra({ ws: selectedWorkspaceId, jobs: [], cursor: null });
    setErrorMas(null);
    base.reload();
  };

  const cargarMas = async () => {
    if (!cursorActual) return;
    setCargandoMas(true);
    setErrorMas(null);
    try {
      const res = await client.jobs({ limit: 20, cursor: cursorActual });
      setExtra({ ws: selectedWorkspaceId, jobs: [...extraVigente.jobs, ...res.jobs], cursor: res.nextCursor });
    } catch (err) {
      if (esSesionExpirada(err)) {
        router.replace("/login?next=/developer");
        return;
      }
      setErrorMas(mensajeDeError(err));
    } finally {
      setCargandoMas(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Jobs / Logs"
        description="Outbound message jobs for this workspace, most recent first."
        actions={<button onClick={refrescar} disabled={base.loading} className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-2 disabled:opacity-50">Refresh</button>}
      />
      {base.loading ? (
        <TableSkeleton cols={5} />
      ) : base.error ? (
        <ErrorState error={base.error} onRetry={base.reload} />
      ) : !selectedWorkspaceId ? (
        <EmptyState title="Select a workspace" />
      ) : (
        <>
          <DataTable<JobResumen>
            rows={jobsMostrados}
            rowKey={(j) => j.id}
            empty={<EmptyState title="No jobs yet" description="Jobs appear here once you send messages through the API." />}
            columns={[
              { key: "id", header: "Job", render: (j) => <span className="font-mono text-xs">{j.id.slice(0, 8)}…</span> },
              { key: "status", header: "Status", render: (j) => <StatusBadge tono={tonoEstadoJob(j.status)}>{labelEstadoJob(j.status)}</StatusBadge> },
              { key: "outcome", header: "Physical", render: (j) => <span className="text-xs text-mist">{j.physical_outcome}</span> },
              { key: "attempts", header: "Attempts", render: (j) => <span className="tabular-nums text-xs text-mist">{j.network_attempts}</span> },
              { key: "delivery", header: "Delivery", render: (j) => <span className="text-xs text-mist">{j.delivery_status ?? "—"}</span> },
              { key: "wamid", header: "wamid", render: (j) => <span className="font-mono text-xs text-mist">{truncarWamid(j.wamid)}</span> },
              { key: "created", header: "Created", align: "right", render: (j) => <span className="text-xs text-mist">{formatearFechaHora(j.created_at)}</span> },
            ]}
          />
          {errorMas ? <p className="mt-3 text-sm text-danger-text">{errorMas}</p> : null}
          {cursorActual ? (
            <div className="mt-4 flex justify-center">
              <button onClick={cargarMas} disabled={cargandoMas} className="rounded-md border border-edge bg-card px-4 py-1.5 text-sm font-medium text-fg hover:bg-ink-2 disabled:opacity-50">
                {cargandoMas ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
