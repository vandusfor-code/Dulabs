"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Save, Send, Play, Workflow, Sparkles, LifeBuoy, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  createBlankQuestion,
  createDemoDraft,
  estimatedMinutes,
  isChoiceType,
  isScaleType,
  newQuestionId,
  type SurveyQuestion,
} from "@/lib/survey-builder";
import { BuilderTabs, type BuilderTab } from "@/components/dashboard/surveys/builder/BuilderTabs";
import { QuestionsList } from "@/components/dashboard/surveys/builder/QuestionsList";
import { QuestionEditor } from "@/components/dashboard/surveys/builder/QuestionEditor";
import { WhatsAppPreview } from "@/components/dashboard/surveys/builder/WhatsAppPreview";
import { SummaryBar } from "@/components/dashboard/surveys/builder/SummaryBar";
import { TabPlaceholder } from "@/components/dashboard/surveys/builder/TabPlaceholder";

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Asegura los campos coherentes con el tipo (opciones para choice, etiquetas para escala). */
function normalize(q: SurveyQuestion): SurveyQuestion {
  const next = { ...q };
  if (isChoiceType(next.type)) {
    if (!next.options || next.options.length === 0) next.options = ["", ""];
  }
  if (isScaleType(next.type)) {
    next.minLabel ??= "";
    next.maxLabel ??= "";
  }
  return next;
}

