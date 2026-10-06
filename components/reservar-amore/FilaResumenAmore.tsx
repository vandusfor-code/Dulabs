import { AMORE } from "./tema";

// AMORE — una fila «etiqueta ... valor» de las tarjetas de resumen (confirmar la cita, cita confirmada, «Mi cita»). Cada fila lleva su propio borde inferior (menos
// la última): el color de borde no se hereda de la tarjeta. Solo presentación.

export function FilaResumenAmore({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0" style={{ borderColor: AMORE.borde }}>
      <span className="text-[12.5px]" style={{ color: AMORE.textoSecundario }}>
        {label}
      </span>
      <span className="text-right text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
        {valor}
      </span>
    </div>
  );
}
