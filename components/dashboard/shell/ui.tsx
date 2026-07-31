"use client";

import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-edge px-4 py-6 md:flex-row md:items-end md:justify-between md:px-8">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-mist">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-fg md:text-[28px]">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-mist">{description}</p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink text-mist",
    success: "bg-lime/12 text-lime-text",
    warning: "bg-amber-400/15 text-amber-400",
    danger: "bg-red-500/15 text-red-400",
    info: "bg-sky-400/15 text-sky-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  delta,
  positive = true,
  icon: Icon,
  spark,
}: {
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
  icon?: LucideIcon;
  spark?: number[];
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-edge bg-card p-5 transition-colors hover:border-lime/30">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-mist">{label}</p>
        {Icon && (
          <div className="flex size-8 items-center justify-center rounded-lg bg-ink text-mist transition-colors group-hover:text-lime-text">
            <Icon className="size-4" />
          </div>
        )}
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium",
              positive ? "text-lime-text" : "text-red-400"
            )}
          >
            {positive ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {delta}
          </span>
        )}
      </div>
      {spark && <Sparkline data={spark} className="mt-3" />}
    </div>
  );
}

export function PlanUsageCard({
  planNombre,
  cupos,
  renuevaEl,
  porCategoria,
}: {
  planNombre: string;
  cupos: { label: string; usados: number; limite: number | null }[];
  renuevaEl: string | null;
  porCategoria: { categoria: string; cantidad: number }[];
}) {
  const { t } = useI18n();
  const CATEGORIA_PRECIO_LABEL: Record<string, string> = {
    utility: t("Utilidad", "Utility"),
    marketing: "Marketing",
    authentication: t("Autenticación", "Authentication"),
    service: t("Servicio", "Service"),
    referral_conversion: t("Conversión por referido", "Referral conversion"),
  };

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-mist">{t("Tu plan", "Your plan")}</p>
        <span className="rounded-full bg-lime/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-lime-text">
          {planNombre}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        {cupos.map((c) => (
          <div key={c.label}>
            <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{c.label}</p>
            <p className="mt-1 font-medium tabular-nums text-fg">
              {c.usados.toLocaleString("es-CO")}
              {c.limite !== null && <span className="text-mist"> / {c.limite.toLocaleString("es-CO")}</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-edge pt-4 text-sm">
        <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Renovación", "Renewal")}</p>
        <p className="mt-1 font-medium text-fg">
          {renuevaEl
            ? new Date(renuevaEl + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "long" })
            : "—"}
        </p>
      </div>

      {porCategoria.length > 0 && (
        <div className="mt-4 border-t border-edge pt-4">
          <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Consumo real por categoría (Meta)", "Real usage by category (Meta)")}</p>
          <div className="mt-2 space-y-1.5">
            {porCategoria.map((c) => (
              <div key={c.categoria} className="flex items-center justify-between text-sm">
                <span className="text-mist">{CATEGORIA_PRECIO_LABEL[c.categoria] ?? c.categoria}</span>
                <span className="font-medium tabular-nums text-fg">{c.cantidad.toLocaleString("es-CO")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Sparkline({
  data,
  className,
  stroke = "var(--color-lime)",
}: {
  data: number[];
  className?: string;
  stroke?: string;
}) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const pts = data
    .map((d, i) => {
      const x = (i / (data.length - 1 || 1)) * w;
      const y = h - ((d - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-8 w-full", className)}>
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
