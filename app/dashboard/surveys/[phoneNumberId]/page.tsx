"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight, Calendar, ListChecks, Send, Users, CircleX, CircleCheck, Info, MessageSquare } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import { completedCount, nonEffectiveCount, completionRate, pct, formatUpdatedAt, type SurveyDetail } from "@/lib/survey-detail";
import type { SurveyQuestionsData } from "@/lib/survey-questions";
import { SurveyDetailTabs, type DetailTab } from "@/components/dashboard/surveys/detail/SurveyDetailTabs";
import { SurveyDetailKpi } from "@/components/dashboard/surveys/detail/SurveyDetailKpi";
import { ResultadoBaseTable } from "@/components/dashboard/surveys/detail/ResultadoBaseTable";
import { EffectivenessBar } from "@/components/dashboard/surveys/detail/EffectivenessBar";
import { NonEffectiveBreakdown } from "@/components/dashboard/surveys/detail/NonEffectiveBreakdown";
import { QuestionsTab } from "@/components/dashboard/surveys/detail/questions/QuestionsTab";

const nf = (n: number) => n.toLocaleString("es-CO");
const pf = (n: number) => n.toLocaleString("es-CO", { minimumFractionDigits: n % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 });

const ORANGE = "#f59e0b";
const VIOLET = "#a78bfa";

type Participante = {
  telefono: string;
  nombre: string | null;
  estado: string;
  respondidas: number;
  totalPreguntas: number;
  recordatoriosEnviados: number;
  ultimaInteraccion: string | null;
};

