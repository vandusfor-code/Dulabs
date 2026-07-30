"use client";

import { Check, Trash2, Copy, ChevronDown, Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  QUESTION_TYPE_ORDER,
  TYPE_META,
  isChoiceType,
  isScaleType,
  scaleRange,
  type QuestionType,
  type SurveyQuestion,
} from "@/lib/survey-builder";

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const MAX = { text: 400, label: 20, help: 100, option: 40 };

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={cn("mt-1 block text-right text-xs tabular-nums", value > max ? "text-red-400" : "text-mist")}>
      {value} / {max}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm text-mist">{label}</label>
      {children}
    </div>
  );
}

export function QuestionEditor({
  question,
  index,
  onChange,
  onDuplicate,
  onDelete,
}: {
  question: SurveyQuestion;
  index: number;
  onChange: (patch: Partial<SurveyQuestion>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const range = scaleRange(question.type);

  const setOption = (i: number, value: string) => {
    const options = [...(question.options ?? [])];
    options[i] = value;
    onChange({ options });
  };
  const addOption = () => onChange({ options: [...(question.options ?? []), ""] });
  const removeOption = (i: number) => {
    const options = (question.options ?? []).filter((_, idx) => idx !== i);
    onChange({ options });
  };

  const inputClass =
    "w-full rounded-lg border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-mist focus:border-lime/50";

  return (
    <div className="flex flex-col rounded-xl border border-edge bg-card p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">
          {t("Pregunta", "Question")} {String(index + 1).padStart(2, "0")}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ required: !question.required })}
            aria-pressed={question.required}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              question.required ? "bg-lime/12 text-lime-text" : "bg-ink text-mist hover:text-fg"
            )}
          >
            {question.required && <Check className="size-3.5" />}
            {question.required ? t("Obligatoria", "Required") : t("Opcional", "Optional")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t("Eliminar pregunta", "Delete question")}
            title={t("Eliminar pregunta", "Delete question")}
            className="flex size-8 items-center justify-center rounded-lg border border-edge text-mist transition-colors hover:border-red-500/40 hover:text-red-400"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {/* Question text */}
        <Field label={t("Texto de la pregunta", "Question text")}>
          <textarea
            rows={3}
            value={question.text}
            maxLength={MAX.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder={t("Escribe la pregunta…", "Write the question…")}
            className={cn(inputClass, "resize-none leading-relaxed")}
          />
          <Counter value={question.text.length} max={MAX.text} />
        </Field>

        {/* Response type */}
        <Field label={t("Tipo de respuesta", "Response type")}>
          <div className="relative">
            <select
              value={question.type}
              onChange={(e) => onChange({ type: e.target.value as QuestionType })}
              className={cn(inputClass, "appearance-none pr-10")}
            >
              {QUESTION_TYPE_ORDER.map((type) => (
                <option key={type} value={type}>
                  {t(TYPE_META[type].select.es, TYPE_META[type].select.en)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
          </div>
        </Field>

        {/* Scale labels */}
        {isScaleType(question.type) && range && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t(`Etiqueta mínima (${range[0]})`, `Minimum label (${range[0]})`)}>
              <input
                type="text"
                value={question.minLabel ?? ""}
                maxLength={MAX.label}
                onChange={(e) => onChange({ minLabel: e.target.value })}
                placeholder={t("Ej. Muy deficiente", "e.g. Very poor")}
                className={inputClass}
              />
              <Counter value={(question.minLabel ?? "").length} max={MAX.label} />
            </Field>
            <Field label={t(`Etiqueta máxima (${range[1]})`, `Maximum label (${range[1]})`)}>
              <input
                type="text"
                value={question.maxLabel ?? ""}
                maxLength={MAX.label}
                onChange={(e) => onChange({ maxLabel: e.target.value })}
                placeholder={t("Ej. Excelente", "e.g. Excellent")}
                className={inputClass}
              />
              <Counter value={(question.maxLabel ?? "").length} max={MAX.label} />
            </Field>
          </div>
        )}

        {/* Options (choice types) */}
        {isChoiceType(question.type) && (
          <Field label={t("Opciones", "Options")}>
            <div className="space-y-2">
              {(question.options ?? []).map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-ink font-mono text-xs text-mist">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={opt}
                    maxLength={MAX.option}
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={t(`Opción ${i + 1}`, `Option ${i + 1}`)}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    disabled={(question.options ?? []).length <= 1}
                    aria-label={t("Quitar opción", "Remove option")}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addOption}
              className="mt-2 flex items-center gap-1.5 text-sm font-medium text-lime-text transition-opacity hover:opacity-80"
            >
              <Plus className="size-4" /> {t("Agregar opción", "Add option")}
            </button>
          </Field>
        )}

        {/* Required toggle */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={question.required}
            onClick={() => onChange({ required: !question.required })}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
              question.required ? "bg-lime" : "bg-ink border border-edge"
            )}
          >
            <span
              className={cn(
                "inline-block size-4 rounded-full bg-white transition-transform",
                question.required ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
          <span className="text-sm text-fg">{t("Pregunta obligatoria", "Required question")}</span>
        </div>

        {/* Help text */}
        <Field label={t("Texto de ayuda (opcional)", "Help text (optional)")}>
          <input
            type="text"
            value={question.helpText ?? ""}
            maxLength={MAX.help}
            onChange={(e) => onChange({ helpText: e.target.value })}
            placeholder={t("Aclaración breve para el participante", "Short clarification for the participant")}
            className={inputClass}
          />
          <Counter value={(question.helpText ?? "").length} max={MAX.help} />
        </Field>
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-edge pt-5">
        <button
          type="button"
          onClick={onDuplicate}
          className="flex items-center gap-2 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-fg transition-colors hover:border-lime/40"
        >
          <Copy className="size-4" /> {t("Duplicar pregunta", "Duplicate question")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-2 rounded-lg border border-red-500/40 px-3.5 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          <Trash2 className="size-4" /> {t("Eliminar pregunta", "Delete question")}
        </button>
      </div>
    </div>
  );
}
