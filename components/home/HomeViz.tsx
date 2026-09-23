// Visualizaciones mínimas de la home en SVG puro (sin imágenes ni librerías). Trazos blancos de baja opacidad; el azul solo en la señal que
// se mueve. Todo el movimiento vive en CSS (.home-viz-*) y se pausa cuando la visualización no está activa o fuera de pantalla.

/** IA & Automatización: una entrada, el agente y tres salidas; una señal recorre el flujo. */
export function VizFlujo() {
  const salidas = [70, 150, 230];
  return (
    <svg viewBox="0 0 400 300" className="home-viz" aria-hidden>
      <path className="home-viz-trazo" d="M60 150 H170" />
      {salidas.map((y) => (
        <path key={y} className="home-viz-trazo" d={`M230 150 C 270 150, 280 ${y}, 330 ${y}`} />
      ))}
      <path pathLength={100} className="home-viz-senal" d="M60 150 H170" />
      {salidas.map((y, i) => (
        <path key={`s${y}`} pathLength={100} className="home-viz-senal" style={{ animationDelay: `${0.9 + i * 0.25}s` }} d={`M230 150 C 270 150, 280 ${y}, 330 ${y}`} />
      ))}
      <circle className="home-viz-nodo" cx="52" cy="150" r="8" />
      <rect className="home-viz-nodo home-viz-nodo--fuerte" x="170" y="120" width="60" height="60" rx="14" />
      <circle className="home-viz-nucleo" cx="200" cy="150" r="5" />
      {salidas.map((y) => (
        <circle key={`n${y}`} className="home-viz-nodo" cx="338" cy={y} r="8" />
      ))}
      <text className="home-viz-texto" x="52" y="185" textAnchor="middle">entrada</text>
      <text className="home-viz-texto" x="200" y="205" textAnchor="middle">agente</text>
      <text className="home-viz-texto" x="338" y="265" textAnchor="middle">acciones</text>
    </svg>
  );
}

/** Software a medida: estructura de una interfaz (barra, navegación lateral, filas y una serie). */
export function VizInterfaz() {
  return (
    <svg viewBox="0 0 400 300" className="home-viz" aria-hidden>
      <rect pathLength={1} className="home-viz-trazo home-viz-dibujo" x="40" y="40" width="320" height="220" rx="10" />
      <path pathLength={1} className="home-viz-trazo home-viz-dibujo" d="M40 70 H360 M110 70 V260" />
      {[0, 1, 2].map((i) => (
        <circle key={i} className="home-viz-nodo" cx={56 + i * 12} cy="55" r="3" />
      ))}
      {[92, 112, 132, 152].map((y, i) => (
        <path key={y} className={`home-viz-trazo ${i === 1 ? "home-viz-barra--activa" : ""}`} d={`M54 ${y} H${i === 1 ? 96 : 88}`} />
      ))}
      <path pathLength={1} className="home-viz-trazo home-viz-dibujo" d="M126 96 H340 M126 124 H300 M126 152 H320" />
      <path pathLength={100} className="home-viz-senal home-viz-senal--lenta" d="M126 240 L170 214 L210 224 L252 190 L292 200 L340 168" />
      <path className="home-viz-trazo" d="M126 240 L170 214 L210 224 L252 190 L292 200 L340 168" />
    </svg>
  );
}

/** Integraciones: sistemas a ambos lados conectados a un núcleo; la información fluye por las líneas. */
export function VizConexiones() {
  const sistemas = [
    { x: 14, y: 60, t: "WhatsApp API" },
    { x: 14, y: 210, t: "Meta" },
    { x: 282, y: 60, t: "CRM" },
    { x: 282, y: 210, t: "Supabase" },
  ];
  return (
    <svg viewBox="0 0 400 300" className="home-viz" aria-hidden>
      {sistemas.map((s, i) => {
        const x1 = s.x < 200 ? s.x + 104 : s.x;
        const d = `M${x1} ${s.y + 15} C ${s.x < 200 ? x1 + 50 : x1 - 50} ${s.y + 15}, ${s.x < 200 ? 150 : 250} 150, 200 150`;
        return (
          <g key={s.t}>
            <path className="home-viz-trazo" d={d} />
            <path pathLength={100} className="home-viz-senal" style={{ animationDelay: `${i * 0.45}s` }} d={d} />
            <rect className="home-viz-nodo" x={s.x} y={s.y} width="104" height="30" rx="7" />
            <text className="home-viz-texto home-viz-texto--claro" x={s.x + 52} y={s.y + 19} textAnchor="middle">
              {s.t}
            </text>
          </g>
        );
      })}
      <circle className="home-viz-nodo home-viz-nodo--fuerte" cx="200" cy="150" r="22" />
      <circle className="home-viz-nucleo" cx="200" cy="150" r="5" />
    </svg>
  );
}

