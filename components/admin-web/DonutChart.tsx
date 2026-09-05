// Panel web AMORE (autorizado) — donut SVG puro, sin librería de gráficos
// nueva (el proyecto no tenía ninguna). Recibe segmentos YA calculados por
// el caller a partir de datos reales (lib/contabilidad) -- este componente
// solo dibuja, nunca inventa ni redondea de más los porcentajes mostrados.
export type SegmentoDonut = { etiqueta: string; valor: number; color: string };

export function DonutChart({ segmentos, tamano = 160 }: { segmentos: SegmentoDonut[]; tamano?: number }) {
  const total = segmentos.reduce((acc, s) => acc + s.valor, 0);
  const radio = tamano / 2;
  const grosor = radio * 0.32;
  const radioInterno = radio - grosor;
  const circunferencia = 2 * Math.PI * radioInterno;

  const fracciones = segmentos.map((s) => (total > 0 ? s.valor / total : 0));
  const prefijos = fracciones.reduce<number[]>((acc, f, i) => [...acc, (acc[i - 1] ?? 0) + f], []);
  const arcos = segmentos.map((s, i) => ({
    ...s,
    largo: fracciones[i]! * circunferencia,
    offset: -(prefijos[i - 1] ?? 0) * circunferencia,
  }));

  return (
    <svg viewBox={`0 0 ${tamano} ${tamano}`} width={tamano} height={tamano}>
      {total === 0 ? (
        <circle cx={radio} cy={radio} r={radioInterno} fill="none" stroke="var(--color-edge)" strokeWidth={grosor} />
      ) : (
        <g transform={`rotate(-90 ${radio} ${radio})`}>
          {arcos.map((a) => (
            <circle
              key={a.etiqueta}
              cx={radio}
              cy={radio}
              r={radioInterno}
              fill="none"
              stroke={a.color}
              strokeWidth={grosor}
              strokeDasharray={`${a.largo} ${circunferencia - a.largo}`}
              strokeDashoffset={a.offset}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
