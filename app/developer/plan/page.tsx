"use client";

import { useState } from "react";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { puedeGestionarRecursos } from "@/lib/dev-dashboard/dev-permissions";
import { PageHeader } from "@/components/developer/PageHeader";
import { StatCard } from "@/components/developer/StatCard";
import { UsageProgress } from "@/components/developer/UsageProgress";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { ErrorState } from "@/components/developer/ErrorState";
import { EmptyState } from "@/components/developer/EmptyState";
import { CardsSkeleton } from "@/components/developer/Skeleton";
import { formatearLimite } from "@/lib/dev-dashboard/dev-format";
import { DevApiError, type SubscriptionResp } from "@/lib/dev-dashboard/dev-client";

// DuLabs Developer V1 -- Fase 11 (autorizado). Vista de Plan & Límites a nivel
// de CUENTA. Muestra plan, estado, precio, y uso vs límite de
// números/mensajes/workspaces/miembros. OWNER/ADMIN pueden cambiar de plan.
// El enforcement real vive en el backend; esta pantalla solo informa/dispara.

const PLANES = [
  { codigo: "DEVELOPER", label: "Developer", precio: "$19/mo", resumen: "2 numbers · 20K messages · 1 workspace · 1 member" },
  { codigo: "AGENCY", label: "Agency", precio: "$45/mo", resumen: "5 numbers · 100K messages · 5 workspaces · 5 members · +$5/extra number" },
  { codigo: "ENTERPRISE", label: "Enterprise", precio: "$199+/mo", resumen: "Custom numbers/messages/workspaces/members" },
];

export default function PlanPage() {
  const { client, rol, selectedWorkspaceId } = useDeveloper();
  const puedeGestionar = puedeGestionarRecursos(rol);
  const esOwner = rol === "OWNER";
  const { data, loading, error, reload } = useDevResource<SubscriptionResp | null>(selectedWorkspaceId, async () =>
    selectedWorkspaceId ? await client.subscription.get() : null
  );
  const [accion, setAccion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  async function cambiarPlan(codigo: string) {
    if (!esOwner || accion) return;
    setAccion(codigo);
    setAviso(null);
    try {
      await client.subscription.changePlan(codigo);
      setAviso({ tono: "ok", texto: `Plan actualizado a ${codigo}.` });
      reload();
    } catch (err) {
      const msg =
        err instanceof DevApiError
          ? err.code === "downgrade_blocked"
            ? `No se puede bajar de plan: tienes recursos por encima del nuevo límite (${err.detalle ?? ""}). Reduce números/workspaces/miembros primero.`
            : err.detalle ?? err.code ?? "No se pudo cambiar el plan."
          : String(err);
      setAviso({ tono: "error", texto: msg });
    } finally {
      setAccion(null);
    }
  }

  return (
    <>
      <PageHeader title="Plan & Limits" description="Your account subscription and usage. Meta messaging fees are billed separately by Meta (no DuLabs markup)." />

      {loading ? (
        <CardsSkeleton count={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <EmptyState title="Select a workspace" />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tono="info">{data.planName}</StatusBadge>
            <span className="text-sm text-mist">{data.pricing.monthlyUsd !== null ? `$${data.pricing.monthlyUsd}/mo` : "Custom"}</span>
            {data.estado === "past_due" ? <StatusBadge tono="danger">Past due</StatusBadge> : data.estado === "canceled" ? <StatusBadge tono="warning">Canceled</StatusBadge> : <StatusBadge tono="success">Active</StatusBadge>}
            <span className="text-sm text-mist">Period {data.period}</span>
          </div>

          {data.consumoBloqueado ? (
            <div className="rounded-lg border border-danger-text/30 bg-danger px-4 py-3 text-sm text-danger-text">
              Your subscription is not active. Reading and administration stay available, but sending messages, connecting numbers and buying add-ons are blocked until it&apos;s resolved.
            </div>
          ) : null}
          {aviso ? (
            <div className={`rounded-lg border px-4 py-3 text-sm ${aviso.tono === "ok" ? "border-success-text/30 bg-success text-success-text" : "border-danger-text/30 bg-danger text-danger-text"}`}>{aviso.texto}</div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-edge bg-card p-5">
              <h2 className="text-sm font-semibold text-fg">Messages this period</h2>
              <div className="mt-4"><UsageProgress used={data.messages.used} included={data.messages.included} unidad="messages" /></div>
            </div>
            <div className="rounded-lg border border-edge bg-card p-5">
              <h2 className="text-sm font-semibold text-fg">WhatsApp numbers</h2>
              <div className="mt-4"><UsageProgress used={data.numbers.used} included={data.numbers.max} unidad="numbers" /></div>
              <p className="mt-2 text-xs text-mist">{data.numbers.included !== null ? `${data.numbers.included} included` : "custom"}{data.numbers.additional > 0 ? ` + ${data.numbers.additional} additional` : ""}. {data.numbers.canBuyAdditional ? "Add-ons: $5/number." : "Additional numbers require Agency."}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Workspaces" value={`${data.workspaces.used} / ${formatearLimite(data.workspaces.included)}`} />
            <StatCard label="Team members" value={`${data.members.used} / ${formatearLimite(data.members.included)}`} />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-fg">Plans</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {PLANES.map((p) => {
                const actual = p.codigo === data.plan;
                return (
                  <div key={p.codigo} className={`rounded-lg border p-4 ${actual ? "border-dev-accent bg-dev-accent-soft" : "border-edge bg-card"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-fg">{p.label}</span>
                      <span className="text-sm text-mist">{p.precio}</span>
                    </div>
                    <p className="mt-2 text-xs text-mist">{p.resumen}</p>
                    {actual ? (
                      <p className="mt-3 text-xs font-medium text-dev-accent">Current plan</p>
                    ) : esOwner && p.codigo !== "ENTERPRISE" ? (
                      <button
                        onClick={() => cambiarPlan(p.codigo)}
                        disabled={accion !== null}
                        className="mt-3 rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50"
                      >
                        {accion === p.codigo ? "Working…" : p.codigo === "DEVELOPER" ? "Switch to Developer" : "Upgrade to Agency"}
                      </button>
                    ) : p.codigo === "ENTERPRISE" ? (
                      <p className="mt-3 text-xs text-mist">Contact sales</p>
                    ) : !puedeGestionar ? (
                      <p className="mt-3 text-xs text-mist">Only OWNER can change the plan</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