export default function CreateSurveyPage() {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => createDemoDraft());
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const d = draft;
    return d.questions[2]?.id ?? d.questions[0]?.id ?? null;
  });
  const [activeTab, setActiveTab] = useState<BuilderTab>("questions");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const questions = draft.questions;
  const selectedIndex = questions.findIndex((q) => q.id === selectedId);
  const selectedQuestion = selectedIndex >= 0 ? questions[selectedIndex] : null;

  const setQuestions = (next: SurveyQuestion[]) => setDraft((d) => ({ ...d, questions: next }));

  const updateQuestion = (id: string, patch: Partial<SurveyQuestion>) =>
    setQuestions(questions.map((q) => (q.id === id ? normalize({ ...q, ...patch }) : q)));

  const addQuestion = () => {
    const q = createBlankQuestion();
    const at = selectedIndex >= 0 ? selectedIndex + 1 : questions.length;
    const next = [...questions];
    next.splice(at, 0, q);
    setQuestions(next);
    setSelectedId(q.id);
  };

  const duplicateQuestion = (id: string) => {
    const idx = questions.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const copy: SurveyQuestion = {
      ...questions[idx],
      id: newQuestionId(),
      options: questions[idx].options ? [...questions[idx].options!] : undefined,
    };
    const next = [...questions];
    next.splice(idx + 1, 0, copy);
    setQuestions(next);
    setSelectedId(copy.id);
  };

  const deleteQuestion = (id: string) => {
    const idx = questions.findIndex((q) => q.id === id);
    if (idx < 0) return;
    const next = questions.filter((q) => q.id !== id);
    setQuestions(next);
    if (selectedId === id) {
      setSelectedId(next[Math.min(idx, next.length - 1)]?.id ?? null);
    }
  };

  const moveQuestion = (id: string, dir: -1 | 1) => {
    const idx = questions.findIndex((q) => q.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= questions.length) return;
    setQuestions(arrayMove(questions, idx, to));
  };

  const reorder = (from: number, to: number) => setQuestions(arrayMove(questions, from, to));

  const actionBtn =
    "flex items-center gap-2 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-fg transition-colors hover:border-lime/40";

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col lg:flex-row">
      {/* Work area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="border-b border-edge px-4 py-5 md:px-6">
          <nav className="flex items-center gap-1.5 text-sm text-mist" aria-label="Breadcrumb">
            <Link href="/dashboard/surveys" className="transition-colors hover:text-fg">
              {t("Encuestas", "Surveys")}
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="text-fg">{t("Nueva encuesta", "New survey")}</span>
          </nav>

          <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-semibold tracking-tight text-fg md:text-[26px]">
                  {t("Crear encuesta", "Create survey")}
                </h1>
                <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-medium text-mist">
                  {t("Borrador", "Draft")}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-mist">
                {t(
                  "Crea y configura tu encuesta conversacional para WhatsApp.",
                  "Build and configure your conversational survey for WhatsApp."
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setToast(t("Borrador guardado localmente", "Draft saved locally"))} className={actionBtn}>
                <Save className="size-4" /> {t("Guardar borrador", "Save draft")}
              </button>
              <button
                type="button"
                onClick={() => setToast(t("La prueba estará disponible al conectar WhatsApp", "Testing will be available once WhatsApp is connected"))}
                className={actionBtn}
              >
                <Send className="size-4" /> {t("Probar encuesta", "Test survey")}
              </button>
              <button
                type="button"
                onClick={() => setToast(t("Publicar estará disponible cuando conectemos el backend", "Publishing will be available once the backend is connected"))}
                className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90"
              >
                <Play className="size-4" /> {t("Publicar encuesta", "Publish survey")}
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <BuilderTabs active={activeTab} onChange={setActiveTab} />

        {/* Tab content */}
        <div className="flex-1 px-4 py-5 md:px-6">
          {activeTab === "questions" ? (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <QuestionsList
                  questions={questions}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onAdd={addQuestion}
                  onDuplicate={duplicateQuestion}
                  onDelete={deleteQuestion}
                  onMove={moveQuestion}
                  onReorder={reorder}
                />
                {selectedQuestion ? (
                  <QuestionEditor
                    key={selectedQuestion.id}
                    question={selectedQuestion}
                    index={selectedIndex}
                    onChange={(patch) => updateQuestion(selectedQuestion.id, patch)}
                    onDuplicate={() => duplicateQuestion(selectedQuestion.id)}
                    onDelete={() => deleteQuestion(selectedQuestion.id)}
                  />
                ) : (
                  <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-edge bg-card p-6 text-center text-sm text-mist">
                    {t("Selecciona o agrega una pregunta para editarla.", "Select or add a question to edit it.")}
                  </div>
                )}
              </div>

              <div className="mt-4">
                <SummaryBar
                  estMinutes={estimatedMinutes(questions.length)}
                  totalQuestions={questions.length}
                  conditionalPaths={draft.conditionalPaths}
                  completionGoal={draft.completionGoal}
                />
              </div>
            </>
          ) : activeTab === "flow" ? (
            <TabPlaceholder
              icon={Workflow}
              title={t("Flujo condicional", "Conditional flow")}
              description={t(
                "Define reglas simples para ramificar la encuesta según las respuestas.",
                "Define simple rules to branch the survey based on answers."
              )}
              bullets={[
                t("SI la respuesta de Qx ES un valor, ENTONCES ir a Qy", "IF answer of Qx IS a value, THEN go to Qy"),
                t("Saltos y rutas condicionales entre preguntas", "Jumps and conditional paths between questions"),
              ]}
            />
          ) : activeTab === "engagement" ? (
            <TabPlaceholder
              icon={Sparkles}
              title={t("Interacción", "Engagement")}
              description={t(
                "Mensajes configurables para mantener al participante avanzando.",
                "Configurable messages to keep the participant moving forward."
              )}
              bullets={[
                t("Mensajes al 25% y 50% de avance", "Messages at 25% and 50% progress"),
                t("Aviso cuando faltan 2 preguntas", "Nudge when 2 questions remain"),
                t("Mensaje al completar la encuesta", "Message on completion"),
              ]}
            />
          ) : activeTab === "recovery" ? (
            <TabPlaceholder
              icon={LifeBuoy}
              title={t("Recuperación", "Recovery")}
              description={t(
                "Recordatorios amables para retomar encuestas abandonadas.",
                "Friendly reminders to resume abandoned surveys."
              )}
              bullets={[
                t("Retraso del primer recordatorio y máximo de recordatorios", "First reminder delay and max reminders"),
                t("Botones Continuar / Más tarde / No deseo continuar", "Continue / Later / Stop buttons"),
                t("Programar reanudación respetando la fecha límite", "Schedule resume respecting the deadline"),
              ]}
            />
          ) : (
            <TabPlaceholder
              icon={Settings}
              title={t("Ajustes", "Settings")}
              description={t(
                "Configuración general del envío y ciclo de vida de la encuesta.",
                "General settings for delivery and the survey lifecycle."
              )}
              bullets={[
                t("Inicio, vencimiento y número de WhatsApp", "Start, expiry, and WhatsApp number"),
                t("Campaña asociada", "Associated campaign"),
                t("Comportamiento al expirar", "Behavior on expiry"),
              ]}
            />
          )}
        </div>
      </div>

      {/* WhatsApp preview */}
      <aside className="shrink-0 border-t border-edge lg:w-[340px] lg:border-l lg:border-t-0 xl:w-[360px]">
        <div className="p-4 lg:sticky lg:top-16 md:p-6 lg:p-4">
          <WhatsAppPreview
            greeting={draft.greeting}
            questions={questions}
            selectedId={selectedId}
            onSelectScenario={(id) => setSelectedId(id)}
            onSendTest={() => setToast(t("La prueba estará disponible al conectar WhatsApp", "Testing will be available once WhatsApp is connected"))}
          />
        </div>
      </aside>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-edge bg-card px-4 py-2.5 text-sm text-fg shadow-xl" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
