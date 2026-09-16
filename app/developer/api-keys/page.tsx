"use client";

import { useState } from "react";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { puedeGestionarRecursos } from "@/lib/dev-dashboard/dev-permissions";
import { mensajeDeError } from "@/lib/dev-dashboard/dev-errors";
import { PageHeader } from "@/components/developer/PageHeader";
import { DataTable } from "@/components/developer/DataTable";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { EmptyState } from "@/components/developer/EmptyState";
import { ErrorState } from "@/components/developer/ErrorState";
import { TableSkeleton } from "@/components/developer/Skeleton";
import { Modal } from "@/components/developer/Modal";
import { ConfirmDialog } from "@/components/developer/ConfirmDialog";
import { SecretRevealDialog } from "@/components/developer/SecretRevealDialog";
import { labelEstadoApiKey, tonoEstadoApiKey, formatearFecha } from "@/lib/dev-dashboard/dev-format";
import type { ApiKeyMeta } from "@/lib/dev-dashboard/dev-client";

export default function ApiKeysPage() {
  const { client, rol, selectedWorkspaceId } = useDeveloper();
  const puedeGestionar = puedeGestionarRecursos(rol);
  const { data, loading, error, reload } = useDevResource(selectedWorkspaceId, async () => (selectedWorkspaceId ? (await client.apiKeys.list()).apiKeys : null));

  const [crearAbierto, setCrearAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [secreto, setSecreto] = useState<string | null>(null);
  const [revocar, setRevocar] = useState<ApiKeyMeta | null>(null);
  const [rotar, setRotar] = useState<ApiKeyMeta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);

  const crear = async () => {
    setOcupado(true);
    setAccionError(null);
    try {
      const res = await client.apiKeys.create(nombre.trim());
      setCrearAbierto(false);
      setNombre("");
      setSecreto(res.apiKey); // solo en memoria hasta que el usuario cierre el diálogo
      reload();
    } catch (err) {
      setAccionError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const confirmarRevocar = async () => {
    if (!revocar) return;
    setOcupado(true);
    setAccionError(null);
    try {
      await client.apiKeys.revoke(revocar.id);
      setRevocar(null);
      reload();
    } catch (err) {
      setAccionError(mensajeDeError(err));
      setRevocar(null);
    } finally {
      setOcupado(false);
    }
  };

  const confirmarRotar = async () => {
    if (!rotar) return;
    setOcupado(true);
    setAccionError(null);
    try {
      const res = await client.apiKeys.rotate(rotar.id);
      setRotar(null);
      setSecreto(res.apiKey);
      reload();
    } catch (err) {
      setAccionError(mensajeDeError(err));
      setRotar(null);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Authenticate requests to the DuLabs Developer API with dl_live_ keys. Keys are shown once."
        actions={
          puedeGestionar ? (
            <button onClick={() => setCrearAbierto(true)} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">
              Create API key
            </button>
          ) : null
        }
      />

      {accionError ? <div className="mb-4"><ErrorState error={new Error(accionError)} /></div> : null}

      {loading ? (
        <TableSkeleton cols={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data ? (
        <DataTable<ApiKeyMeta>
          rows={data}
          rowKey={(k) => k.id}
          empty={<EmptyState title="No API keys yet" description={puedeGestionar ? "Create your first key to start calling the API." : "No API keys have been created for this workspace."} action={puedeGestionar ? <button onClick={() => setCrearAbierto(true)} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">Create API key</button> : undefined} />}
          columns={[
            { key: "name", header: "Name", render: (k) => <span className="font-medium text-fg">{k.name}</span> },
            { key: "prefix", header: "Key", render: (k) => <span className="font-mono text-xs text-mist">{k.prefix}…</span> },
            { key: "status", header: "Status", render: (k) => <StatusBadge tono={tonoEstadoApiKey(k.revoked_at)}>{labelEstadoApiKey(k.revoked_at)}</StatusBadge> },
            { key: "created", header: "Created", render: (k) => <span className="text-xs text-mist">{formatearFecha(k.created_at)}</span> },
            { key: "last_used", header: "Last used", render: (k) => <span className="text-xs text-mist">{formatearFecha(k.last_used_at)}</span> },
            {
              key: "actions",
              header: "",
              align: "right",
              render: (k) =>
                puedeGestionar && !k.revoked_at ? (
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setRotar(k)} className="rounded-md border border-edge px-2 py-1 text-xs font-medium text-fg hover:bg-ink-2">Rotate</button>
                    <button onClick={() => setRevocar(k)} className="rounded-md border border-edge px-2 py-1 text-xs font-medium text-danger-text hover:bg-ink-2">Revoke</button>
                  </div>
                ) : null,
            },
          ]}
        />
      ) : (
        <EmptyState title="Select a workspace" />
      )}

      <Modal open={crearAbierto} onClose={() => setCrearAbierto(false)} title="Create API key">
        <label className="block text-sm text-mist">Name</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="e.g. production-server"
          className="mt-1 w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setCrearAbierto(false)} disabled={ocupado} className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-2 disabled:opacity-50">Cancel</button>
          <button onClick={crear} disabled={ocupado || !nombre.trim()} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50">{ocupado ? "Creating…" : "Create"}</button>
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(revocar)} title="Revoke API key" description={`This immediately disables "${revocar?.name}". Applications using it will stop working.`} confirmLabel="Revoke" danger loading={ocupado} onConfirm={confirmarRevocar} onClose={() => setRevocar(null)} />
      <ConfirmDialog open={Boolean(rotar)} title="Rotate API key" description={`A new key will be created and "${rotar?.name}" will be revoked. Update your applications with the new key.`} confirmLabel="Rotate" loading={ocupado} onConfirm={confirmarRotar} onClose={() => setRotar(null)} />

      {secreto ? <SecretRevealDialog open title="Your new API key" secret={secreto} onClose={() => setSecreto(null)} /> : null}
    </>
  );
}
