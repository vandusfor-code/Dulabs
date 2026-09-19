"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import { getBusinessAgentReadiness } from "@/lib/business-agent-client";
import type { ReadinessReport } from "@/lib/business-agent-readiness";
import { IssuesList } from "@/components/dashboard/business-agent/ui";

/**
 * Revisión final antes de publicar (R8): "Tu agente está configurado para…", bloqueos y advertencias. Muestra
 * EXACTAMENTE lo que el servidor va a exigir al publicar (mismo validador, lib/business-agent-readiness.ts): si aquí hay un
 * bloqueo, el servidor también rechaza la publicación. `onReport` le avisa al padre para deshabilitar el botón.
 */
export function ReadinessPanel({ flowVersionId, onReport }: { flowVersionId: string; onReport?: (r: ReadinessReport | null) => void }) {
  const { t } = useI18n();
  const { session } = useDashboard();
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelado = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReport(null);
    setError(null);
    void getBusinessAgentReadiness({ accessToken: session.access_token, flowVersionId }).then((r) => {
      if (cancelado) return;
      if (r.ok) {
        setReport(r.data);
        onReport?.(r.data);
      } else {
        setError(r.error.message);
        onReport?.(null);
      }
    });
    return () => {
      cancelado = true;
    };
    // onReport es estable en el padre (setState); solo re-evalúa al cambiar la versión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, flowVersionId]);

  if (error) return <p className="mt-2 text-xs text-red-400">{error}</p>;
  if (!report) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-mist">
        <Loader2 className="size-3.5 animate-spin" /> {t("Revisando tu agente…", "Reviewing your agent…")}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {report.summary.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-mist">{t("Tu agente está configurado para:", "Your agent is set up to:")}</p>
          <ul className="space-y-1.5">
            {report.summary.map((s) => (
              <li key={s.capability} className="rounded-lg border border-edge bg-ink px-3 py-2 text-sm">
                <div className="flex items-center gap-2 text-fg">
                  <CheckCircle2 className="size-4 shrink-0 text-lime-text" />
                  <span className="font-medium">{s.label}</span>
                </div>
                {s.details.length > 0 && <p className="mt-0.5 pl-6 text-xs text-mist">{s.details.join(" · ")}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.blockers.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-red-400">{t("Falta esto para poder publicar:", "This is missing before you can publish:")}</p>
          <IssuesList issues={report.blockers.map((b) => b.message)} tone="danger" />
        </div>
      )}
      {report.warnings.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-mist">{t("Ten en cuenta:", "Keep in mind:")}</p>
          <IssuesList issues={report.warnings.map((w) => w.message)} tone="warning" />
        </div>
      )}
      {report.ready && report.blockers.length === 0 && (
        <p className="text-xs text-lime-text">{t("Todo listo: el agente puede funcionar con esta configuración.", "All set: the agent can work with this configuration.")}</p>
      )}
    </div>
  );
}