/** Datos & Operaciones: una serie de barras que se levanta sobre una rejilla de puntos y una línea de tendencia. */
export function VizDatos() {
  const barras = [0.35, 0.5, 0.42, 0.62, 0.55, 0.74, 0.68, 0.86];
  return (
    <svg viewBox="0 0 400 300" className="home-viz" aria-hidden>
      {Array.from({ length: 6 }, (_, f) =>
        Array.from({ length: 12 }, (_, c) => <circle key={`${f}-${c}`} className="home-viz-punto" cx={50 + c * 28} cy={40 + f * 36} r="1.2" />),
      )}
      <path className="home-viz-trazo" d="M40 250 H360" />
      {barras.map((h, i) => (
        <rect
          key={i}
          className={`home-viz-columna ${i === barras.length - 1 ? "home-viz-columna--activa" : ""}`}
          style={{ transitionDelay: `${i * 60}ms` }}
          x={58 + i * 38}
          y={250 - h * 190}
          width="18"
          height={h * 190}
          rx="3"
        />
      ))}
      <path pathLength={100} className="home-viz-senal home-viz-senal--lenta" d={`M67 ${250 - 0.35 * 190 - 14} ${barras.map((h, i) => `L${67 + i * 38} ${250 - h * 190 - 14}`).join(" ")}`} />
    </svg>
  );
}

/** Enterprise: red de capacidades alrededor de la operación de la empresa; las conexiones se trazan despacio al entrar en pantalla. */
export function VizRed({ etiquetas }: { etiquetas: readonly string[] }) {
  const cx = 220;
  const cy = 170;
  const nodos = etiquetas.map((t, i) => {
    const a = (-90 + (360 / etiquetas.length) * i) * (Math.PI / 180);
    return { t, x: Math.round(cx + Math.cos(a) * 150), y: Math.round(cy + Math.sin(a) * 118) };
  });
  return (
    <svg viewBox="0 0 440 340" className="home-viz home-viz--red" aria-hidden>
      {nodos.map((n, i) => (
        <path key={`c${n.t}`} pathLength={1} className="home-viz-trazo home-viz-dibujo" style={{ animationDelay: `${i * 0.35}s` }} d={`M${cx} ${cy} L${n.x} ${n.y}`} />
      ))}
      {nodos.map((n, i) => {
        const m = nodos[(i + 1) % nodos.length];
        return <path key={`a${n.t}`} pathLength={1} className="home-viz-trazo home-viz-trazo--tenue home-viz-dibujo" style={{ animationDelay: `${1.6 + i * 0.3}s` }} d={`M${n.x} ${n.y} L${m.x} ${m.y}`} />;
      })}
      <circle className="home-viz-nodo home-viz-nodo--fuerte" cx={cx} cy={cy} r="26" />
      <circle className="home-viz-nucleo" cx={cx} cy={cy} r="5" />
      {nodos.map((n, i) => (
        <g key={n.t} className="home-viz-aparece" style={{ animationDelay: `${0.3 + i * 0.35}s` }}>
          <circle className="home-viz-nodo" cx={n.x} cy={n.y} r="5" />
          <text className="home-viz-texto home-viz-texto--claro" x={n.x} y={n.y + (n.y < cy ? -14 : 22)} textAnchor="middle">
            {n.t}
          </text>
        </g>
      ))}
    </svg>
  );
}
