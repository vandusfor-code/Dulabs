"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ChevronRight,
  Pause,
  Play,
  Download,
  MoreHorizontal,
  Calendar,
  ListChecks,
  Tag,
  Send,
  Users,
  CircleX,
  CircleCheck,
  Info,
  RotateCw,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  getSurveyDetail,
  completedCount,
  nonEffectiveCount,
  completionRate,
  pct,
  formatDateRange,
  formatUpdatedAt,
  type SurveyDetail,
} from "@/lib/survey-detail";
import { SurveyDetailTabs, type DetailTab } from "@/components/dashboard/surveys/detail/SurveyDetailTabs";
import { SurveyDetailKpi } from "@/components/dashboard/surveys/detail/SurveyDetailKpi";
import { ResultadoBaseTable } from "@/components/dashboard/surveys/detail/ResultadoBaseTable";
import { EffectivenessBar } from "@/components/dashboard/surveys/detail/EffectivenessBar";
import { NonEffectiveBreakdown } from "@/components/dashboard/surveys/detail/NonEffectiveBreakdown";
import { TabPlaceholder } from "@/components/dashboard/surveys/builder/TabPlaceholder";
import { QuestionsTab } from "@/components/dashboard/surveys/detail/questions/QuestionsTab";

const nf = (n: number) => n.toLocaleString("es-CO");
const pf = (n: number) => n.toLocaleString("es-CO", { minimumFractionDigits: n % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 });

const ORANGE = "#f59e0b";
const VIOLET = "#a78bfa";

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.97L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.8c2.17 0 4.21.85 5.74 2.38a8.06 8.06 0 0 1 2.38 5.73c0 4.48-3.65 8.12-8.13 8.12a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.12.82.83-3.04-.19-.31a8.07 8.07 0 0 1-1.24-4.29c0-4.48 3.65-8.12 8.12-8.12Zm4.7 10.28c-.26-.13-1.51-.75-1.75-.83-.24-.09-.4-.13-.58.13-.17.26-.66.83-.81 1-.15.17-.3.19-.55.06-.26-.13-1.08-.4-2.06-1.27-.76-.68-1.28-1.52-1.43-1.78-.15-.26-.02-.4.11-.53.12-.12.26-.3.39-.46.13-.15.17-.26.26-.43.09-.17.04-.32-.02-.45-.06-.13-.58-1.4-.8-1.92-.21-.5-.42-.43-.58-.44l-.5-.01c-.17 0-.45.06-.68.32-.24.26-.9.88-.9 2.15 0 1.27.92 2.5 1.05 2.67.13.17 1.82 2.78 4.4 3.9.61.26 1.09.42 1.47.54.62.2 1.18.17 1.62.1.49-.07 1.51-.62 1.73-1.21.21-.6.21-1.1.15-1.21-.06-.11-.24-.17-.5-.3Z" />
    </svg>
  );
}

