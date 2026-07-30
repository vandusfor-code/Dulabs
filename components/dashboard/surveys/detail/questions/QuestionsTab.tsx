"use client";

import { useMemo, useState } from "react";
import { getSurveyQuestions } from "@/lib/survey-questions";
import { QuestionNavigator } from "./QuestionNavigator";
import { QuestionAnalyticsPanel } from "./QuestionAnalyticsPanel";

export function QuestionsTab({ surveyId, onToast }: { surveyId: string; onToast: (msg: string) => void }) {
  const data = useMemo(() => getSurveyQuestions(surveyId), [surveyId]);
  const { questions, analytics, completed } = data;

  // Selección inicial: 3ª pregunta (como el mockup) o la primera disponible.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => questions[2]?.id ?? questions[0]?.id ?? null
  );

  const index = questions.findIndex((q) => q.id === selectedId);
  const selected = index >= 0 ? questions[index] : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
      <QuestionNavigator
        questions={questions}
        analytics={analytics}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selected ? (
        <QuestionAnalyticsPanel
          key={selected.id}
          question={selected}
          analytics={analytics[selected.id]}
          index={index}
          total={questions.length}
          completed={completed}
          onToast={onToast}
        />
      ) : (
        <div className="rounded-xl border border-edge bg-card p-8 text-center text-sm text-mist">—</div>
      )}
    </div>
  );
}
