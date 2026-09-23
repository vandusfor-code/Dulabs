"use client";

import { useMenosMovimiento } from "@/components/developer-platform/motion";

// DuLabs Business · login -- panel ambiental. Mucho espacio negativo: un grid casi imperceptible, dos arcos geométricos muy finos con
// luz azul-violeta, un punto de luz donde el arco cruza una línea del grid y unos pocos puntos. Vivo pero sereno (SVG ligero + CSS):
//   - una luz recorre cada arco con pausas (alternadas, ~11 s), como una señal que viaja por la infraestructura
//   - el punto del cruce emite un pulso lento; los arcos derivan ±16 px (18 s) y su resplandor respira; un halo ambiental respira (12 s)
//   - los puntos laten (3–6 s, desfasados); el grid solo cambia de opacidad
// Solo transform/opacity (+ el recorrido SVG de las luces). Con prefers-reduced-motion todo queda estático (sin luces viajando).

// Geometría (viewBox 800 × 1000, recortado con "slice"): los arcos son porciones de dos círculos muy grandes.
const ARCO_1 = { cx: 0, cy: 950, r: 812 };
const ARCO_2 = { cx: -200, cy: 1500, r: 1035 };
const CELDA = 80;
const LINEA_LUZ = 400; // la línea vertical del grid que el arco cruza (x)
const CRUCE_Y = Math.round(ARCO_1.cy - Math.sqrt(ARCO_1.r ** 2 - (LINEA_LUZ - ARCO_1.cx) ** 2)); // ≈ 243
// Tramos visibles de cada arco (para que la luz viaje por ellos).
const RECORRIDO_1 = `M130,148.5 A${ARCO_1.r},${ARCO_1.r} 0 0 1 800,811`;
const RECORRIDO_2 = `M0,484.5 A${ARCO_2.r},${ARCO_2.r} 0 0 1 800,1233`;
const PUNTOS: [number, number, number, number][] = [
  // x, y, duración (s), retraso (s)
  [LINEA_LUZ, 560, 4.5, 0],
  [LINEA_LUZ, 880, 5.5, 1.8],
  [160, 720, 3.8, 0.9],
  [0, 360, 5, 2.6],
];

/** Una luz que recorre un arco y descansa (fuera de su tramo queda invisible). */
function LuzViajera({ recorrido, retraso }: { recorrido: string; retraso: number }) {
  return (
    <g opacity="0">
      <circle r="11" fill="#7187FF" fillOpacity="0.22" />
      <circle r="2.4" fill="#E4E8FF" />
      <animateMotion dur="11s" begin={`${retraso}s`} repeatCount="indefinite" path={recorrido} keyPoints="0;1;1" keyTimes="0;0.55;1" calcMode="spline" keySplines="0.4 0 0.6 1;0 0 1 1" />
      <animate attributeName="opacity" dur="11s" begin={`${retraso}s`} repeatCount="indefinite" values="0;1;1;0;0" keyTimes="0;0.06;0.48;0.56;1" />
    </g>
  );
}

/** Los arcos y la luz (compartido por el panel de escritorio y la decoración de mobile). */
function Arcos({ id, vivo }: { id: string; vivo: boolean }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-a1`} x1="0" y1="140" x2="0" y2="820" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7187FF" stopOpacity="0" />
          <stop offset="22%" stopColor="#8FA0FF" stopOpacity="0.9" />
          <stop offset="70%" stopColor="#6C7CFF" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#6C7CFF" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id={`${id}-a2`} x1="0" y1="460" x2="0" y2="1000" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6C7CFF" stopOpacity="0" />
          <stop offset="45%" stopColor="#7187FF" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#6C7CFF" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={`${id}-luz`}>
          <stop offset="0%" stopColor="#8FA0FF" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#6C7CFF" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-brillo`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <g className="bl-deriva">
        {/* Resplandor (varía de opacidad) + línea nítida. */}
        <g className="bl-resplandor" filter={`url(#${id}-brillo)`} strokeWidth="3">
          <circle cx={ARCO_1.cx} cy={ARCO_1.cy} r={ARCO_1.r} stroke={`url(#${id}-a1)`} />
          <circle cx={ARCO_2.cx} cy={ARCO_2.cy} r={ARCO_2.r} stroke={`url(#${id}-a2)`} />
        </g>
        <circle cx={ARCO_1.cx} cy={ARCO_1.cy} r={ARCO_1.r} stroke={`url(#${id}-a1)`} strokeWidth="1" />
        <circle cx={ARCO_2.cx} cy={ARCO_2.cy} r={ARCO_2.r} stroke={`url(#${id}-a2)`} strokeWidth="0.8" />
        {/* El punto de luz donde el arco cruza la línea del grid, con un pulso lento. */}
        <circle className="bl-resplandor" cx={LINEA_LUZ} cy={CRUCE_Y} r="26" fill={`url(#${id}-luz)`} />
        <circle className="bl-pulso" cx={LINEA_LUZ} cy={CRUCE_Y} r="9" stroke="#8FA0FF" strokeWidth="1" />
        <circle cx={LINEA_LUZ} cy={CRUCE_Y} r="2.2" fill="#DDE3FF" />
        {vivo ? (
          <>
            <LuzViajera recorrido={RECORRIDO_1} retraso={0.8} />
            <LuzViajera recorrido={RECORRIDO_2} retraso={6.3} />
          </>
        ) : null}
      </g>
    </>
  );
}

export function AmbientVisual({ className = "" }: { className?: string }) {
  const menos = useMenosMovimiento();
  return (
    <div aria-hidden className={`bl-visual relative overflow-hidden ${className}`}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs>
          <pattern id="bl-grid" width={CELDA} height={CELDA} patternUnits="userSpaceOnUse">
            <path d={`M${CELDA} 0H0V${CELDA}`} stroke="#FFFFFF" strokeOpacity="0.028" strokeWidth="1" />
          </pattern>
          <radialGradient id="bl-ambiente">
            <stop offset="0%" stopColor="#5A69FF" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#5A69FF" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect className="bl-grid" width="800" height="1000" fill="url(#bl-grid)" />
        {/* Halo ambiental que respira detrás del cruce del arco. */}
        <ellipse className="bl-ambiente" cx={LINEA_LUZ - 40} cy={CRUCE_Y + 140} rx="380" ry="320" fill="url(#bl-ambiente)" />
        {/* La línea del grid que recibe la luz, apenas más presente que las demás. */}
        <line x1={LINEA_LUZ} y1="0" x2={LINEA_LUZ} y2="1000" stroke="#FFFFFF" strokeOpacity="0.045" />
        <Arcos id="bl-d" vivo={!menos} />
        {PUNTOS.map(([x, y, dur, retraso]) => (
          <circle key={`${x}-${y}`} className="bl-punto" cx={x} cy={y} r="2" fill="#8FA0FF" style={{ animationDuration: `${dur}s`, animationDelay: `-${retraso}s` }} />
        ))}
      </svg>
    </div>
  );
}

/** Mobile: solo una decoración superior extremadamente sutil (un fragmento de arco y su luz), detrás del formulario. */
export function AmbientMobile() {
  return (
    <div aria-hidden className="bl-visual-movil pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden md:hidden">
      <svg className="absolute -right-24 -top-10 h-[420px] w-[420px] opacity-60" viewBox="0 0 800 1000" fill="none">
        <Arcos id="bl-m" vivo={false} />
      </svg>
    </div>
  );
}
