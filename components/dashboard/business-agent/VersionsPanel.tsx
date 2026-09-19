"use client";

import { useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import type { AgentVersionPublic, AgentSummaryPublic } from "@/lib/agent-compiler/api/business-agent-api";
import type { AgentVersionSummary } from "@/lib/agent-compiler/registry/types";
import { publishBusinessAgentDraft, rollbackBusinessAgent, setBusinessAgentActiveOnNumber } from "@/lib/business-agent-client";
import { Pill } from "@/components/dashboard/shell/ui";
import { actionBtn, IssuesList, primaryBtn, SectionCard } from "@/components/dashboard/business-agent/ui";

function diagText(d: { message: string; path?: string }): string {
  return d.path ? `${d.message} (${d.path})` : d.message;
}

export function VersionsPanel({
  agent,
  versions,
  onChanged,
  numeros,
}: {
  agent: AgentSummaryPublic;
  versions: AgentVersionSummary[];
  onChanged: () => void;
  numeros: { phone_number_id: string; nombre_negocio: string; flow_activo: boolean; flow_id: string | null }[];
}) {
  const { t } = useI18n();
  const { session } = useDashboard();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publicar = async (version: AgentVersionPublic) => {
    if (!session) return;
    setBusyAction(`publish-${version.flowVersionId}`);
    setError(null);
    const result = await publishBusinessAgentDraft({ accessToken: session.access_token, flowVersionId: version.flowVersionId, expectedChecksum: version.checksums.flow });
    setBusyAction(null);
    if (!result.ok) setError(result.error.message);
    else onChanged();
  };

  const rollback = async (flowVersionId: string) => {
    if (!session) return;
    if (!window.confirm(t("¿Volver a esta versión anterior? Reemplaza la versión publicada actual.", "Roll back to this earlier version? It replaces the current published version."))) return;
    setBusyAction(`rollback-${flowVersionId}`);
    setError(null);
    const result = await rollbackBusinessAgent({ accessToken: session.access_token, flowVersionId, confirm: true });
    setBusyAction(null);
    if (!result.ok) setError(result.error.message);
    else onChanged();
  };

  const alternarNumero = async (phoneNumberId: string, activar: boolean) => {
    if (!session) return;
    setBusyAction(`numero-${phoneNumberId}`);
    setError(null);
    const result = await setBusinessAgentActiveOnNumber({ accessToken: session.access_token, flowId: agent.flowId, phoneNumberId, active: activar });
    setBusyAction(null);
    if (!result.ok) setError(result.error);
    else onChanged();
  };

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

      <SectionCard title={t("Estado actual", "Current status")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-mist">{t("Publicado", "Published")}</p>
            {agent.published ? (
              <div className="rounded-lg border border-edge bg-ink p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-lime-text" />
                  <span className="text-sm font-medium text-fg">v{agent.published.versionNumber}</span>
                  <Pill tone="success">{t("Publicado", "Published")}</Pill>
                </div>
                <p className="mt-1 text-xs text-mist">{agent.published.publishedAt ? new Date(agent.published.publishedAt).toLocaleString() : "—"}</p>
              </div>
            ) : (
              <p className="text-sm text-mist">{t("Todavía no has publicado nada.", "You haven't published anything yet.")}</p>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-mist">{t("Borrador", "Draft")}</p>
            {agent.draft ? (
              <div className="rounded-lg border border-edge bg-ink p-3">
                <div className="flex items-center gap-2">
                  <CircleDashed className="size-4 text-mist" />
                  <span className="text-sm font-medium text-fg">v{agent.draft.versionNumber}</span>
                  <Pill tone={agent.draft.validationStatus === "validated" ? "success" : "warning"}>
                    {agent.draft.validationStatus === "validated" ? t("Válido", "Valid") : t("Con errores", "Has errors")}
                  </Pill>
                </div>
                {agent.draft.diagnostics.length > 0 && (
                  <div className="mt-2">
                    <IssuesList issues={agent.draft.diagnostics.map(diagText)} tone={agent.draft.validationStatus === "validated" ? "warning" : "danger"} />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => publicar(agent.draft!)}
                  disabled={agent.draft.validationStatus !== "validated" || busyAction !== null}
                  className={`${primaryBtn} mt-3`}
                >
                  {busyAction === `publish-${agent.draft.flowVersionId}` ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                  {t("Publicar esta versión", "Publish this version")}
                </button>
              </div>
            ) : (
              <p className="text-sm text-mist">{t("Nada pendiente de publicar.", "Nothing pending publish.")}</p>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("Conectar a un número de WhatsApp", "Connect to a WhatsApp number")} description={t("Solo se puede conectar un agente PUBLICADO.", "Only a PUBLISHED agent can be connected.")}>
        {numeros.length === 0 ? (
          <p className="text-sm text-mist">{t("Todavía no tienes ningún número conectado.", "You don't have any connected number yet.")}</p>
        ) : (
          <ul className="space-y-1.5">
            {numeros.map((n) => {
              const activo = n.flow_activo && n.flow_id === agent.flowId;
              return (
                <li key={n.phone_number_id} className="flex items-center justify-between rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm">
                  <span className="text-fg">{n.nombre_negocio}</span>
                  <div className="flex items-center gap-2">
                    {activo && <Pill tone="success">{t("Conectado", "Connected")}</Pill>}
                    <button
                      type="button"
                      onClick={() => alternarNumero(n.phone_number_id, !activo)}
                      disabled={!agent.published || busyAction !== null}
                      className={actionBtn}
                    >
                      {busyAction === `numero-${n.phone_number_id}` ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {activo ? t("Desconectar", "Disconnect") : t("Conectar", "Connect")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={t("Historial de versiones", "Version history")}>
        {versions.length === 0 ? (
          <p className="text-sm text-mist">{t("Sin versiones todavía.", "No versions yet.")}</p>
        ) : (
          <ul className="space-y-1.5">
            {versions.map((v) => {
              const esPublicada = agent.published?.flowVersionId === v.flowVersionId;
              return (
                <li key={v.flowVersionId} className="flex items-center justify-between rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg">v{v.versionNumber}</span>
                    {esPublicada && <Pill tone="success">{t("Publicada", "Published")}</Pill>}
                    {v.retiredAt && !esPublicada && <Pill tone="neutral">{t("Reemplazada", "Superseded")}</Pill>}
                    <Pill tone={v.validationStatus === "validated" ? "success" : v.validationStatus === "failed" ? "danger" : "neutral"}>{v.validationStatus}</Pill>
                  </div>
                  {!esPublicada && v.validationStatus === "validated" && (
                    <button type="button" onClick={() => rollback(v.flowVersionId)} disabled={busyAction !== null} className={actionBtn}>
                      {busyAction === `rollback-${v.flowVersionId}` ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                      {t("Volver a esta versión", "Roll back to this")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