type RespuestaLibre = { id: string; pregunta: string; texto: string };

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
    completed: { label: t("Finalizada", "Finished"), className: "bg-lime/8 text-lime-text/85" },
    draft: { label: t("Borrador", "Draft"), className: "bg-ink text-mist" },
  } as const;
  const s = map[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

function MetaItem({ children }: { children: React.ReactNode }) {
  return <span className="flex items-center gap-1.5 text-mist">{children}</span>;
}

const ESTADO_LABEL: Record<string, { es: string; en: string; tone: string }> = {
  invited: { es: "Invitado", en: "Invited", tone: "bg-ink text-mist" },
  started: { es: "Iniciada", en: "Started", tone: "bg-sky-400/15 text-sky-400" },
  in_progress: { es: "En progreso", en: "In progress", tone: "bg-sky-400/15 text-sky-400" },
  paused: { es: "Pausada", en: "Paused", tone: "bg-amber-400/15 text-amber-400" },
  resume_scheduled: { es: "Reanudación programada", en: "Resume scheduled", tone: "bg-amber-400/15 text-amber-400" },
  completed: { es: "Completada", en: "Completed", tone: "bg-lime/12 text-lime-text" },
  declined: { es: "Declinó", en: "Declined", tone: "bg-violet-500/15 text-violet-300" },
  expired: { es: "Vencida", en: "Expired", tone: "bg-red-500/15 text-red-400" },
};

export default function SurveyDetailPage() {
  const { t, lang } = useI18n();
  const params = useParams();
  const phoneNumberId = Array.isArray(params.phoneNumberId) ? params.phoneNumberId[0] : (params.phoneNumberId ?? "");
  const { session } = useDashboard();

  const [detail, setDetail] = useState<SurveyDetail | null>(null);
  const [questionsData, setQuestionsData] = useState<SurveyQuestionsData | null>(null);
  const [participantes, setParticipantes] = useState<Participante[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("resumen");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(h);
  }, [toast]);

  useEffect(() => {
    if (!session || !phoneNumberId) return;
    fetch(`/api/dashboard/surveys/${encodeURIComponent(phoneNumberId)}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? t("Encuesta no encontrada", "Survey not found"));
        setDetail(json.detail);
        setQuestionsData(json.questionsData);
        setParticipantes(json.participantes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, phoneNumberId, t]);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-lg font-semibold text-fg">{error}</p>
        <Link href="/dashboard/surveys" className="mt-3 text-sm font-medium text-lime-text hover:opacity-80">
          {t("← Volver a Encuestas", "← Back to Surveys")}
        </Link>
      </div>
    );
  }

  if (!detail || !questionsData || !participantes) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-mist">{t("Cargando…", "Loading…")}</div>;
  }

  const completed = completedCount(detail);
  const nonEffective = nonEffectiveCount(detail);

  const respuestasLibres: RespuestaLibre[] = questionsData.questions
    .filter((q) => q.type === "free_text")
    .flatMap((q) => (questionsData.analytics[q.id]?.textResponses ?? []).map((r) => ({ id: r.id, pregunta: q.text, texto: r.text })));

  return (
    <div className="pb-12">
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
              {detail.endDate && (
                <>
                  <span className="text-mist/40">·</span>
                  <MetaItem>
                    <Calendar className="size-3.5" /> {t("Cierra", "Closes")} {new Date(detail.endDate + "T00:00:00").toLocaleDateString(lang === "en" ? "en-US" : "es-CO")}
                  </MetaItem>
                </>
              )}
              <span className="text-mist/40">·</span>
              <MetaItem>
                <ListChecks className="size-3.5" /> {detail.questionCount} {t("preguntas", "questions")}
              </MetaItem>
            </div>
          </div>
          <Link
            href={`/dashboard/surveys/new?phone_number_id=${phoneNumberId}`}
            className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90"
          >
            {t("Editar encuesta →", "Edit survey →")}
          </Link>
        </div>
      </div>

      <div className="mt-4 border-b border-edge px-4 md:px-8">
        <SurveyDetailTabs active={activeTab} onChange={setActiveTab} />
      </div>

      <div className="px-4 py-6 md:px-8">
        {activeTab === "resumen" ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SurveyDetailKpi icon={Send} accent="var(--color-lime)" label={t("Encuestas enviadas", "Surveys sent")} value={nf(detail.sent)} hint={t("100% del total objetivo", "100% of the target base")} />
              <SurveyDetailKpi
                icon={Users}
                accent="var(--color-lime)"
                label={t("Respondieron encuesta", "Completed the survey")}
                value={nf(completed)}
                hint={
                  <>
                    <span className="font-medium text-lime-text">{pf(pct(completed, detail.sent))}%</span> {t("del total enviado", "of total sent")}
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

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
              <ResultadoBaseTable detail={detail} />
              <div className="grid content-start gap-4">
                <EffectivenessBar detail={detail} />
                <NonEffectiveBreakdown detail={detail} />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-edge bg-card px-4 py-3 text-xs text-mist">
              <Info className="size-3.5 shrink-0" />
              {t(`Última actualización: ${formatUpdatedAt(detail.updatedAt, "es")}`, `Last updated: ${formatUpdatedAt(detail.updatedAt, "en")}`)}
            </div>
          </>
        ) : activeTab === "preguntas" ? (
          <QuestionsTab data={questionsData} onToast={showToast} />
        ) : activeTab === "respuestas" ? (
          respuestasLibres.length === 0 ? (
            <div className="rounded-xl border border-dashed border-edge bg-card p-10 text-center text-sm text-mist">
              <MessageSquare className="mx-auto mb-3 size-8 text-mist/40" strokeWidth={1.2} />
              {t("Todavía no hay respuestas de texto libre.", "There are no open-text responses yet.")}
            </div>
          ) : (
            <div className="space-y-2.5">
              {respuestasLibres.map((r) => (
                <div key={r.id} className="rounded-xl border border-edge bg-card p-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{r.pregunta}</p>
                  <p className="mt-1.5 text-sm text-fg">{r.texto}</p>
                </div>
              ))}
            </div>
          )
        ) : participantes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-edge bg-card p-10 text-center text-sm text-mist">
            <Users className="mx-auto mb-3 size-8 text-mist/40" strokeWidth={1.2} />
            {t("Todavía no has invitado a ningún participante.", "You haven't invited any participant yet.")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-edge bg-card">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 border-b border-edge px-4 py-2.5">
              {[t("Participante", "Participant"), t("Estado", "Status"), t("Progreso", "Progress"), t("Última interacción", "Last interaction")].map((c) => (
                <span key={c} className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                  {c}
                </span>
              ))}
            </div>
            <div className="divide-y divide-edge">
              {participantes.map((p) => {
                const estado = ESTADO_LABEL[p.estado] ?? { es: p.estado, en: p.estado, tone: "bg-ink text-mist" };
                return (
                  <div key={p.telefono} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{p.nombre || p.telefono}</p>
                      {p.nombre && <p className="truncate text-xs text-mist">{p.telefono}</p>}
                    </div>
                    <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${estado.tone}`}>{t(estado.es, estado.en)}</span>
                    <span className="tabular-nums text-mist">
                      {p.respondidas} / {p.totalPreguntas}
                    </span>
                    <span className="text-mist">{p.ultimaInteraccion ? new Date(p.ultimaInteraccion).toLocaleString(lang === "en" ? "en-US" : "es-CO") : "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
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
