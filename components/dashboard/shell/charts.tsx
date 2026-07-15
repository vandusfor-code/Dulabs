/**
 * Small hand-rolled SVG charts — no chart library dependency.
 * Enough for the real, fairly small datasets this dashboard shows.
 */

export function AreaTrend({
  data,
  keys,
  height = 220,
}: {
  data: Record<string, number | string>[];
  keys: { key: string; name: string; color: string }[];
  height?: number;
}) {
  const w = 720;
  const h = height;
  const allValues = keys.flatMap((k) => data.map((d) => Number(d[k.key]) || 0));
  const max = Math.max(1, ...allValues);
  const toPath = (key: string) =>
    data
      .map((d, i) => {
        const x = data.length > 1 ? (i / (data.length - 1)) * w : 0;
        const y = h - (Number(d[key]) / max) * (h - 16) - 4;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  const toArea = (key: string) => `${toPath(key)} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
        <defs>
          {keys.map((k) => (
            <linearGradient key={k.key} id={`grad-${k.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={k.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={k.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={w} y1={h * f} y2={h * f} stroke="var(--color-edge)" strokeWidth={1} />
        ))}
        {keys.map((k) => (
          <path key={`fill-${k.key}`} d={toArea(k.key)} fill={`url(#grad-${k.key})`} />
        ))}
        {keys.map((k) => (
          <path key={`line-${k.key}`} d={toPath(k.key)} stroke={k.color} strokeWidth={2} fill="none" />
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-mist">
        {data.map((d, i) => (
          <span key={i}>{String(d.label)}</span>
        ))}
      </div>
    </div>
  );
}

export function Donut({
  data,
  height = 200,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;

  const segments = data.reduce<{ name: string; color: string; dash: number; offset: number }[]>((acc, d) => {
    const prevOffset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    const dash = (d.value / total) * circumference;
    acc.push({ name: d.name, color: d.color, dash, offset: prevOffset });
    return acc;
  }, []);

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-edge)" strokeWidth={12} />
        {segments.map((s) => (
          <circle
            key={s.name}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={12}
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={-s.offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums text-fg">{total.toLocaleString("es-CO")}</span>
        <span className="mt-1 font-mono text-[10.5px] uppercase tracking-widest text-mist">total</span>
      </div>
    </div>
  );
}
