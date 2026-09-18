"use client";

/** Primitivas de formulario compartidas por los pasos del wizard -- mismas clases que app/dashboard/surveys/new/page.tsx (inputCls/Field), para que el Business Agent se sienta parte del mismo dashboard. */
export const inputCls =
  "w-full rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm text-fg outline-none transition-colors focus:border-lime/50";

export const actionBtn =
  "flex items-center gap-2 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50";

export const primaryBtn =
  "flex items-center gap-2 rounded-lg bg-lime px-4 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-mist">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10.5px] text-mist/70">{hint}</p>}
    </div>
  );
}

export function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 text-xs text-mist">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-edge bg-ink px-3.5 py-3 transition-colors hover:border-lime/30 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
      <input type="checkbox" className="mt-0.5 size-4 accent-lime" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-mist">{hint}</span>}
      </span>
    </label>
  );
}

export function IssuesList({ issues, tone = "warning" }: { issues: string[]; tone?: "warning" | "danger" }) {
  if (issues.length === 0) return null;
  const cls = tone === "danger" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-amber-400/30 bg-amber-400/10 text-amber-400";
  return (
    <ul className={`space-y-1 rounded-lg border px-3.5 py-3 text-xs ${cls}`}>
      {issues.map((issue, i) => (
        <li key={i}>• {issue}</li>
      ))}
    </ul>
  );
}
