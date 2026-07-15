import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";

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

const CATEGORIA_PRECIO_LABEL: Record<string, string> = {
  utility: "Utilidad",
  marketing: "Marketing",
  authentication: "Autenticación",
  service: "Servicio",
  referral_conversion: "Conversión por referido",
};

export function PlanUsageCard({
  plan,
  usados,
  limite,
  renuevaEl,
  porCategoria,
}: {
  plan: string;
  usados: number;
  limite: number | null;
  renuevaEl: string | null;
  porCategoria: { categoria: string; cantidad: number }[];
}) {
  const porcentaje = limite === null ? 0 : Math.min(100, Math.round((usados / limite) * 100));
  const restantes = limite === null ? null : Math.max(0, limite - usados);

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-widest text-mist">Consumo del plan</p>
        <span className="rounded-full bg-lime/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-lime-text">
          {plan}
        </span>
      </div>

      <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums text-fg">
        {usados.toLocaleString("es-CO")}
        {limite !== null && <span className="text-mist"> / {limite.toLocaleString("es-CO")}</span>}
      </p>
      <p className="mt-1 text-sm text-mist">
        {limite === null ? "Conversaciones este mes · Ilimitado" : `conversaciones este mes · ${porcentaje}% consumido`}
      </p>

      {limite !== null && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink">
          <div
            className={`h-full rounded-full ${porcentaje >= 90 ? "bg-red-400" : porcentaje >= 70 ? "bg-amber-400" : "bg-lime"}`}
            style={{ width: `${porcentaje}%` }}
          />
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-edge pt-4 text-sm">
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Restantes</p>
          <p className="mt-1 font-medium text-fg">
            {restantes === null ? "Ilimitado" : restantes.toLocaleString("es-CO")}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Renovación</p>
          <p className="mt-1 font-medium text-fg">
            {renuevaEl
              ? new Date(renuevaEl + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "long" })
              : "—"}
          </p>
        </div>
      </div>

      {porCategoria.length > 0 && (
        <div className="mt-4 border-t border-edge pt-4">
          <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Consumo real por categoría (Meta)</p>
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
