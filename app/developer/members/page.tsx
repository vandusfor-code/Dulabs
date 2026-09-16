"use client";

import { useState } from "react";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { puedeGestionarMiembros } from "@/lib/dev-dashboard/dev-permissions";
import { mensajeDeError } from "@/lib/dev-dashboard/dev-errors";
import { PageHeader } from "@/components/developer/PageHeader";
import { DataTable } from "@/components/developer/DataTable";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { EmptyState } from "@/components/developer/EmptyState";
import { ErrorState } from "@/components/developer/ErrorState";
import { TableSkeleton } from "@/components/developer/Skeleton";
import { Modal } from "@/components/developer/Modal";
import { ConfirmDialog } from "@/components/developer/ConfirmDialog";
import { formatearFecha } from "@/lib/dev-dashboard/dev-format";
import type { MemberMeta } from "@/lib/dev-dashboard/dev-client";
import type { RolDev } from "@/lib/dev-dashboard/dev-permissions";

const ROLES: RolDev[] = ["OWNER", "ADMIN", "MEMBER"];

export default function MembersPage() {
  const { client, rol, userId, selectedWorkspaceId } = useDeveloper();
  const puede = puedeGestionarMiembros(rol);
  const { data, loading, error, reload } = useDevResource(selectedWorkspaceId, async () => (selectedWorkspaceId ? (await client.members.list()).members : null));

  const [crearAbierto, setCrearAbierto] = useState(false);
  const [nuevoUserId, setNuevoUserId] = useState("");
  const [nuevoRol, setNuevoRol] = useState<RolDev>("MEMBER");
  const [eliminar, setEliminar] = useState<MemberMeta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);

  const crear = async () => {
    setOcupado(true);
    setAccionError(null);
    try {
      await client.members.create({ userId: nuevoUserId.trim(), rol: nuevoRol });
      setCrearAbierto(false);
      setNuevoUserId("");
      setNuevoRol("MEMBER");
      reload();
    } catch (err) {
      setAccionError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const cambiarRol = async (m: MemberMeta, r: RolDev) => {
    setAccionError(null);
    try {
      await client.members.updateRole(m.id, r);
      reload();
    } catch (err) {
      setAccionError(mensajeDeError(err));
    }
  };

  const confirmarEliminar = async () => {
    if (!eliminar) return;
    setOcupado(true);
    setAccionError(null);
    try {
      await client.members.remove(eliminar.id);
      setEliminar(null);
      reload();
    } catch (err) {
      setAccionError(mensajeDeError(err));
      setEliminar(null);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Members"
        description="People with access to this workspace. Only owners can manage members."
        actions={puede ? <button onClick={() => setCrearAbierto(true)} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">Add member</button> : null}
      />

      {accionError ? <div className="mb-4"><ErrorState error={new Error(accionError)} /></div> : null}

      {loading ? (
        <TableSkeleton cols={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <EmptyState title="Select a workspace" />
      ) : (
        <DataTable<MemberMeta>
          rows={data}
          rowKey={(m) => m.id}
          empty={<EmptyState title="No explicit members yet" description={puede ? "Add teammates by their user ID and assign a role." : "This workspace has no additional members."} />}
          columns={[
            { key: "user", header: "User", render: (m) => <span className="font-mono text-xs text-fg">{m.userId.slice(0, 12)}…{m.userId === userId ? <span className="ml-2 text-[10px] uppercase tracking-wide text-dev-accent">you</span> : null}</span> },
            {
              key: "rol",
              header: "Role",
              render: (m) =>
                puede ? (
                  <select value={m.rol} onChange={(e) => cambiarRol(m, e.target.value as RolDev)} className="rounded-md border border-edge bg-ink px-2 py-1 text-xs text-fg outline-none focus:border-dev-accent">
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                ) : (
                  <StatusBadge tono="info">{m.rol}</StatusBadge>
                ),
            },
            { key: "estado", header: "Status", render: (m) => <StatusBadge tono={m.estado === "activo" ? "success" : "neutral"}>{m.estado}</StatusBadge> },
            { key: "created", header: "Added", render: (m) => <span className="text-xs text-mist">{formatearFecha(m.createdAt)}</span> },
            { key: "actions", header: "", align: "right", render: (m) => (puede ? <button onClick={() => setEliminar(m)} className="rounded-md border border-edge px-2 py-1 text-xs font-medium text-danger-text hover:bg-ink-2">Remove</button> : null) },
          ]}
        />
      )}

      <Modal open={crearAbierto} onClose={() => setCrearAbierto(false)} title="Add member">
        <p className="text-xs text-mist">Fase 9 no incluye invitaciones por email todavía. Ingresa el user ID (Supabase Auth) de una cuenta existente.</p>
        <label className="mt-3 block text-sm text-mist">User ID</label>
        <input value={nuevoUserId} onChange={(e) => setNuevoUserId(e.target.value)} placeholder="uuid del usuario" className="mt-1 w-full rounded-md border border-edge bg-ink px-3 py-2 font-mono text-xs text-fg outline-none focus:border-dev-accent" />
        <label className="mt-3 block text-sm text-mist">Role</label>
        <select value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value as RolDev)} className="mt-1 w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent">
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setCrearAbierto(false)} disabled={ocupado} className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-2 disabled:opacity-50">Cancel</button>
          <button onClick={crear} disabled={ocupado || !nuevoUserId.trim()} className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50">{ocupado ? "Adding…" : "Add member"}</button>
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(eliminar)} title="Remove member" description="This removes the member's access to the workspace." confirmLabel="Remove" danger loading={ocupado} onConfirm={confirmarEliminar} onClose={() => setEliminar(null)} />
    </>
  );
}
