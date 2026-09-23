// DuLabs Business · login -- panel ambiental. Casi todo es espacio negativo: un grid casi imperceptible, dos arcos geométricos muy
// finos con una luz azul-violeta tenue, un punto de luz donde el arco cruza una línea del grid y unos pocos puntos pequeños. SVG ligero
// + CSS: los arcos derivan ±8 px en 20 s, su resplandor varía de opacidad, los puntos laten (3–6 s, desfasados) y el grid solo cambia
// de opacidad. Nada se mueve rápido; con prefers-reduced-motion todo queda estático. Sin imágenes, canvas ni librerías.

// Geometría (viewBox 800 × 1000, recortado con "slice"): los arcos son porciones de dos círculos muy grandes.
const ARCO_1 = { cx: 0, cy: 950, r: 812 };
const ARCO_2 = { cx: -200, cy: 1500, r: 1035 };
const CELDA = 80;
const LINEA_LUZ = 400; // la línea vertical del grid que el arco cruza (x)
const CRUCE_Y = Math.round(ARCO_1.cy - Math.sqrt(ARCO_1.r ** 2 - (LINEA_LUZ - ARCO_1.cx) ** 2)); // ≈ 243
const PUNTOS: [number, number, number, number][] = [
  // x, y, duración (s), retraso (s)
  [LINEA_LUZ, 560, 4.5, 0],
  [LINEA_LUZ, 880, 5.5, 1.8],
  [160, 720, 3.8, 0.9],
  [0, 360, 5, 2.6],
];

/** Los arcos y la luz (compartido por el panel de escritorio y la decoración de mobile). */
function Arcos({ id }: { id: string }) {
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
        {/* El punto de luz donde el arco cruza la línea del grid. */}
        <circle className="bl-resplandor" cx={LINEA_LUZ} cy={CRUCE_Y} r="26" fill={`url(#${id}-luz)`} />
        <circle cx={LINEA_LUZ} cy={CRUCE_Y} r="2.2" fill="#DDE3FF" />
      </g>
    </>
  );
}

export function AmbientVisual({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`bl-visual relative overflow-hidden ${className}`}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs>
          <pattern id="bl-grid" width={CELDA} height={CELDA} patternUnits="userSpaceOnUse">
            <path d={`M${CELDA} 0H0V${CELDA}`} stroke="#FFFFFF" strokeOpacity="0.028" strokeWidth="1" />
          </pattern>
        </defs>
        <rect className="bl-grid" width="800" height="1000" fill="url(#bl-grid)" />
        {/* La línea del grid que recibe la luz, apenas más presente que las demás. */}
        <line x1={LINEA_LUZ} y1="0" x2={LINEA_LUZ} y2="1000" stroke="#FFFFFF" strokeOpacity="0.045" />
        <Arcos id="bl-d" />
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
        <Arcos id="bl-m" />
      </svg>
    </div>
  );
}
