import { porcentajeUso, estadoCuota, tonoEstadoCuota, formatearLimite, type Tono } from "@/lib/dev-dashboard/dev-format";

// DuLabs Developer V1 -- Fase 9. Barra de uso sencilla con estado
// normal/cerca/límite (sin inventar thresholds comerciales). Presentacional.

const BARRA_TONO: Record<Tono, string> = {
  success: "bg-dev-accent",
  warning: "bg-warning-text",
  danger: "bg-danger-text",
  info: "bg-dev-accent",
  neutral: "bg-mist",
};

export function UsageProgress({ used, included, unidad }: { used: number; included: number | null; unidad?: string }) {
  const pct = porcentajeUso(used, included);
  const estado = estadoCuota(used, included);
  const tono = tonoEstadoCuota(estado);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="tabular-nums text-fg">
          {used.toLocaleString("en-US")}
          <span className="text-mist"> / {formatearLimite(included)}</span>
          {unidad ? <span className="text-mist"> {unidad}</span> : null}
        </span>
        {pct !== null ? <span className="text-xs tabular-nums text-mist">{pct}%</span> : <span className="text-xs text-mist">Unlimited</span>}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-2" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        {pct !== null ? <div className={`h-full rounded-full ${BARRA_TONO[tono]}`} style={{ width: `${pct}%` }} /> : null}
      </div>
    </div>
  );
}
