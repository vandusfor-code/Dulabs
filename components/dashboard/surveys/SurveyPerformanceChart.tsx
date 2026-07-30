"use client";

import type { SurveyPerformancePoint } from "@/lib/surveys";

/**
 * Gráfica de líneas + área para "Survey performance". SVG a mano, sin
 * dependencias (coherente con components/dashboard/shell/charts.tsx), pero con
 * ejes Y etiquetados y puntos por vértice para replicar el mockup.
 */
export function SurveyPerformanceChart({
  data,
  startedColor = "var(--color-chart-4)",
  completedColor = "var(--color-lime)",
  height = 260,
}: {
  data: SurveyPerformancePoint[];
  startedColor?: string;
  completedColor?: string;
  height?: number;
}) {
  const w = 760;
  const h = height;
  const padL = 40;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // Eje Y fijo a 2000 con marcas cada 500 (como el mockup).
  const yMax = 2000;
  const ticks = [0, 500, 1000, 1500, 2000];
  const fmtTick = (v: number) => (v === 0 ? "0" : v >= 1000 ? `${v / 1000}K`.replace(".0", "") : String(v));

  const x = (i: number) => padL + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => padT + plotH - (Math.min(v, yMax) / yMax) * plotH;

  const line = (key: "started" | "completed") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(" ");
  const area = (key: "started" | "completed") =>
    `${line(key)} L ${x(data.length - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img" aria-label="Survey performance">
      <defs>
        <linearGradient id="srv-perf-started" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={startedColor} stopOpacity={0.22} />
          <stop offset="100%" stopColor={startedColor} stopOpacity={0} />
        </linearGradient>
        <linearGradient id="srv-perf-completed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={completedColor} stopOpacity={0.28} />
          <stop offset="100%" stopColor={completedColor} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Gridlines + etiquetas del eje Y */}
      {ticks.map((tk) => {
        const gy = y(tk);
        return (
          <g key={tk}>
            <line x1={padL} x2={w - padR} y1={gy} y2={gy} stroke="var(--color-edge)" strokeWidth={1} />
            <text
              x={padL - 8}
              y={gy}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-mist"
              style={{ fontSize: "11px" }}
            >
              {fmtTick(tk)}
            </text>
          </g>
        );
      })}

      {/* Áreas (started al fondo, completed encima) */}
      <path d={area("started")} fill="url(#srv-perf-started)" />
      <path d={area("completed")} fill="url(#srv-perf-completed)" />

      {/* Líneas */}
      <path d={line("started")} fill="none" stroke={startedColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <path d={line("completed")} fill="none" stroke={completedColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* Puntos por vértice */}
      {data.map((d, i) => (
        <circle key={`s-${i}`} cx={x(i)} cy={y(d.started)} r={3.5} fill="var(--color-card)" stroke={startedColor} strokeWidth={2} />
      ))}
      {data.map((d, i) => (
        <circle key={`c-${i}`} cx={x(i)} cy={y(d.completed)} r={3.5} fill="var(--color-card)" stroke={completedColor} strokeWidth={2} />
      ))}

      {/* Etiquetas del eje X */}
      {data.map((d, i) => (
        <text
          key={d.label}
          x={x(i)}
          y={h - 8}
          textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
          className="fill-mist"
          style={{ fontSize: "11px" }}
        >
          {d.label}
        </text>
      ))}
    </svg>
  );
}
