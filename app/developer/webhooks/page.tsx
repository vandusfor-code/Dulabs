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
import { SecretRevealDialog } from "@/components/developer/SecretRevealDialog";
import { formatearFecha } from "@/lib/dev-dashboard/dev-format";
import type { WebhookMeta, NumberMeta } from "@/lib/dev-dashboard/dev-client";

export default function WebhooksPage() {
  const { client, rol, selectedWorkspaceId } = useDeveloper();
  const puedeGestionar = puedeGestionarRecursos(rol);
  const { data, loading, error, reload } = useDevResource(selectedWorkspaceId, async () => {
    if (!selectedWorkspaceId) return null;
    const [webhooks, numbers] = await Promise.all([client.webhooks.list(), client.numbers.list()]);
    return { webhooks: webhooks.webhooks, numbers: numbers.numbers };
  });

  const [crearAbierto, setCrearAbierto] = useState(false);
  const [numeroId, setNumeroId] = useState("");
  const [url, setUrl] = useState("");
  const [secreto, setSecreto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);
  const [pingId, setPingId] = useState<string | null>(null);
  const [pingAviso, setPingAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  const probar = async (w: WebhookMeta) => {
    if (pingId) return;
    setPingId(w.id);
    setPingAviso(null);
    try {
      const r = await client.webhooks.ping(w.whatsappNumberId);
      setPingAviso(
        r.ok
          ? { tono: "ok", texto: `Webhook respondió ${r.status} en ${r.latencyMs} ms (evento de prueba ${r.eventId}).` }
          : { tono: "error", texto: `Sin respuesta válida (${r.error ?? `status ${r.status}`}) en ${r.latencyMs} ms.` }
      );
    } catch (err) {
      setPingAviso({ tono: "error", texto: mensajeDeError(err) });
    } finally {
      setPingId(null);
    }
  };

  const abrirCrear = () => {
    setNumeroId(data?.numbers[0]?.id ?? "");
    setUrl("");
    setAccionError(null);
    setCrearAbierto(true);
  };

  const crear = async () => {
    setOcupado(true);
    setAccionError(null);
    try {
      const res = await client.webhooks.create({ whatsappNumberId: numeroId, url: url.trim() });
      setCrearAbierto(false);
      setSecreto(res.secret);
      reload();
    } catch (err) {
      setAccionError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const puedeCrear = puedeGestionar && (data?.numbers.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Receive inbound messages and delivery status. Signing secrets are shown once at creation."
        actions={puedeCrear ? <button onClick={abrirCrear} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">Add webhook</button> : null}
      />

      {accionError ? <div className="mb-4"><ErrorState error={new Error(accionError)} /></div> : null}
      {pingAviso ? <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${pingAviso.tono === "ok" ? "border-success-text/30 bg-success text-success-text" : "border-danger-text/30 bg-danger text-danger-text"}`}>{pingAviso.texto}</div> : null}

      {loading ? (
        <TableSkeleton cols={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <EmptyState title="Select a workspace" />
      ) : (
        <DataTable<WebhookMeta>
          rows={data.webhooks}
          rowKey={(w) => w.id}
          empty={<EmptyState title="No webhooks configured" description={puedeGestionar ? (data.numbers.length === 0 ? "Connect a WhatsApp number first, then add a webhook for it." : "Add a webhook to start receiving events.") : "No webhooks have been configured for this workspace."} action={puedeCrear ? <button onClick={abrirCrear} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">Add webhook</button> : undefined} />}
          columns={[
            { key: "url", header: "Endpoint URL", render: (w) => <span className="font-mono text-xs text-fg">{w.url}</span> },
            { key: "status", header: "Status", render: (w) => <StatusBadge tono={w.status === "activo" ? "success" : "neutral"}>{w.status}</StatusBadge> },
            { key: "signed", header: "Signing", render: () => <span className="text-xs text-mist">HMAC · secret hidden</span> },
            { key: "created", header: "Created", render: (w) => <span className="text-xs text-mist">{formatearFecha(w.createdAt)}</span> },
            ...(puedeGestionar
              ? [{
                  key: "test",
                  header: "Test",
                  align: "right" as const,
                  render: (w: WebhookMeta) => (
                    <button onClick={() => probar(w)} disabled={pingId !== null || w.status !== "activo"} className="rounded-md border border-edge px-2.5 py-1 text-xs text-fg hover:bg-white/5 disabled:opacity-50">
                      {pingId === w.id ? "Probando…" : "Probar"}
                    </button>
                  ),
                }]
              : []),
          ]}
        />
      )}

      <Modal open={crearAbierto} onClose={() => setCrearAbierto(false)} title="Add webhook">
        <label className="block text-sm text-mist">WhatsApp number</label>
        <select value={numeroId} onChange={(e) => setNumeroId(e.target.value)} className="mt-1 w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent">
          {data?.numbers.map((n: NumberMeta) => (
            <option key={n.id} value={n.id}>
              {n.displayName ?? n.phoneNumberId}
            </option>
          ))}
        </select>
        <label className="mt-3 block text-sm text-mist">Endpoint URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.yourapp.com/webhooks/dulabs" className="mt-1 w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent" />
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setCrearAbierto(false)} disabled={ocupado} className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-2 disabled:opacity-50">Cancel</button>
          <button onClick={crear} disabled={ocupado || !numeroId || !url.trim()} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50">{ocupado ? "Saving…" : "Add webhook"}</button>
        </div>
      </Modal>

      {secreto ? <SecretRevealDialog open title="Webhook signing secret" secret={secreto} description="Use this to verify the X-DuLabs-Signature header. You won't be able to see it again." onClose={() => setSecreto(null)} /> : null}
    </>
  );
}
