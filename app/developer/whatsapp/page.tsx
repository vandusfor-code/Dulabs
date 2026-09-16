"use client";

import { useState } from "react";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { puedeGestionarRecursos } from "@/lib/dev-dashboard/dev-permissions";
import { PageHeader } from "@/components/developer/PageHeader";
import { DataTable } from "@/components/developer/DataTable";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { EmptyState } from "@/components/developer/EmptyState";
import { ErrorState } from "@/components/developer/ErrorState";
import { TableSkeleton } from "@/components/developer/Skeleton";
import { Modal } from "@/components/developer/Modal";
import { tonoEstadoNumero, formatearFecha } from "@/lib/dev-dashboard/dev-format";
import type { NumberMeta } from "@/lib/dev-dashboard/dev-client";

export default function WhatsAppPage() {
  const { client, rol, selectedWorkspaceId } = useDeveloper();
  const puedeGestionar = puedeGestionarRecursos(rol);
  const { data, loading, error, reload } = useDevResource(selectedWorkspaceId, async () => (selectedWorkspaceId ? (await client.numbers.list()).numbers : null));
  const [connectAbierto, setConnectAbierto] = useState(false);

  const connectCTA = puedeGestionar ? (
    <button onClick={() => setConnectAbierto(true)} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">
      Connect WhatsApp
    </button>
  ) : null;

  return (
    <>
      <PageHeader title="WhatsApp Numbers" description="Numbers connected to this workspace. Access tokens are never displayed." actions={connectCTA} />

      {loading ? (
        <TableSkeleton cols={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <EmptyState title="Select a workspace" />
      ) : (
        <DataTable<NumberMeta>
          rows={data}
          rowKey={(n) => n.id}
          empty={<EmptyState title="No WhatsApp numbers yet" description="Connect a number to start sending and receiving messages. Connection runs through Meta's official signup." action={connectCTA ?? undefined} />}
          columns={[
            { key: "name", header: "Display name", render: (n) => <span className="font-medium text-fg">{n.displayName ?? "—"}</span> },
            { key: "pnid", header: "phone_number_id", render: (n) => <span className="font-mono text-xs text-mist">{n.phoneNumberId}</span> },
            { key: "status", header: "Status", render: (n) => <StatusBadge tono={tonoEstadoNumero(n.status)}>{n.status}</StatusBadge> },
            { key: "created", header: "Connected", align: "right", render: (n) => <span className="text-xs text-mist">{formatearFecha(n.createdAt)}</span> },
          ]}
        />
      )}

      <Modal open={connectAbierto} onClose={() => setConnectAbierto(false)} title="Connect WhatsApp">
        <p className="text-sm text-mist">
          Number connection uses Meta&apos;s official Embedded Signup. This guided flow is part of onboarding and will be available shortly.
        </p>
        <p className="mt-2 text-sm text-mist">You&apos;ll authorize a WhatsApp Business number with Meta — DuLabs never asks you to paste access tokens here.</p>
        <div className="mt-5 flex justify-end">
          <button onClick={() => setConnectAbierto(false)} className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-2">Got it</button>
        </div>
      </Modal>
    </>
  );
}
