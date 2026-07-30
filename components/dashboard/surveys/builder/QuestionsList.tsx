"use client";

import { useEffect, useState } from "react";
import {
  MoreVertical,
  Plus,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  GripVertical,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { TYPE_META, type SurveyQuestion } from "@/lib/survey-builder";

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const COLLAPSED_COUNT = 6;

export function QuestionsList({
  questions,
  selectedId,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
  onReorder,
}: {
  questions: SurveyQuestion[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuId]);

  const visible = expanded ? questions : questions.slice(0, COLLAPSED_COUNT);

  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-edge bg-card">
      <div className="border-b border-edge p-5">
        <h2 className="text-base font-semibold text-fg">
          {t("Preguntas", "Questions")} ({questions.length})
        </h2>
        <p className="mt-0.5 text-sm text-mist">{t("Arrastra y suelta para reordenar", "Drag and drop to reorder")}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {visible.map((q, i) => {
          const meta = TYPE_META[q.type];
          const selected = q.id === selectedId;
          return (
            <div
              key={q.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (overIndex !== i) setOverIndex(i);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== i) onReorder(dragIndex, i);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onClick={() => onSelect(q.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(q.id);
                }
              }}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "group relative grid cursor-grab grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-lg border p-3 transition-colors active:cursor-grabbing",
                selected
                  ? "border-lime/60 bg-lime/[0.04]"
                  : "border-edge bg-ink/40 hover:border-edge hover:bg-ink/70",
                dragIndex === i && "opacity-40",
                overIndex === i && dragIndex !== null && dragIndex !== i && "border-lime/40"
              )}
            >
              <div className="flex items-center gap-1.5">
                <GripVertical className="size-4 shrink-0 text-mist/40 transition-colors group-hover:text-mist" />
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-ink font-mono text-xs text-mist">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>

              <p className="line-clamp-2 min-w-0 text-sm text-fg">
                {q.text || <span className="text-mist italic">{t("Pregunta sin título", "Untitled question")}</span>}
              </p>

              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  meta.badgeClass
                )}
              >
                {t(meta.badge.es, meta.badge.en)}
              </span>

              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t("Acciones de la pregunta", "Question actions")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuId((cur) => (cur === q.id ? null : q.id));
                  }}
                  className="flex size-7 items-center justify-center rounded-md text-mist transition-colors hover:bg-card hover:text-fg"
                >
                  <MoreVertical className="size-4" />
                </button>
                {menuId === q.id && (
                  <div
                    className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-edge bg-card p-1 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MenuItem icon={ArrowUp} disabled={i === 0} onClick={() => { onMove(q.id, -1); setMenuId(null); }}>
                      {t("Mover arriba", "Move up")}
                    </MenuItem>
                    <MenuItem icon={ArrowDown} disabled={i === questions.length - 1} onClick={() => { onMove(q.id, 1); setMenuId(null); }}>
                      {t("Mover abajo", "Move down")}
                    </MenuItem>
                    <MenuItem icon={Copy} onClick={() => { onDuplicate(q.id); setMenuId(null); }}>
                      {t("Duplicar", "Duplicate")}
                    </MenuItem>
                    <MenuItem icon={Trash2} danger onClick={() => { onDelete(q.id); setMenuId(null); }}>
                      {t("Eliminar", "Delete")}
                    </MenuItem>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-edge py-2.5 text-sm font-medium text-mist transition-colors hover:border-lime/40 hover:text-lime-text"
        >
          <Plus className="size-4" /> {t("Agregar pregunta", "Add question")}
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-edge px-5 py-3">
        <p className="text-xs text-mist">
          {t(
            `Mostrando 1 a ${visible.length} de ${questions.length} preguntas`,
            `Showing 1 to ${visible.length} of ${questions.length} questions`
          )}
        </p>
        {questions.length > COLLAPSED_COUNT && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t("Ver menos", "Show less") : t("Ver todas", "Show all")}
            className="flex size-7 items-center justify-center rounded-md text-mist transition-colors hover:bg-ink hover:text-fg"
          >
            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger,
  disabled,
}: {
  icon: typeof ArrowUp;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        danger ? "text-red-400 hover:bg-red-500/10" : "text-fg hover:bg-ink"
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {children}
    </button>
  );
}
