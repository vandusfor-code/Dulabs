"use client";

import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { blankBusinessHours, type EditableBusinessAgentSpecForm } from "@/lib/business-agent-form";
import type { BusinessDaySchedule, BusinessHours, BusinessHoursException } from "@/lib/agent-compiler/spec/types";
import { actionBtn, Field, inputCls, SectionCard, ToggleRow } from "@/components/dashboard/business-agent/ui";

// Índice interno 0 = domingo ... 6 = sábado (getUTCDay), pero se muestra L-D.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Módulo de Horario de atención. Edita el Spec (form.scheduling.businessHours) —
 * se guarda con el borrador y el compiler lo embebe en la acción de booking, que
 * el Runtime valida. Es una REGLA de disponibilidad (no reemplaza al calendario).
 */
export function BusinessHoursModule({ form, onChange }: { form: EditableBusinessAgentSpecForm; onChange: (f: EditableBusinessAgentSpecForm) => void }) {
  const { t, lang } = useI18n();
  const hours: BusinessHours = form.scheduling.businessHours ?? blankBusinessHours();

  function setHours(next: BusinessHours) {
    onChange({ ...form, scheduling: { ...form.scheduling, businessHours: next } });
  }
  function setDay(idx: number, day: BusinessDaySchedule) {
    const week = hours.week.slice();
    week[idx] = day;
    setHours({ ...hours, week });
  }
  function setExceptions(exceptions: BusinessHoursException[]) {
    setHours({ ...hours, exceptions });
  }

  return (
    <SectionCard
      title={t("Horario de atención", "Business hours")}
      description={t(
        "Cuándo atiende tu negocio. El agente solo agenda dentro de este horario (y respetando la duración del servicio); el calendario real sigue mandando sobre conflictos.",
        "When your business is open. The agent only books within these hours (respecting the service duration); the real calendar still governs conflicts.",
      )}
    >
      <div className="space-y-2">
        {DAY_ORDER.map((idx) => {
          const day = hours.week[idx] ?? { closed: true, intervals: [] };
          return (
            <div key={idx} className="rounded-lg border border-edge bg-ink p-3">
              <ToggleRow
                label={`${lang === "en" ? DAY_EN[idx] : DAY_ES[idx]}${day.closed ? ` · ${t("Cerrado", "Closed")}` : ""}`}
                checked={!day.closed}
                onChange={(v) =>
                  setDay(idx, v ? { closed: false, intervals: day.intervals.length ? day.intervals : [{ open: "09:00", close: "18:00" }] } : { closed: true, intervals: [] })
                }
              />
              {!day.closed && (
                <div className="mt-2 space-y-2 pl-1">
                  {day.intervals.map((iv, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="time" className={`${inputCls} w-32`} value={iv.open} onChange={(e) => { const intervals = day.intervals.slice(); intervals[i] = { ...iv, open: e.target.value }; setDay(idx, { ...day, intervals }); }} />
                      <span className="text-mist">—</span>
                      <input type="time" className={`${inputCls} w-32`} value={iv.close} onChange={(e) => { const intervals = day.intervals.slice(); intervals[i] = { ...iv, close: e.target.value }; setDay(idx, { ...day, intervals }); }} />
                      <button type="button" className={actionBtn} onClick={() => setDay(idx, { ...day, intervals: day.intervals.filter((_, j) => j !== i) })} aria-label={t("Quitar intervalo", "Remove interval")}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" className={actionBtn} onClick={() => setDay(idx, { ...day, intervals: [...day.intervals, { open: "09:00", close: "18:00" }] })}>
                    <Plus className="size-3.5" /> {t("Agregar intervalo", "Add interval")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Field label={t("Excepciones (festivos, cierres, horarios especiales)", "Exceptions (holidays, closures, special hours)")}>
        <div className="space-y-2">
          {hours.exceptions.map((exc, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-ink p-2">
              <input type="date" className={`${inputCls} w-40`} value={exc.date} onChange={(e) => { const exceptions = hours.exceptions.slice(); exceptions[i] = { ...exc, date: e.target.value }; setExceptions(exceptions); }} />
              <label className="flex items-center gap-1 text-xs text-fg">
                <input type="checkbox" checked={exc.closed} onChange={(e) => { const exceptions = hours.exceptions.slice(); exceptions[i] = { ...exc, closed: e.target.checked, intervals: e.target.checked ? [] : exc.intervals.length ? exc.intervals : [{ open: "09:00", close: "13:00" }] }; setExceptions(exceptions); }} />
                {t("Cerrado", "Closed")}
              </label>
              {!exc.closed && exc.intervals[0] && (
                <div className="flex items-center gap-1">
                  <input type="time" className={`${inputCls} w-28`} value={exc.intervals[0].open} onChange={(e) => { const exceptions = hours.exceptions.slice(); exceptions[i] = { ...exc, intervals: [{ ...exc.intervals[0]!, open: e.target.value }] }; setExceptions(exceptions); }} />
                  <span className="text-mist">—</span>
                  <input type="time" className={`${inputCls} w-28`} value={exc.intervals[0].close} onChange={(e) => { const exceptions = hours.exceptions.slice(); exceptions[i] = { ...exc, intervals: [{ ...exc.intervals[0]!, close: e.target.value }] }; setExceptions(exceptions); }} />
                </div>
              )}
              <button type="button" className={actionBtn} onClick={() => setExceptions(hours.exceptions.filter((_, j) => j !== i))} aria-label={t("Quitar excepción", "Remove exception")}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <button type="button" className={actionBtn} onClick={() => setExceptions([...hours.exceptions, { date: "", closed: true, intervals: [] }])}>
            <Plus className="size-3.5" /> {t("Agregar excepción", "Add exception")}
          </button>
        </div>
      </Field>
    </SectionCard>
  );
}
