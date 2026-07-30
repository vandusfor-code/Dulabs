"use client";

import { ArrowLeft, MoreVertical, Smile, Paperclip, Camera, Mic, ChevronDown, Info, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { TYPE_META, scaleRange, type SurveyQuestion } from "@/lib/survey-builder";

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.97L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.8c2.17 0 4.21.85 5.74 2.38a8.06 8.06 0 0 1 2.38 5.73c0 4.48-3.65 8.12-8.13 8.12a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.12.82.83-3.04-.19-.31a8.07 8.07 0 0 1-1.24-4.29c0-4.48 3.65-8.12 8.12-8.12Zm4.7 10.28c-.26-.13-1.51-.75-1.75-.83-.24-.09-.4-.13-.58.13-.17.26-.66.83-.81 1-.15.17-.3.19-.55.06-.26-.13-1.08-.4-2.06-1.27-.76-.68-1.28-1.52-1.43-1.78-.15-.26-.02-.4.11-.53.12-.12.26-.3.39-.46.13-.15.17-.26.26-.43.09-.17.04-.32-.02-.45-.06-.13-.58-1.4-.8-1.92-.21-.5-.42-.43-.58-.44l-.5-.01c-.17 0-.45.06-.68.32-.24.26-.9.88-.9 2.15 0 1.27.92 2.5 1.05 2.67.13.17 1.82 2.78 4.4 3.9.61.26 1.09.42 1.47.54.62.2 1.18.17 1.62.1.49-.07 1.51-.62 1.73-1.21.21-.6.21-1.1.15-1.21-.06-.11-.24-.17-.5-.3Z" />
    </svg>
  );
}

function ReplyButtons({ question }: { question: SurveyQuestion }) {
  const { t } = useI18n();
  const btn =
    "flex items-center justify-center rounded-xl bg-white px-3 py-2.5 text-sm font-medium text-[#111b21] shadow-sm ring-1 ring-black/5";
  const range = scaleRange(question.type);

  if (range) {
    const [min, max] = range;
    const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    const cols = nums.length <= 5 ? nums.length : nums.length === 11 ? 6 : 5;
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {nums.map((n) => (
          <div key={n} className={btn}>
            {n}
          </div>
        ))}
      </div>
    );
  }

  if (question.type === "yes_no") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className={btn}>{t("Sí", "Yes")}</div>
        <div className={btn}>{t("No", "No")}</div>
      </div>
    );
  }

  if (question.type === "single_choice" || question.type === "multiple_choice") {
    const opts = (question.options ?? []).filter((o) => o.trim() !== "");
    if (opts.length === 0) return null;
    return (
      <div className="space-y-2">
        {opts.map((o, i) => (
          <div key={i} className={cn(btn, "justify-start gap-2 text-left")}>
            {question.type === "multiple_choice" && (
              <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[#25d366]" />
            )}
            {o}
          </div>
        ))}
      </div>
    );
  }

  return null; // open_text / message → sin botones
}