function StatusBadge({ status }: { status: SurveyDetail["status"] }) {
  const { t } = useI18n();
  const map = {
    active: { label: t("Activa", "Active"), className: "bg-lime/12 text-lime-text" },
    paused: { label: t("Pausada", "Paused"), className: "bg-amber-400/15 text-amber-400" },
    completed: { label: t("Completada", "Completed"), className: "bg-lime/8 text-lime-text/85" },
    draft: { label: t("Borrador", "Draft"), className: "bg-ink text-mist" },
  } as const;
  const s = map[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

function MetaItem({ children }: { children: React.ReactNode }) {
  return <span className="flex items-center gap-1.5 text-mist">{children}</span>;
}

export default function SurveyDetailPage() {
  const { t, lang } = useI18n();
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
  const detail = getSurveyDetail(id);

  const [activeTab, setActiveTab] = useState<DetailTab>("resumen");
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(h);
  }, [toast]);

  if (!detail) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-lg font-semibold text-fg">{t("Encuesta no encontrada", "Survey not found")}</p>
        <Link href="/dashboard/surveys" className="mt-3 text-sm font-medium text-lime-text hover:opacity-80">
          {t("← Volver a Encuestas", "← Back to Surveys")}
        </Link>
      </div>
    );
  }

  const completed = completedCount(detail);
  const nonEffective = nonEffectiveCount(detail);
  const actionBtn =
    "flex items-center gap-2 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-fg transition-colors hover:border-lime/40";

  return (
    <div className="pb-12">
      {/* Header */}
      <div className="px-4 pt-5 md:px-8">
        <nav className="flex items-center gap-1.5 text-sm text-mist" aria-label="Breadcrumb">
          <Link href="/dashboard/surveys" className="transition-colors hover:text-fg">
            {t("Encuestas", "Surveys")}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="truncate text-fg">{detail.name}</span>
        </nav>

        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-fg md:text-[26px]">{detail.name}</h1>
              <StatusBadge status={detail.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <MetaItem>
                <WhatsAppGlyph className="size-4 text-lime-text" /> WhatsApp
              </MetaItem>
              {detail.startDate && detail.endDate && (
                <>
                  <span className="text-mist/40">·</span>
                  <MetaItem>
                    <Calendar className="size-3.5" /> {formatDateRange(detail.startDate, detail.endDate, lang)}
                  </MetaItem>
                </>
              )}
              <span className="text-mist/40">·</span>
              <MetaItem>
                <ListChecks className="size-3.5" /> {detail.questionCount} {t("preguntas", "questions")}
              </MetaItem>
              {detail.service && (
                <>
                  <span className="text-mist/40">·</span>
                  <MetaItem>
                    <Tag className="size-3.5" /> {detail.service}
                  </MetaItem>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setToast(
                  detail.status === "paused"
                    ? t("Reanudar estará disponible con el backend", "Resuming will be available with the backend")
                    : t("Pausar estará disponible con el backend", "Pausing will be available with the backend")
                )
              }
              className={actionBtn}
            >
              {detail.status === "paused" ? <Play className="size-4" /> : <Pause className="size-4" />}
              {detail.status === "paused" ? t("Reanudar encuesta", "Resume survey") : t("Pausar encuesta", "Pause survey")}
            </button>
            <button
              type="button"
              onClick={() => setToast(t("La exportación estará disponible con el backend", "Export will be available with the backend"))}
              className={actionBtn}
            >
              <Download className="size-4" /> {t("Exportar", "Export")}
            </button>
            <button
              type="button"
              aria-label={t("Más acciones", "More actions")}
              onClick={() => setToast(t("Más acciones próximamente", "More actions coming soon"))}
              className="flex size-9 items-center justify-center rounded-lg border border-edge text-mist transition-colors hover:border-lime/40 hover:text-fg"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 border-b border-edge px-4 md:px-8">
        <SurveyDetailTabs active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Content */}
      <div className="px-4 py-6 md:px-8">
        {activeTab === "resumen" ? (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SurveyDetailKpi
                icon={Send}
                accent="var(--color-lime)"
                label={t("Encuestas enviadas", "Surveys sent")}
                value={nf(detail.sent)}
                hint={t("100% del total objetivo", "100% of the target base")}
              />
              <SurveyDetailKpi
                icon={Users}
                accent="var(--color-lime)"
                label={t("Respondieron encuesta", "Completed the survey")}
                value={nf(completed)}
                hint={
                  <>
                    <span className="font-medium text-lime-text">{pf(pct(completed, detail.sent))}%</span>{" "}
                    {t("del total enviado", "of total sent")}
                  </>
                }
              />
              <SurveyDetailKpi
                icon={CircleX}
                accent={ORANGE}
                label={t("No efectivas", "Non-effective")}
                value={nf(nonEffective)}
                hint={
                  <>
                    <span className="font-medium" style={{ color: ORANGE }}>
                      {pf(pct(nonEffective, detail.sent))}%
                    </span>{" "}
                    {t("del total enviado", "of total sent")}
                  </>
                }
              />
              <SurveyDetailKpi
                icon={CircleCheck}
                accent={VIOLET}
                label={t("Tasa de finalización", "Completion rate")}
                value={`${pf(completionRate(detail))}%`}
                hint={<span style={{ color: VIOLET }}>{t("De quienes iniciaron", "Of those who started")}</span>}
              />
            </div>

            {/* Main grid */}
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
              <ResultadoBaseTable detail={detail} />
              <div className="grid content-start gap-4">
                <EffectivenessBar detail={detail} />
                <NonEffectiveBreakdown detail={detail} />
              </div>
            </div>

            {/* Footer strip */}
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-edge bg-card px-4 py-3 text-xs text-mist sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-1.5">
                <Info className="size-3.5 shrink-0" />
                {t(
                  `Los datos se actualizan cada 15 minutos. Última actualización: ${formatUpdatedAt(detail.updatedAt, "es")}`,
                  `Data refreshes every 15 minutes. Last updated: ${formatUpdatedAt(detail.updatedAt, "en")}`
                )}
              </span>
              <span className="flex items-center gap-2">
                {t("Zona horaria", "Time zone")}: (GMT-5) Bogotá, Lima, Quito
                <button
                  type="button"
                  aria-label={t("Actualizar", "Refresh")}
                  title={t("Actualizar", "Refresh")}
                  onClick={() => setToast(t("La actualización en vivo llegará con el backend", "Live refresh will arrive with the backend"))}
                  className="flex size-7 items-center justify-center rounded-md text-mist transition-colors hover:bg-ink hover:text-fg"
                >
                  <RotateCw className="size-3.5" />
                </button>
              </span>
            </div>
          </>
        ) : activeTab === "preguntas" ? (
          <QuestionsTab surveyId={detail.id} onToast={setToast} />
        ) : activeTab === "respuestas" ? (
          <TabPlaceholder
            icon={CircleCheck}
            title={t("Respuestas", "Responses")}
            description={t(
              "Aquí verás las respuestas individuales y el texto libre analizado por IA.",
              "Here you'll see individual responses and open text analyzed by AI."
            )}
            bullets={[
              t("Respuestas individuales por participante", "Individual responses per participant"),
              t("Sentimiento y temas del texto libre", "Sentiment and topics from open text"),
            ]}
          />
        ) : (
          <TabPlaceholder
            icon={Users}
            title={t("Participantes", "Participants")}
            description={t(
              "Listado de participantes con su estado y progreso en la encuesta.",
              "List of participants with their status and progress in the survey."
            )}
            bullets={[
              t("Estado por participante (completó, en progreso, etc.)", "Status per participant (completed, in progress, etc.)"),
              t("Reanudaciones programadas y recordatorios", "Scheduled resumes and reminders"),
            ]}
          />
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-edge bg-card px-4 py-2.5 text-sm text-fg shadow-xl" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
