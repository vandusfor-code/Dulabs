"use client";

// Business Agent 2.0, FASE 6 — editor visual del horario: por día, abierto/cerrado, varios horarios por día (p. ej. cierre
// al mediodía), agregar/eliminar, copiar a todos los días y fechas especiales cerradas. La validación (inicio < cierre,
// sin cruces) es la MISMA del servidor y se muestra en el día correspondiente.

import { Copy, Plus, Trash2 } from "lucide-react";
import { WEEKDAYS, type BusinessHoursModel, type Weekday } from "@/lib/agent-compiler/business-model/schema";
import type { OnboardingIssue } from "@/lib/agent-compiler/onboarding/issues";
import { FieldError, focusRing, inputCls, issuesFor, secondaryBtn } from "@/components/dashboard/business-agent/onboarding/controls";

const DAY_LABEL: Record<Weekday, string> = { monday: "Lunes", tuesday: "Martes", wednesday: "Miércoles", thursday: "Jueves", friday: "Viernes", saturday: "Sábado", sunday: "Domingo" };
const ORDER: Weekday[] = [...WEEKDAYS.slice(1), WEEKDAYS[0]];

export function HoursEditor({ hours, onChange, issues }: { hours: BusinessHoursModel; onChange: (h: BusinessHoursModel) => void; issues: readonly OnboardingIssue[] }) {
  const setDay = (d: Weekday, day: BusinessHoursModel["week"][Weekday]) => onChange({ ...hours, week: { ...hours.week, [d]: day } });
  const copyToAll = (d: Weekday) => {
    const src = hours.week[d];
    onChange({ ...hours, week: Object.fromEntries(WEEKDAYS.map((w) => [w, { open: src.open, intervals: src.intervals.map((i) => ({ ...i })) }])) as BusinessHoursModel["week"] });
  };
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-ink">
        {ORDER.map((d) => {
          const day = hours.week[d];
          const dayIssues = issuesFor(issues, `hours.week.${d}`);
          const errId = `hours-${d}-err`;
          return (
            <li key={d} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <div className="flex w-full items-center justify-between sm:w-40 sm:shrink-0 sm:flex-col sm:items-start sm:gap-2">
                <span className="text-sm font-semibold text-fg">{DAY_LABEL[d]}</span>
                {/* Área táctil de 44 px (móvil) sin cambiar el alto visual de la fila. */}
                <label className="-my-3 inline-flex min-h-11 cursor-pointer items-center gap-2 py-3 pl-3 text-xs text-mist">
                  <input
                    type="checkbox"
                    className={`size-4 accent-lime ${focusRing}`}
                    checked={day.open}
                    onChange={(e) => setDay(d, e.target.checked ? { open: true, intervals: day.intervals.length ? day.intervals : [{ start: "09:00", end: "18:00" }] } : { open: false, intervals: day.intervals })}
                    aria-label={`${DAY_LABEL[d]} abierto`}
                  />
                  {day.open ? "Abierto" : "Cerrado"}
                </label>
              </div>
              {day.open ? (
                <div className="min-w-0 flex-1 space-y-2" aria-describedby={dayIssues.length ? errId : undefined}>
                  {day.intervals.map((iv, n) => (
                    <div key={n} className="flex items-center gap-2">
                      <input
                        type="time"
                        className={`${inputCls} w-32`}
                        value={iv.start}
                        aria-label={`${DAY_LABEL[d]}, desde`}
                        aria-invalid={dayIssues.some((i) => i.severity === "error") || undefined}
                        onChange={(e) => setDay(d, { ...day, intervals: day.intervals.map((x, k) => (k === n ? { ...x, start: e.target.value } : x)) })}
                      />
                      <span className="text-mist" aria-hidden="true">
                        —
                      </span>
                      <input
                        type="time"
                        className={`${inputCls} w-32`}
                        value={iv.end}
                        aria-label={`${DAY_LABEL[d]}, hasta`}
                        aria-invalid={dayIssues.some((i) => i.severity === "error") || undefined}
                        onChange={(e) => setDay(d, { ...day, intervals: day.intervals.map((x, k) => (k === n ? { ...x, end: e.target.value } : x)) })}
                      />
                      {day.intervals.length > 1 && (
                        <button type="button" className={`${secondaryBtn} px-2.5`} aria-label={`Quitar horario ${n + 1} del ${DAY_LABEL[d].toLowerCase()}`} onClick={() => setDay(d, { ...day, intervals: day.intervals.filter((_, k) => k !== n) })}>
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {day.intervals.length < 6 && (
                      <button type="button" className={`${secondaryBtn} py-1.5 text-xs`} onClick={() => setDay(d, { ...day, intervals: [...day.intervals, { start: "14:00", end: "18:00" }] })}>
                        <Plus className="size-3.5" /> Agregar horario
                      </button>
                    )}
                    <button type="button" className={`${secondaryBtn} py-1.5 text-xs`} onClick={() => copyToAll(d)}>
                      <Copy className="size-3.5" /> Usar en todos los días
                    </button>
                  </div>
                  <FieldError id={errId} issues={dayIssues} />
                </div>
              ) : (
                <p className="flex-1 text-sm text-mist sm:pt-0.5">No atiendes este día.</p>
              )}
            </li>
          );
        })}
      </ul>
      <Exceptions hours={hours} onChange={onChange} issues={issues} />
    </div>
  );
}

function Exceptions({ hours, onChange, issues }: { hours: BusinessHoursModel; onChange: (h: BusinessHoursModel) => void; issues: readonly OnboardingIssue[] }) {
  return (
    <div className="rounded-2xl border border-edge bg-ink p-4">
      <p className="text-sm font-semibold text-fg">Días especiales</p>
      <p className="mt-0.5 text-xs text-mist">Festivos o vacaciones en los que no atiendes.</p>
      <ul className="mt-3 space-y-2">
        {hours.exceptions.map((e, i) => (
          <li key={i} className="flex items-center gap-2">
            <input type="date" className={`${inputCls} w-44`} value={e.date} aria-label={`Día especial ${i + 1}`} onChange={(ev) => onChange({ ...hours, exceptions: hours.exceptions.map((x, k) => (k === i ? { ...x, date: ev.target.value } : x)) })} />
            <span className="text-sm text-mist">Cerrado</span>
            <button type="button" className={`${secondaryBtn} px-2.5`} aria-label={`Quitar día especial ${i + 1}`} onClick={() => onChange({ ...hours, exceptions: hours.exceptions.filter((_, k) => k !== i) })}>
              <Trash2 className="size-4" />
            </button>
            <FieldError id={`exc-${i}-err`} issues={issuesFor(issues, `hours.exceptions.${i}`)} />
          </li>
        ))}
      </ul>
      {hours.exceptions.length < 60 && (
        <button type="button" className={`${secondaryBtn} mt-3 py-1.5 text-xs`} onClick={() => onChange({ ...hours, exceptions: [...hours.exceptions, { date: new Date().toISOString().slice(0, 10), open: false, intervals: [] }] })}>
          <Plus className="size-3.5" /> Agregar día especial
        </button>
      )}
    </div>
  );
}