export function WhatsAppPreview({
  businessName = "Cofrem",
  greeting,
  questions,
  selectedId,
  onSelectScenario,
  onSendTest,
}: {
  businessName?: string;
  greeting: string;
  questions: SurveyQuestion[];
  selectedId: string | null;
  onSelectScenario: (id: string) => void;
  onSendTest: () => void;
}) {
  const { t } = useI18n();
  const index = Math.max(0, questions.findIndex((q) => q.id === selectedId));
  const question = questions[index] ?? null;
  const total = questions.length;
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  const range = question ? scaleRange(question.type) : null;

  const scaleHint =
    question && range && (question.minLabel || question.maxLabel)
      ? `${range[0]} = ${question.minLabel || "—"}   •   ${range[1]} = ${question.maxLabel || "—"}`
      : null;
  const otherHint = question && !range && question.helpText ? question.helpText : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-fg">{t("Vista previa de WhatsApp", "WhatsApp preview")}</h2>
        <Info className="size-3.5 text-mist" />
      </div>

      {/* Preview scenario selector */}
      <div>
        <label className="mb-1.5 block text-xs text-mist">{t("Escenario de vista previa", "Preview scenario")}</label>
        <div className="relative">
          <select
            value={selectedId ?? ""}
            onChange={(e) => onSelectScenario(e.target.value)}
            className="w-full appearance-none rounded-lg border border-edge bg-ink px-3 py-2 pr-9 text-sm text-fg outline-none focus:border-lime/50"
          >
            {questions.map((q, i) => (
              <option key={q.id} value={q.id}>
                {t("Pregunta", "Question")} {String(i + 1).padStart(2, "0")} ({t(TYPE_META[q.type].short.es, TYPE_META[q.type].short.en)})
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
        </div>
      </div>

      {/* Phone */}
      <div className="rounded-[2.2rem] border border-edge bg-[#0b0d0f] p-2 shadow-xl">
        <div className="flex h-[560px] flex-col overflow-hidden rounded-[1.8rem] bg-[#e4ddd4]">
          {/* Status bar + chat header (dark) */}
          <div className="bg-[#1f2c34] text-white">
            <div className="flex items-center justify-between px-4 pt-2 text-[11px] font-medium">
              <span>9:41</span>
              <div className="flex items-center gap-1">
                {/* signal */}
                <svg viewBox="0 0 18 12" className="h-2.5 w-4 fill-white" aria-hidden>
                  <rect x="0" y="8" width="3" height="4" rx="0.5" />
                  <rect x="5" y="5" width="3" height="7" rx="0.5" />
                  <rect x="10" y="2.5" width="3" height="9.5" rx="0.5" />
                  <rect x="15" y="0" width="3" height="12" rx="0.5" />
                </svg>
                {/* wifi */}
                <svg viewBox="0 0 16 12" className="h-2.5 w-4 fill-white" aria-hidden>
                  <path d="M8 11.5 10.2 8.8a3 3 0 0 0-4.4 0L8 11.5ZM3.4 5.9l1.4 1.7a5.2 5.2 0 0 1 6.4 0l1.4-1.7a7.4 7.4 0 0 0-9.2 0ZM.9 2.9l1.4 1.7a9.6 9.6 0 0 1 11.4 0l1.4-1.7a11.8 11.8 0 0 0-14.2 0Z" />
                </svg>
                {/* battery */}
                <svg viewBox="0 0 24 12" className="h-2.5 w-6" aria-hidden>
                  <rect x="0.5" y="0.5" width="20" height="11" rx="2.5" fill="none" stroke="white" strokeOpacity="0.6" />
                  <rect x="2" y="2" width="16" height="8" rx="1.5" fill="white" />
                  <rect x="21.5" y="4" width="1.8" height="4" rx="0.9" fill="white" />
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <ArrowLeft className="size-4 shrink-0" />
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-[11px] font-bold text-white">
                {businessName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="flex items-center gap-1 truncate text-sm font-semibold">
                  {businessName}
                  <BadgeVerified />
                </p>
                <p className="truncate text-[11px] text-white/60">{t("Cuenta empresarial", "Business account")}</p>
              </div>
              <MoreVertical className="size-4 shrink-0" />
            </div>
          </div>

          {/* Chat body */}
          <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            {/* Greeting (incoming) */}
            <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-2.5 py-2 text-[13px] leading-snug text-[#111b21] shadow-sm">
              <p className="whitespace-pre-line">{greeting}</p>
              <span className="mt-0.5 block text-right text-[10px] text-[#667781]">10:30 AM</span>
            </div>

            {/* Progress card */}
            {question && (
              <div className="rounded-lg bg-white px-2.5 py-2 shadow-sm">
                <div className="flex items-center justify-between text-[11px] font-medium text-[#111b21]">
                  <span>
                    {t("Pregunta", "Question")} {index + 1} {t("de", "of")} {total}
                  </span>
                  <span className="tabular-nums text-[#667781]">{progress}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e9edef]">
                  <div className="h-full rounded-full bg-[#25d366]" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {/* Question (outgoing/green) */}
            {question && (
              <div className="ml-auto max-w-[88%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-2 text-[13px] leading-snug text-[#111b21] shadow-sm">
                <p>{question.text || t("(pregunta sin texto)", "(question has no text)")}</p>
                {scaleHint && <p className="mt-1.5 text-[12px] text-[#3b7a57]">{scaleHint}</p>}
                {otherHint && <p className="mt-1.5 text-[12px] text-[#3b7a57]">{otherHint}</p>}
                <span className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-[#667781]">
                  10:30 AM
                  <Check className="size-3 text-[#53bdeb]" />
                </span>
              </div>
            )}

            {/* Reply options */}
            {question && (
              <div className="pt-0.5">
                <ReplyButtons question={question} />
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="flex items-center gap-2 bg-[#e4ddd4] px-2.5 py-2">
            <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-2 text-[#8696a0]">
              <Smile className="size-4 shrink-0" />
              <span className="flex-1 truncate text-[13px]">{t("Escribe tu respuesta…", "Type your reply…")}</span>
              <Paperclip className="size-4 shrink-0" />
              <Camera className="size-4 shrink-0" />
            </div>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white">
              <Mic className="size-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Send test */}
      <button
        type="button"
        onClick={onSendTest}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-lime/40 px-4 py-2.5 text-sm font-medium text-lime-text transition-colors hover:bg-lime/10"
      >
        <WhatsAppGlyph className="size-4" /> {t("Enviar prueba a WhatsApp", "Send test to WhatsApp")}
      </button>
      <p className="text-center text-xs leading-relaxed text-mist">
        {t(
          "Esto es una vista previa. Prueba en WhatsApp para ver el flujo real.",
          "This is a preview. Test on WhatsApp to see the real flow."
        )}
      </p>
    </div>
  );
}

function BadgeVerified() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" aria-hidden>
      <path
        fill="#25d366"
        d="m12 2 2.4 1.8 3-.1 1 2.8 2.5 1.6-.7 2.9.7 2.9-2.5 1.6-1 2.8-3-.1L12 22l-2.4-1.8-3 .1-1-2.8L3.1 16l.7-2.9-.7-2.9 2.5-1.6 1-2.8 3 .1L12 2Z"
      />
      <path fill="#fff" d="m10.6 14.6-2-2 1-1 1 1 2.9-2.9 1 1-3.9 3.9Z" />
    </svg>
  );
}
