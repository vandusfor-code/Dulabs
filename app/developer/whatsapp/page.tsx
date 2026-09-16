"use client";

import { useState } from "react";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { useDevMetaEmbeddedSignup } from "@/lib/hooks/use-dev-meta-embedded-signup";
import { puedeGestionarRecursos } from "@/lib/dev-dashboard/dev-permissions";
import { PageHeader } from "@/components/developer/PageHeader";
import { DataTable } from "@/components/developer/DataTable";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { EmptyState } from "@/components/developer/EmptyState";
import { ErrorState } from "@/components/developer/ErrorState";
import { TableSkeleton } from "@/components/developer/Skeleton";
import { ConfirmDialog } from "@/components/developer/ConfirmDialog";
import { tonoEstadoNumero, formatearFecha } from "@/lib/dev-dashboard/dev-format";
import type { NumberMeta } from "@/lib/dev-dashboard/dev-client";

export default function WhatsAppPage() {
  const { client, rol, selectedWorkspaceId } = useDeveloper();
  const puedeGestionar = puedeGestionarRecursos(rol);
  const { data, loading, error, reload } = useDevResource(selectedWorkspaceId, async () => (selectedWorkspaceId ? (await client.numbers.list()).numbers : null));
  const { data: usage } = useDevResource(selectedWorkspaceId, async () => (selectedWorkspaceId ? await client.usage() : null));

  const { estado, setEstado, conectar, configFaltante } = useDevMetaEmbeddedSignup({ client, onExito: reload });

  const [aDesconectar, setADesconectar] = useState<NumberMeta | null>(null);
  const [desconectando, setDesconectando] = useState(false);

  const limiteAlcanzado = Boolean(usage && usage.numbers.available !== null && usage.numbers.available <= 0);
  const conectando = estado.fase === "conectando";

  async function ejecutarDesconexion() {
    if (!aDesconectar) return;
    setDesconectando(true);
    try {
      await client.numbers.disconnect(aDesconectar.id);
      setADesconectar(null);
      reload();
    } finally {
      setDesconectando(false);
    }
  }

  const botonConectar =
    puedeGestionar && !limiteAlcanzado ? (
      <button
        onClick={conectar}
        disabled={configFaltante || conectando || estado.fase === "cargando"}
        className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50"
      >
        {conectando ? "Connecting…" : "Connect WhatsApp"}
      </button>
    ) : null;

  return (
    <>
      <PageHeader title="WhatsApp Numbers" description="Numbers connected to this workspace via Meta's official Embedded Signup. Access tokens are never displayed." actions={botonConectar} />

      {/* Banda de estado del flujo de conexión (states 2/3/4) */}
      {configFaltante && puedeGestionar ? (
        <div className="mb-4 rounded-lg border border-warning-text/30 bg-warning px-4 py-3 text-sm text-warning-text">
          Embedded Signup is not configured on this environment yet. Connection will be available once Meta credentials are set.
        </div>
      ) : null}
      {estado.fase === "conectando" ? (
        <div className="mb-4 rounded-lg border border-edge bg-card px-4 py-3 text-sm text-mist">Opening Meta&apos;s secure signup… complete the steps in the popup, then we&apos;ll verify the number.</div>
      ) : null}
      {estado.fase === "exito" ? (
        <div className="mb-4 rounded-lg border border-success-text/30 bg-success px-4 py-3 text-sm text-success-text">
          {estado.resp.reconnected ? "Number reconnected" : "Number connected"}: <span className="font-medium">{estado.resp.displayPhoneNumber}</span>
          {estado.resp.webhookSubscribed ? "" : " — webhook subscription is pending on Meta's side."}
        </div>
      ) : null}
      {estado.fase === "error" ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-danger-text/30 bg-danger px-4 py-3 text-sm text-danger-text">
          <span>{estado.mensaje}</span>
          <button onClick={() => setEstado({ fase: "listo" })} className="shrink-0 rounded-md border border-danger-text/40 px-2 py-1 text-xs font-medium hover:opacity-80">Dismiss</button>
        </div>
      ) : null}
      {(estado.fase === "limite" || limiteAlcanzado) && puedeGestionar ? (
        <div className="mb-4 rounded-lg border border-warning-text/30 bg-warning px-4 py-3 text-sm text-warning-text">
          This workspace reached its included number limit{usage ? ` (${usage.numbers.used}/${usage.numbers.included})` : ""}. Upgrade the plan to connect another number.
        </div>
      ) : null}

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
          empty={
            <EmptyState
              title="No WhatsApp numbers yet"
              description="Connect a WhatsApp Business number through Meta's official Embedded Signup. DuLabs never asks you to paste access tokens — the token is obtained and encrypted on the server."
              action={botonConectar ?? undefined}
            />
          }
          columns={[
            { key: "name", header: "Display name", render: (n) => <span className="font-medium text-fg">{n.displayName ?? "—"}</span> },
            { key: "pnid", header: "phone_number_id", render: (n) => <span className="font-mono text-xs text-mist">{n.phoneNumberId}</span> },
            { key: "status", header: "Status", render: (n) => <StatusBadge tono={tonoEstadoNumero(n.status)}>{n.status}</StatusBadge> },
            { key: "created", header: "Connected", render: (n) => <span className="text-xs text-mist">{formatearFecha(n.createdAt)}</span> },
            ...(puedeGestionar
              ? [
                  {
                    key: "actions",
                    header: "",
                    align: "right" as const,
                    render: (n: NumberMeta) =>
                      n.status === "conectado" ? (
                        <button onClick={() => setADesconectar(n)} className="rounded-md border border-edge px-2 py-1 text-xs font-medium text-mist hover:border-danger-text/40 hover:text-danger-text">
                          Disconnect
                        </button>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      )}

      <ConfirmDialog
        open={aDesconectar !== null}
        title="Disconnect number"
        description={
          aDesconectar
            ? `Disconnect ${aDesconectar.displayName ?? aDesconectar.phoneNumberId}? This removes the stored Meta token from DuLabs and stops sending from this number. Your message history and usage are kept. This does not revoke the number inside Meta.`
            : undefined
        }
        confirmLabel="Disconnect"
        danger
        loading={desconectando}
        onConfirm={ejecutarDesconexion}
        onClose={() => setADesconectar(null)}
      />
    </>
  );
}
